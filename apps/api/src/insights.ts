import type { FastifyInstance } from 'fastify';
import { prisma } from '@agentic-hub/db';

/**
 * Cle de rapprochement d'un finding entre deux audits, robuste au decalage de
 * lignes : on ignore le numero de ligne (qui change a chaque commit).
 */
function matchKey(f: { tool: string; ruleId: string; filePath: string | null; title: string }): string {
  return `${f.tool}|${f.ruleId}|${f.filePath ?? ''}|${f.title}`;
}

export async function registerInsightRoutes(app: FastifyInstance) {
  // Tendance du score d'un repo dans le temps.
  app.get('/api/repositories/:id/trend', async (req) => {
    const { id } = req.params as { id: string };
    const audits = await prisma.audit.findMany({
      where: { repositoryId: id, status: 'done' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        createdAt: true,
        globalScore: true,
        commitSha: true,
        _count: { select: { findings: true } },
      },
    });
    return audits.map((a) => ({
      auditId: a.id,
      date: a.createdAt,
      score: a.globalScore ?? 0,
      findings: a._count.findings,
      commit: a.commitSha,
    }));
  });

  // Diff d'un audit vs l'audit precedent du meme repo (nouveau / corrige / persistant).
  app.get('/api/audits/:id/diff', async (req, reply) => {
    const { id } = req.params as { id: string };
    const against = (req.query as { against?: string }).against;
    const cur = await prisma.audit.findUnique({
      where: { id },
      include: { findings: true },
    });
    if (!cur) return reply.code(404).send({ error: 'Audit introuvable' });

    // Comparaison contre un audit précis (?against) ou, par défaut, le précédent.
    const prev = against
      ? await prisma.audit.findUnique({ where: { id: against }, include: { findings: true } })
      : await prisma.audit.findFirst({
          where: {
            repositoryId: cur.repositoryId,
            status: 'done',
            id: { not: cur.id },
            createdAt: { lt: cur.createdAt },
          },
          orderBy: { createdAt: 'desc' },
          include: { findings: true },
        });

    const curMap = new Map(cur.findings.map((f) => [matchKey(f), f]));
    const prevMap = new Map((prev?.findings ?? []).map((f) => [matchKey(f), f]));

    const added = cur.findings.filter((f) => !prevMap.has(matchKey(f)));
    const fixed = (prev?.findings ?? []).filter((f) => !curMap.has(matchKey(f)));
    const persistent = cur.findings.filter((f) => prevMap.has(matchKey(f)));

    const slim = (f: any) => ({
      id: f.id,
      severity: f.severity,
      dimension: f.dimension,
      tool: f.tool,
      title: f.title,
      filePath: f.filePath,
      line: f.line,
    });

    return {
      previousAuditId: prev?.id ?? null,
      deltaScore:
        prev?.globalScore != null && cur.globalScore != null
          ? Math.round((cur.globalScore - prev.globalScore) * 10) / 10
          : null,
      counts: { added: added.length, fixed: fixed.length, persistent: persistent.length },
      added: added.map(slim),
      fixed: fixed.map(slim),
    };
  });

  // Recherche globale des findings (dernier audit de chaque repo).
  app.get('/api/findings/search', async (req) => {
    const q = req.query as { q?: string; severity?: string; dimension?: string; limit?: string };
    const repos = await prisma.repository.findMany({
      select: {
        id: true,
        fullName: true,
        audits: { where: { status: 'done' }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true } },
      },
    });
    const map = new Map<string, { repoId: string; fullName: string }>();
    for (const r of repos) {
      if (r.audits[0]) map.set(r.audits[0].id, { repoId: r.id, fullName: r.fullName });
    }
    const auditIds = [...map.keys()];
    if (!auditIds.length) return [];

    const findings = await prisma.finding.findMany({
      where: {
        auditId: { in: auditIds },
        status: { not: 'ignored' },
        ...(q.severity ? { severity: q.severity as any } : {}),
        ...(q.dimension ? { dimension: q.dimension } : {}),
        ...(q.q
          ? {
              OR: [
                { title: { contains: q.q, mode: 'insensitive' } },
                { filePath: { contains: q.q, mode: 'insensitive' } },
                { ruleId: { contains: q.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ severity: 'asc' }],
      take: Math.min(Number(q.limit ?? 200), 500),
    });
    return findings.map((f) => ({
      id: f.id,
      severity: f.severity,
      dimension: f.dimension,
      tool: f.tool,
      title: f.title,
      filePath: f.filePath,
      line: f.line,
      repo: map.get(f.auditId) ?? null,
    }));
  });

  // Vue d'ensemble (organisation) : scores, severites, pires repos, regles frequentes.
  app.get('/api/stats/overview', async () => {
    const repos = await prisma.repository.findMany({
      include: {
        audits: {
          where: { status: 'done' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            globalScore: true,
            createdAt: true,
            findings: { select: { severity: true, ruleId: true, status: true } },
          },
        },
      },
    });

    const severityTotals: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    const ruleCounts = new Map<string, number>();
    const scored: { id: string; fullName: string; score: number }[] = [];

    for (const r of repos) {
      const last = r.audits[0];
      if (!last) continue;
      if (last.globalScore != null) scored.push({ id: r.id, fullName: r.fullName, score: last.globalScore });
      for (const f of last.findings) {
        if (f.status === 'ignored') continue;
        severityTotals[f.severity] = (severityTotals[f.severity] ?? 0) + 1;
        if (f.ruleId) ruleCounts.set(f.ruleId, (ruleCounts.get(f.ruleId) ?? 0) + 1);
      }
    }

    const avgScore = scored.length
      ? Math.round((scored.reduce((s, x) => s + x.score, 0) / scored.length) * 10) / 10
      : 0;
    const worstRepos = [...scored].sort((a, b) => a.score - b.score).slice(0, 5);
    const topRules = [...ruleCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([rule, count]) => ({ rule, count }));

    return {
      repoCount: repos.length,
      auditedCount: scored.length,
      avgScore,
      severityTotals,
      worstRepos,
      topRules,
    };
  });
}
