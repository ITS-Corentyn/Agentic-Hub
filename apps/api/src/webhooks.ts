import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@agentic-hub/db';
import { config } from './config.js';
import { dispatchAuditWorkflow, getHeadSha } from './github.js';
import { enqueueLocalAudit } from './queue.js';

/** Vérifie la signature HMAC SHA-256 d'un webhook GitHub. */
function verifySignature(rawBody: string, signature: string | undefined): boolean {
  if (!config.github.webhookSecret || !signature) return false;
  const expected = 'sha256=' + createHmac('sha256', config.github.webhookSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function registerWebhookRoutes(app: FastifyInstance) {
  // Webhook GitHub : un push déclenche un audit du repo correspondant.
  app.post('/api/webhooks/github', async (req, reply) => {
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? '';
    const sig = req.headers['x-hub-signature-256'] as string | undefined;
    if (!verifySignature(raw, sig)) {
      return reply.code(401).send({ error: 'Signature invalide' });
    }
    const event = req.headers['x-github-event'] as string | undefined;
    if (event === 'ping') return { ok: true, pong: true };
    if (event !== 'push') return { ok: true, ignored: event };

    const body = req.body as { repository?: { full_name?: string }; after?: string };
    const fullName = body.repository?.full_name;
    if (!fullName) return reply.code(400).send({ error: 'Payload sans repository' });

    const repo = await prisma.repository.findUnique({ where: { fullName } });
    if (!repo) return reply.code(404).send({ error: `Repository ${fullName} non suivi` });

    // Évite d'empiler si un audit est déjà en cours.
    const active = await prisma.audit.findFirst({
      where: { repositoryId: repo.id, status: { in: ['queued', 'running', 'analyzing'] } },
    });
    if (active) return { ok: true, message: 'Audit déjà en cours' };

    const audit = await prisma.audit.create({
      data: { repositoryId: repo.id, status: 'queued', trigger: 'ci', commitSha: body.after ?? null },
    });
    try {
      if (config.hybridMode) {
        const sha = body.after ?? (await getHeadSha(repo.fullName, repo.defaultBranch));
        if (sha) await prisma.audit.update({ where: { id: audit.id }, data: { commitSha: sha } });
        await dispatchAuditWorkflow({ auditId: audit.id, targetRepo: repo.fullName });
      } else {
        await enqueueLocalAudit(audit.id);
      }
    } catch (err) {
      await prisma.audit.update({
        where: { id: audit.id },
        data: { status: 'failed', error: (err as Error).message },
      });
      return reply.code(502).send({ error: (err as Error).message });
    }
    return reply.code(202).send({ ok: true, auditId: audit.id });
  });
}
