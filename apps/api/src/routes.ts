import type { FastifyInstance } from 'fastify';
import { prisma } from '@agentic-hub/db';
import {
  AuditResultSchema,
  AuditScheduleSchema,
  DEFAULT_POLICY,
  DEFAULT_SCORING,
  NotifyConfigSchema,
  PolicySchema,
  ScoringConfigSchema,
  type SseEvent,
} from '@agentic-hub/shared';
import { buildDependabotYaml } from '@agentic-hub/audit-engine';
import { config } from './config.js';
import { dispatchAuditWorkflow, getActiveToken, getHeadSha, listRepositories } from './github.js';
import { enqueueLocalAudit } from './queue.js';
import { buildReportMarkdown, loadAuditResult, persistAuditResult } from './service.js';
import { sseHub } from './sse.js';

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

export async function registerRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({
    ok: true,
    hybridMode: config.hybridMode,
    ollama: config.ollama.enabled,
  }));

  // ── Repositories ────────────────────────────────────────────
  app.get('/api/repositories', async () => {
    return prisma.repository.findMany({
      orderBy: [{ lastAuditAt: { sort: 'desc', nulls: 'last' } }, { fullName: 'asc' }],
      include: {
        audits: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, globalScore: true, gatePassed: true, createdAt: true },
        },
      },
    });
  });

  app.get('/api/repositories/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const repo = await prisma.repository.findUnique({
      where: { id },
      include: {
        audits: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, status: true, globalScore: true, createdAt: true, trigger: true },
        },
      },
    });
    if (!repo) return reply.code(404).send({ error: 'Repository introuvable' });
    return repo;
  });

  // Synchronise les repos depuis GitHub (compte OAuth connecté ou PAT).
  app.post('/api/repositories/sync', async (req, reply) => {
    if (!(await getActiveToken())) {
      return reply
        .code(400)
        .send({ error: 'Aucune connexion GitHub. Connecte un compte (bouton GitHub) ou définis GITHUB_TOKEN.' });
    }
    const body = (req.body ?? {}) as { owner?: string; ownerType?: 'user' | 'org' };
    try {
      const repos = await listRepositories(body.owner, body.ownerType);
      let created = 0;
      for (const r of repos) {
        const res = await prisma.repository.upsert({
          where: { fullName: r.fullName },
          create: {
            githubId: BigInt(r.githubId),
            fullName: r.fullName,
            name: r.name,
            owner: r.owner,
            url: r.url,
            defaultBranch: r.defaultBranch,
            language: r.language,
            private: r.private,
            description: r.description,
          },
          update: {
            defaultBranch: r.defaultBranch,
            language: r.language,
            private: r.private,
            description: r.description,
          },
        });
        if (res.createdAt.getTime() === res.updatedAt.getTime()) created++;
      }

      // Synchro autoritative : on n'élague que lors d'une synchro globale du
      // compte connecté (sans owner ciblé) → ne conserver QUE les repos liés
      // au compte. Les repos disparus (quittés / non possédés) sont retirés.
      let pruned = 0;
      if (!body.owner) {
        const keep = repos.map((r) => r.fullName);
        const removed = await prisma.repository.deleteMany({
          where: { fullName: { notIn: keep.length ? keep : ['__none__'] } },
        });
        pruned = removed.count;
      }

      return { synced: repos.length, created, pruned };
    } catch (err) {
      return reply.code(502).send({ error: `Échec de synchronisation : ${(err as Error).message}` });
    }
  });

  // Config Dependabot proposée pour un repo (basée sur les langages connus).
  app.get('/api/repositories/:id/dependabot', async (req, reply) => {
    const { id } = req.params as { id: string };
    const repo = await prisma.repository.findUnique({ where: { id } });
    if (!repo) return reply.code(404).send({ error: 'Repository introuvable' });
    const ecosystems = [...new Set([repo.language ?? 'JavaScript'].map((l) => LANG_TO_ECOSYSTEM[l] ?? 'npm'))];
    return { yaml: buildDependabotYaml(ecosystems) };
  });

  // ── Déclenchement d'un audit ────────────────────────────────
  app.post('/api/repositories/:id/audits', async (req, reply) => {
    const { id } = req.params as { id: string };
    const repo = await prisma.repository.findUnique({ where: { id } });
    if (!repo) return reply.code(404).send({ error: 'Repository introuvable' });

    const audit = await prisma.audit.create({
      data: { repositoryId: repo.id, status: 'queued', trigger: 'manual' },
    });

    try {
      if (config.hybridMode) {
        const sha = await getHeadSha(repo.fullName, repo.defaultBranch);
        if (sha) await prisma.audit.update({ where: { id: audit.id }, data: { commitSha: sha } });
        await dispatchAuditWorkflow({ auditId: audit.id, targetRepo: repo.fullName });
        sseHub.publish({
          type: 'status',
          auditId: audit.id,
          status: 'queued',
          message: 'Workflow GitHub Actions déclenché',
          progress: 5,
        });
      } else {
        await enqueueLocalAudit(audit.id);
      }
    } catch (err) {
      await prisma.audit.update({
        where: { id: audit.id },
        data: { status: 'failed', error: (err as Error).message },
      });
      return reply.code(502).send({ error: (err as Error).message, auditId: audit.id });
    }

    return reply.code(202).send({ auditId: audit.id, mode: config.hybridMode ? 'hybrid' : 'local' });
  });

  // ── Audits ──────────────────────────────────────────────────
  app.get('/api/audits/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const audit = await prisma.audit.findUnique({
      where: { id },
      include: {
        repository: true,
        dimensions: true,
        synthesis: true,
        _count: { select: { findings: true } },
      },
    });
    if (!audit) return reply.code(404).send({ error: 'Audit introuvable' });
    return audit;
  });

  app.get('/api/audits/:id/findings', async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { dimension?: string; severity?: string };
    return prisma.finding.findMany({
      where: {
        auditId: id,
        ...(q.dimension ? { dimension: q.dimension } : {}),
        ...(q.severity ? { severity: q.severity as any } : {}),
      },
      orderBy: [{ severity: 'asc' }, { dimension: 'asc' }],
    });
  });

  app.get('/api/audits/:id/report.json', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await loadAuditResult(id);
    if (!result) return reply.code(404).send({ error: 'Audit introuvable' });
    return result;
  });

  app.get('/api/audits/:id/report.md', async (req, reply) => {
    const { id } = req.params as { id: string };
    const md = await buildReportMarkdown(id);
    if (!md) return reply.code(404).send({ error: 'Audit introuvable' });
    reply.header('Content-Type', 'text/markdown; charset=utf-8');
    reply.header('Content-Disposition', `inline; filename="audit-${id}.md"`);
    return md;
  });

  // ── SSE : progression ───────────────────────────────────────
  app.get('/api/audits/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': config.webOrigin,
    });
    reply.raw.write(`event: ping\ndata: {}\n\n`);

    const onEvent = (event: SseEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    sseHub.on(id, onEvent);

    const heartbeat = setInterval(() => reply.raw.write(`event: ping\ndata: {}\n\n`), 25_000);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      sseHub.off(id, onEvent);
    });
  });

  // ── Ingestion (CI → API) ────────────────────────────────────
  app.post('/api/ingest', async (req, reply) => {
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${config.ingestToken}`) {
      return reply.code(401).send({ error: 'Token d’ingestion invalide' });
    }
    const parsed = AuditResultSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Payload invalide', details: parsed.error.flatten() });
    }
    const result = parsed.data;
    if (!result.auditId) return reply.code(400).send({ error: 'auditId manquant' });

    const audit = await prisma.audit.findUnique({ where: { id: result.auditId } });
    if (!audit) return reply.code(404).send({ error: 'Audit inconnu' });

    await persistAuditResult(result.auditId, result);
    const { enqueueSynthesis } = await import('./queue.js');
    await enqueueSynthesis(result.auditId);
    return reply.code(202).send({ ok: true });
  });

  // ── Gouvernance par repo : planning / politique / scoring ───
  app.put('/api/repositories/:id/schedule', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = AuditScheduleSchema.safeParse((req.body as any)?.schedule);
    if (!parsed.success) return reply.code(400).send({ error: 'Planning invalide (off|daily|weekly)' });
    try {
      await prisma.repository.update({ where: { id }, data: { auditSchedule: parsed.data } });
      return { auditSchedule: parsed.data };
    } catch {
      return reply.code(404).send({ error: 'Repository introuvable' });
    }
  });

  app.put('/api/repositories/:id/policy', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body as any)?.policy;
    // null => repasse sur la politique par défaut globale.
    if (body === null) {
      try {
        await prisma.repository.update({ where: { id }, data: { policy: undefined } });
        return { policy: null };
      } catch {
        return reply.code(404).send({ error: 'Repository introuvable' });
      }
    }
    const parsed = PolicySchema.safeParse(body);
    if (!parsed.success) return reply.code(400).send({ error: 'Politique invalide' });
    try {
      await prisma.repository.update({ where: { id }, data: { policy: parsed.data } });
      return { policy: parsed.data };
    } catch {
      return reply.code(404).send({ error: 'Repository introuvable' });
    }
  });

  app.put('/api/repositories/:id/scoring', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body as any)?.scoring;
    if (body === null) {
      try {
        await prisma.repository.update({ where: { id }, data: { scoringOverride: undefined } });
        return { scoring: null };
      } catch {
        return reply.code(404).send({ error: 'Repository introuvable' });
      }
    }
    const parsed = ScoringConfigSchema.safeParse(body);
    if (!parsed.success) return reply.code(400).send({ error: 'Scoring invalide' });
    try {
      await prisma.repository.update({ where: { id }, data: { scoringOverride: parsed.data } });
      return { scoring: parsed.data };
    } catch {
      return reply.code(404).send({ error: 'Repository introuvable' });
    }
  });

  app.put('/api/repositories/:id/lighthouse', async (req, reply) => {
    const { id } = req.params as { id: string };
    const url = (req.body as any)?.url;
    if (url !== null && typeof url !== 'string') return reply.code(400).send({ error: 'URL invalide' });
    try {
      await prisma.repository.update({
        where: { id },
        data: { lighthouseUrl: url ? String(url).trim() : null },
      });
      return { lighthouseUrl: url ? String(url).trim() : null };
    } catch {
      return reply.code(404).send({ error: 'Repository introuvable' });
    }
  });

  // ── Settings (scoring + politique par défaut + notifications) ─
  app.get('/api/settings', async () => {
    const s = await prisma.setting.findUnique({ where: { id: 1 } });
    return {
      scoring: s?.scoring ?? DEFAULT_SCORING,
      policy: s?.policy ?? DEFAULT_POLICY,
      notify: s?.notify ?? { webhookUrl: '', mode: 'off' },
    };
  });

  app.put('/api/settings', async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const data: Record<string, unknown> = {};
    if (body.scoring !== undefined) {
      const p = ScoringConfigSchema.safeParse(body.scoring);
      if (!p.success) return reply.code(400).send({ error: 'Config de scoring invalide' });
      data.scoring = p.data;
    }
    if (body.policy !== undefined) {
      const p = PolicySchema.safeParse(body.policy);
      if (!p.success) return reply.code(400).send({ error: 'Politique invalide' });
      data.policy = p.data;
    }
    if (body.notify !== undefined) {
      const p = NotifyConfigSchema.safeParse(body.notify);
      if (!p.success) return reply.code(400).send({ error: 'Config de notification invalide' });
      data.notify = p.data;
    }
    const s = await prisma.setting.upsert({
      where: { id: 1 },
      update: data,
      create: { id: 1, ...data },
    });
    return { scoring: s.scoring, policy: s.policy, notify: s.notify };
  });
}
