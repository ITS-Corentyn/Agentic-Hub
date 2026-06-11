import { prisma } from '@agentic-hub/db';
import type { AuditResult } from '@agentic-hub/shared';
import {
  generateReport,
  buildStaticSynthesis,
  evaluateGate,
  resolveEffectivePolicy,
} from '@agentic-hub/audit-engine';
import { generateSynthesis } from './ollama.js';
import { notifyAuditDone } from './notify.js';
import { sseHub } from './sse.js';

/** Persiste un AuditResult (findings + dimensions + métriques) et passe en "analyzing". */
export async function persistAuditResult(auditId: string, result: AuditResult): Promise<void> {
  // Audit annulé entre-temps : on n'écrase pas son état "failed".
  const current = await prisma.audit.findUnique({ where: { id: auditId }, select: { status: true } });
  if (!current || current.status === 'failed' || current.status === 'done') return;

  await prisma.$transaction(async (tx) => {
    await tx.finding.deleteMany({ where: { auditId } });
    await tx.dimensionResult.deleteMany({ where: { auditId } });

    await tx.audit.update({
      where: { id: auditId },
      data: {
        status: 'analyzing',
        globalScore: result.globalScore,
        commitSha: result.commitSha,
        loc: result.metrics.loc,
        files: result.metrics.files,
        languages: result.metrics.languages,
        toolsRun: result.toolsRun,
        toolsSkipped: result.toolsSkipped,
      },
    });

    await tx.dimensionResult.createMany({
      data: result.dimensions.map((d) => ({
        auditId,
        dimension: d.dimension,
        score: d.score,
        summary: d.summary,
        counts: d.counts,
      })),
    });

    if (result.findings.length) {
      await tx.finding.createMany({
        data: result.findings.map((f) => ({
          auditId,
          dimension: f.dimension,
          tool: f.tool,
          severity: f.severity,
          ruleId: f.ruleId,
          title: f.title,
          description: f.description,
          filePath: f.filePath,
          line: f.line,
          remediation: f.remediation,
          reference: f.reference,
          fingerprint: f.fingerprint,
        })),
      });
    }
  });

  sseHub.publish({ type: 'status', auditId, status: 'analyzing', message: 'Résultats ingérés', progress: 70 });
}

/** Reconstruit un AuditResult à partir de la base (pour synthèse / rapport). */
export async function loadAuditResult(auditId: string): Promise<AuditResult | null> {
  const audit = await prisma.audit.findUnique({
    where: { id: auditId },
    include: { repository: true, findings: true, dimensions: true },
  });
  if (!audit) return null;

  return {
    auditId: audit.id,
    repository: { fullName: audit.repository.fullName, url: audit.repository.url },
    commitSha: audit.commitSha,
    metrics: { loc: audit.loc, files: audit.files, languages: audit.languages },
    findings: audit.findings.map((f) => ({
      dimension: f.dimension as AuditResult['findings'][number]['dimension'],
      tool: f.tool as AuditResult['findings'][number]['tool'],
      severity: f.severity as AuditResult['findings'][number]['severity'],
      ruleId: f.ruleId,
      title: f.title,
      description: f.description,
      filePath: f.filePath,
      line: f.line,
      remediation: f.remediation,
      reference: f.reference,
      fingerprint: f.fingerprint,
    })),
    dimensions: audit.dimensions.map((d) => ({
      dimension: d.dimension as AuditResult['dimensions'][number]['dimension'],
      score: d.score,
      summary: d.summary,
      counts: d.counts as AuditResult['dimensions'][number]['counts'],
    })),
    globalScore: audit.globalScore ?? 0,
    toolsRun: audit.toolsRun as AuditResult['toolsRun'],
    toolsSkipped: audit.toolsSkipped as AuditResult['toolsSkipped'],
    generatedAt: (audit.finishedAt ?? audit.updatedAt).toISOString(),
  };
}

/** Génère la synthèse (Ollama ou fallback), la persiste et clôt l'audit. */
export async function runSynthesisAndFinish(auditId: string): Promise<void> {
  const result = await loadAuditResult(auditId);
  if (!result) return;

  sseHub.publish({ type: 'status', auditId, status: 'analyzing', message: 'Génération de la synthèse…', progress: 85 });

  const synthesis = await generateSynthesis(result);

  await prisma.synthesis.upsert({
    where: { auditId },
    update: {
      executiveSummary: synthesis.executiveSummary,
      top10: synthesis.top10,
      roadmap7d: synthesis.roadmap7d,
      roadmap30d: synthesis.roadmap30d,
      model: synthesis.model,
      llmGenerated: synthesis.llmGenerated,
    },
    create: {
      auditId,
      executiveSummary: synthesis.executiveSummary,
      top10: synthesis.top10,
      roadmap7d: synthesis.roadmap7d,
      roadmap30d: synthesis.roadmap30d,
      model: synthesis.model,
      llmGenerated: synthesis.llmGenerated,
    },
  });

  // Gate qualité : politique du repo, sinon politique par défaut globale.
  const repo = await prisma.repository.findFirst({ where: { audits: { some: { id: auditId } } } });
  const setting = await prisma.setting.findUnique({ where: { id: 1 } });
  const policy = resolveEffectivePolicy((repo?.policy ?? setting?.policy) as any);
  const gate = evaluateGate(result, policy);

  // Score de l'audit précédent (pour notification "score-drop").
  const prev = await prisma.audit.findFirst({
    where: { repositoryId: repo?.id, status: 'done', id: { not: auditId } },
    orderBy: { createdAt: 'desc' },
    select: { globalScore: true },
  });

  const audit = await prisma.audit.update({
    where: { id: auditId },
    data: {
      status: 'done',
      finishedAt: new Date(),
      gatePassed: gate.passed,
      gateReasons: gate.reasons,
    },
  });
  await prisma.repository.update({
    where: { id: audit.repositoryId },
    data: { lastAuditAt: new Date() },
  });

  if (repo) {
    await notifyAuditDone({
      result,
      gate,
      previousScore: prev?.globalScore ?? null,
      repoFullName: repo.fullName,
    }).catch(() => {});
  }

  sseHub.publish({
    type: 'done',
    auditId,
    status: 'done',
    message: gate.passed ? 'Audit terminé · Gate OK' : 'Audit terminé · Gate KO',
    progress: 100,
  });
}

/** Génère le rapport Markdown complet d'un audit depuis la base. */
export async function buildReportMarkdown(auditId: string): Promise<string | null> {
  const result = await loadAuditResult(auditId);
  if (!result) return null;
  const synthRow = await prisma.synthesis.findUnique({ where: { auditId } });
  const synthesis = synthRow
    ? {
        executiveSummary: synthRow.executiveSummary,
        top10: synthRow.top10 as any,
        roadmap7d: synthRow.roadmap7d as any,
        roadmap30d: synthRow.roadmap30d as any,
        model: synthRow.model,
        llmGenerated: synthRow.llmGenerated,
      }
    : buildStaticSynthesis(result);
  return generateReport(result, synthesis);
}

export async function markFailed(auditId: string, error: string): Promise<void> {
  sseHub.publish({ type: 'error', auditId, status: 'failed', message: error });
  await prisma.audit.update({
    where: { id: auditId },
    data: { status: 'failed', error, finishedAt: new Date() },
  });
}
