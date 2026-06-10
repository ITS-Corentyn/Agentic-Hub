import PgBoss from 'pg-boss';
import { config } from './config.js';
import { runLocalAudit } from './local-runner.js';
import { markFailed, runSynthesisAndFinish } from './service.js';

export const QUEUE_LOCAL_AUDIT = 'audit.local';
export const QUEUE_SYNTHESIS = 'audit.synthesis';

let boss: PgBoss | null = null;

export async function startQueue(): Promise<PgBoss> {
  if (boss) return boss;
  boss = new PgBoss({ connectionString: config.databaseUrl });
  boss.on('error', (err) => console.error('[pg-boss]', err));
  await boss.start();

  await boss.createQueue(QUEUE_LOCAL_AUDIT);
  await boss.createQueue(QUEUE_SYNTHESIS);

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

  return boss;
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
