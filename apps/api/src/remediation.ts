import type { FastifyInstance } from 'fastify';
import { prisma } from '@agentic-hub/db';
import { ecosystemsForLanguage } from '@agentic-hub/audit-engine';
import { createDependabotPr, createFilePr, createIssueFromFinding } from './github.js';

// Workflow GitHub Actions de check de PR : audit + commentaire + statut bloquant.
const PR_CHECK_WORKFLOW = `name: Agentic-Hub PR Audit
on:
  pull_request:
permissions:
  contents: read
  pull-requests: write
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Recuperer le moteur Agentic-Hub
        uses: actions/checkout@v4
        with:
          repository: ITS-Corentyn/Agentic-Hub
          path: .agentic-engine
          token: \${{ secrets.AGENTIC_HUB_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: corepack enable
      - name: Build du moteur
        working-directory: .agentic-engine
        run: |
          pnpm install --frozen-lockfile=false
          pnpm --filter @agentic-hub/shared build
          pnpm --filter @agentic-hub/audit-engine build
      - name: Installer les scanners
        run: |
          pip install semgrep
          curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sudo sh -s -- -b /usr/local/bin
          curl -sSL -o osv-scanner "https://github.com/google/osv-scanner/releases/download/v1.9.1/osv-scanner_linux_amd64" && sudo install osv-scanner /usr/local/bin/osv-scanner
          GZ=8.21.2; curl -sSL "https://github.com/gitleaks/gitleaks/releases/download/v\${GZ}/gitleaks_\${GZ}_linux_x64.tar.gz" | sudo tar -xz -C /usr/local/bin gitleaks
          npm i -g jscpd@4 dependency-cruiser@16 madge@8 depcheck@1 ts-prune@0.10 eslint@9 @eslint/js@9
      - name: Audit (gate sur findings eleves+)
        run: node .agentic-engine/packages/audit-engine/dist/cli.js scan . --report report.md --fail-on-severity high
      - name: Commentaire de PR
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            let body = '## Agentic-Hub — audit de la PR\\n';
            try { body += fs.readFileSync('report.md','utf8').slice(0, 60000); } catch (e) { body += '_Rapport indisponible._'; }
            await github.rest.issues.createComment({ ...context.repo, issue_number: context.issue.number, body });
`;

export async function registerRemediationRoutes(app: FastifyInstance) {
  // Triage d'un finding : statut (open/fixed/ignored) + motif.
  app.patch('/api/findings/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { status?: string; note?: string };
    const allowed = ['open', 'fixed', 'ignored'];
    if (body.status && !allowed.includes(body.status)) {
      return reply.code(400).send({ error: 'Statut invalide' });
    }
    try {
      const updated = await prisma.finding.update({
        where: { id },
        data: {
          ...(body.status ? { status: body.status as any } : {}),
          ...(body.note !== undefined ? { note: body.note } : {}),
        },
      });
      return updated;
    } catch {
      return reply.code(404).send({ error: 'Finding introuvable' });
    }
  });

  // Ouvre une PR ajoutant `.github/dependabot.yml` sur le repo.
  app.post('/api/repositories/:id/dependabot-pr', async (req, reply) => {
    const { id } = req.params as { id: string };
    const repo = await prisma.repository.findUnique({ where: { id } });
    if (!repo) return reply.code(404).send({ error: 'Repository introuvable' });
    try {
      const url = await createDependabotPr(repo.fullName, ecosystemsForLanguage(repo.language));
      return { url };
    } catch (err) {
      return reply.code(502).send({ error: `Echec de creation de la PR : ${(err as Error).message}` });
    }
  });

  // Ouvre une PR ajoutant le workflow de check de PR (audit a chaque PR).
  app.post('/api/repositories/:id/pr-check', async (req, reply) => {
    const { id } = req.params as { id: string };
    const repo = await prisma.repository.findUnique({ where: { id } });
    if (!repo) return reply.code(404).send({ error: 'Repository introuvable' });
    try {
      const url = await createFilePr({
        fullName: repo.fullName,
        branch: 'agentic-hub/pr-check',
        path: '.github/workflows/agentic-pr-check.yml',
        content: PR_CHECK_WORKFLOW,
        commitMessage: 'ci: audit Agentic-Hub a chaque PR',
        prTitle: 'ci: check de PR Agentic-Hub',
        prBody:
          "Ajoute un audit automatique a chaque pull request (commentaire + statut bloquant si findings eleves).\\n\\n" +
          'Pre-requis : definir le secret `AGENTIC_HUB_TOKEN` (PAT avec acces en lecture au depot Agentic-Hub).\\n\\n_Genere par Agentic-Hub._',
      });
      return { url };
    } catch (err) {
      return reply.code(502).send({ error: `Echec de creation de la PR : ${(err as Error).message}` });
    }
  });

  // Cree une issue GitHub a partir d'un finding.
  app.post('/api/findings/:id/issue', async (req, reply) => {
    const { id } = req.params as { id: string };
    const finding = await prisma.finding.findUnique({
      where: { id },
      include: { audit: { include: { repository: true } } },
    });
    if (!finding) return reply.code(404).send({ error: 'Finding introuvable' });
    try {
      const url = await createIssueFromFinding(finding.audit.repository.fullName, {
        severity: finding.severity,
        dimension: finding.dimension,
        tool: finding.tool,
        ruleId: finding.ruleId,
        title: finding.title,
        description: finding.description,
        filePath: finding.filePath,
        line: finding.line,
        remediation: finding.remediation,
        reference: finding.reference,
      });
      return { url };
    } catch (err) {
      return reply.code(502).send({ error: `Echec de creation de l'issue : ${(err as Error).message}` });
    }
  });
}
