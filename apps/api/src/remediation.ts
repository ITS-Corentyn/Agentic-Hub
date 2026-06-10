import type { FastifyInstance } from 'fastify';
import { prisma } from '@agentic-hub/db';
import { createDependabotPr, createIssueFromFinding } from './github.js';

const LANG_TO_ECOSYSTEM: Record<string, string> = {
  TypeScript: 'npm',
  JavaScript: 'npm',
  Vue: 'npm',
  Python: 'pip',
  Go: 'gomod',
  Ruby: 'bundler',
  PHP: 'composer',
  Java: 'maven',
  Rust: 'cargo',
};

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
    const ecosystems = [...new Set([repo.language ?? 'JavaScript'].map((l) => LANG_TO_ECOSYSTEM[l] ?? 'npm'))];
    try {
      const url = await createDependabotPr(repo.fullName, ecosystems);
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
