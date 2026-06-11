import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_SCORING,
  type AuditResult,
  type Finding,
  type ScoringConfig,
  type ToolName,
} from '@agentic-hub/shared';
import { analyzeDependabot } from './dependabot.js';
import { computeMetrics } from './metrics.js';
import { runAllScanners, type ScannerOutput } from './scanners.js';
import { scoreDimensions, scoreGlobal } from './scoring.js';
import { dedupeFindings } from './util.js';

export interface RunAuditOptions {
  auditId?: string | null;
  commitSha?: string | null;
  repoFullName?: string;
  repoUrl?: string | null;
  scoring?: ScoringConfig;
  onProgress?: (tool: ToolName) => void;
  /** Conserver les sorties brutes des scanners (artefacts). */
  keepRaw?: boolean;
}

export interface RunAuditResult {
  result: AuditResult;
  artifacts: { tool: ToolName; raw: string }[];
  proposedDependabot: string;
}

/**
 * Exécute un audit complet sur un dossier : métriques + scanners + dependabot,
 * normalisation, dédoublonnage, scoring. Renvoie un AuditResult prêt à ingérer.
 */
export function runAudit(root: string, opts: RunAuditOptions = {}): RunAuditResult {
  const scoring = opts.scoring ?? DEFAULT_SCORING;
  const generatedAt = new Date().toISOString();

  const metrics = computeMetrics(root);

  const scannerOutputs: ScannerOutput[] = runAllScanners(root, opts.onProgress);
  const dependabot = analyzeDependabot(root);
  opts.onProgress?.('engine');

  // Suppressions repo-local : ruleIds à ignorer (.agentic-hub/suppress.txt, 1 par ligne).
  const suppressed = loadSuppressions(root);
  const allFindings: Finding[] = dedupeFindings([
    ...scannerOutputs.flatMap((s) => s.findings),
    ...dependabot.findings,
  ]).filter((f) => !suppressed.has(f.ruleId));

  const dimensions = scoreDimensions(allFindings, metrics.loc, scoring);
  const globalScore = scoreGlobal(dimensions, scoring);

  const toolsRun = scannerOutputs.filter((s) => s.ran).map((s) => s.tool);
  toolsRun.push('engine');
  const toolsSkipped = scannerOutputs.filter((s) => !s.ran).map((s) => s.tool);

  const result: AuditResult = {
    auditId: opts.auditId ?? null,
    repository: {
      fullName: opts.repoFullName ?? 'local/workspace',
      url: opts.repoUrl ?? null,
    },
    commitSha: opts.commitSha ?? null,
    metrics,
    findings: allFindings,
    dimensions,
    globalScore,
    toolsRun,
    toolsSkipped,
    generatedAt,
  };

  const artifacts = opts.keepRaw
    ? scannerOutputs.filter((s) => s.raw).map((s) => ({ tool: s.tool, raw: s.raw }))
    : [];

  return { result, artifacts, proposedDependabot: dependabot.proposedConfig };
}

/** Charge les ruleIds à supprimer depuis `.agentic-hub/suppress.txt` (commentaires `#` ignorés). */
function loadSuppressions(root: string): Set<string> {
  const file = join(root, '.agentic-hub', 'suppress.txt');
  if (!existsSync(file)) return new Set();
  try {
    const lines = readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    return new Set(lines);
  } catch {
    return new Set();
  }
}
