import PgBoss from 'pg-boss';
import { prisma } from '@agentic-hub/db';
import { config } from './config.js';
import { dispatchAuditWorkflow, getHeadSha } from './github.js';
import { runLocalAudit } from './local-runner.js';
import { markFailed, runSynthesisAndFinish } from './service.js';

export const QUEUE_LOCAL_AUDIT = 'audit.local';
export const QUEUE_SYNTHESIS = 'audit.synthesis';
export const QUEUE_SCHEDULE_TICK = 'audit.schedule-tick';

let boss: PgBoss | null = null;

export async function startQueue(): Promise<PgBoss> {
  if (boss) return boss;
  boss = new PgBoss({ connectionString: config.databaseUrl });
  boss.on('error', (err) => console.error('[pg-boss]', err));
  await boss.start();

  await boss.createQueue(QUEUE_LOCAL_AUDIT);
  await boss.createQueue(QUEUE_SYNTHESIS);
  await boss.createQueue(QUEUE_SCHEDULE_TICK);

  // Worker : audit local (clone + scan + ingest).
  await boss.work<{ auditId: string }>(QUEUE_LOCAL_AUDIT, async (jobs) => {
    for (const job of asArray(jobs)) {
      const { auditId } = job.data;
      try {
        await runLocalAudit(auditId);
        await enqueueSynthesis(auditId);
      } catch (err) {
        await markFailed(auditId, (err as Error).message);
      }
    }
  });

  // Worker : synthèse (Ollama / fallback) + clôture.
  await boss.work<{ auditId: string }>(QUEUE_SYNTHESIS, async (jobs) => {
    for (const job of asArray(jobs)) {
      const { auditId } = job.data;
      try {
        await runSynthesisAndFinish(auditId);
      } catch (err) {
        await markFailed(auditId, (err as Error).message);
      }
    }
  });

  // Worker : tick de planification (déclenche les audits dus).
  await boss.work(QUEUE_SCHEDULE_TICK, async () => {
    try {
      await runScheduleTick();
    } catch (err) {
      console.error('[schedule-tick]', (err as Error).message);
    }
  });
  // Cron horaire : pg-boss envoie un job sur la queue tick chaque heure.
  await boss.schedule(QUEUE_SCHEDULE_TICK, '0 * * * *');

  return boss;
}

/** Déclenche un audit pour chaque repo dont le planning est arrivé à échéance. */
async function runScheduleTick(): Promise<void> {
  const repos = await prisma.repository.findMany({
    where: { auditSchedule: { not: 'off' } },
    include: { audits: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } } },
  });
  const now = Date.now();
  for (const r of repos) {
    const last = r.lastAuditAt ? r.lastAuditAt.getTime() : 0;
    const dueMs = r.auditSchedule === 'daily' ? 20 * 3600_000 : 6.5 * 24 * 3600_000;
    if (now - last < dueMs) continue;
    const inProgress = r.audits[0] && ['queued', 'running', 'analyzing'].includes(r.audits[0].status);
    if (inProgress) continue;

    const audit = await prisma.audit.create({
      data: { repositoryId: r.id, status: 'queued', trigger: 'schedule' },
    });
    try {
      if (config.hybridMode) {
        const sha = await getHeadSha(r.fullName, r.defaultBranch);
        if (sha) await prisma.audit.update({ where: { id: audit.id }, data: { commitSha: sha } });
        await dispatchAuditWorkflow({ auditId: audit.id, targetRepo: r.fullName });
      } else {
        await boss!.send(QUEUE_LOCAL_AUDIT, { auditId: audit.id });
      }
    } catch (err) {
      await markFailed(audit.id, (err as Error).message);
    }
  }
}

function asArray<T>(jobs: T | T[]): T[] {
  return Array.isArray(jobs) ? jobs : [jobs];
}

export async function enqueueLocalAudit(auditId: string): Promise<void> {
  await startQueue();
  await boss!.send(QUEUE_LOCAL_AUDIT, { auditId });
}

export async function enqueueSynthesis(auditId: string): Promise<void> {
  await startQueue();
  await boss!.send(QUEUE_SYNTHESIS, { auditId });
}
