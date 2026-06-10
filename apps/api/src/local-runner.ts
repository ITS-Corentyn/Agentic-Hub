import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@agentic-hub/db';
import { runAudit } from '@agentic-hub/audit-engine';
import { getActiveToken } from './github.js';
import { persistAuditResult } from './service.js';
import { sseHub } from './sse.js';

/**
 * Mode local (fallback hors GitHub Actions) : clone le repo en peu profond,
 * exécute le moteur d'audit, persiste artefacts + résultats.
 */
export async function runLocalAudit(auditId: string): Promise<void> {
  const audit = await prisma.audit.findUnique({
    where: { id: auditId },
    include: { repository: true },
  });
  if (!audit) throw new Error(`Audit ${auditId} introuvable`);

  const repo = audit.repository;
  const workdir = mkdtempSync(join(tmpdir(), 'ah-clone-'));

  try {
    await prisma.audit.update({
      where: { id: auditId },
      data: { status: 'running', startedAt: new Date() },
    });
    sseHub.publish({ type: 'status', auditId, status: 'running', message: `Clonage de ${repo.fullName}…`, progress: 10 });

    const token = await getActiveToken();
    const cloneUrl = buildCloneUrl(repo.url ?? `https://github.com/${repo.fullName}`, token);
    const clone = spawnSync(
      'git',
      ['clone', '--depth', '1', '--branch', repo.defaultBranch, cloneUrl, workdir],
      { encoding: 'utf8', timeout: 300_000 },
    );
    if (clone.status !== 0) {
      // Réessai sans préciser la branche (cas master/main divergent).
      const retry = spawnSync('git', ['clone', '--depth', '1', cloneUrl, workdir], {
        encoding: 'utf8',
        timeout: 300_000,
      });
      if (retry.status !== 0) throw new Error(`Échec du clone : ${clone.stderr || retry.stderr}`);
    }

    const headSha = spawnSync('git', ['-C', workdir, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
      .stdout?.trim();

    sseHub.publish({ type: 'status', auditId, status: 'running', message: 'Exécution des scanners…', progress: 30 });

    const setting = await prisma.setting.findUnique({ where: { id: 1 } });
    const { result, artifacts } = runAudit(workdir, {
      auditId,
      commitSha: headSha || null,
      repoFullName: repo.fullName,
      repoUrl: repo.url,
      scoring: (setting?.scoring as any) ?? undefined,
      keepRaw: true,
      onProgress: (tool) =>
        sseHub.publish({ type: 'log', auditId, message: `scanner: ${tool}` }),
    });

    if (artifacts.length) {
      await prisma.scanArtifact.createMany({
        data: artifacts.map((a) => ({ auditId, tool: a.tool, rawOutput: a.raw.slice(0, 2_000_000) })),
      });
    }

    await persistAuditResult(auditId, result);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

function buildCloneUrl(url: string, token: string | null): string {
  // Injecte le token pour les repos privés (https://x-access-token:TOKEN@github.com/...).
  if (token && url.startsWith('https://github.com/')) {
    return url.replace('https://', `https://x-access-token:${token}@`);
  }
  return url;
}
