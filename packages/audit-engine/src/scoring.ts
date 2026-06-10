import {
  DIMENSIONS,
  SEVERITIES,
  SEVERITY_PENALTY,
  type Dimension,
  type DimensionResult,
  type Finding,
  type ScoringConfig,
  type Severity,
} from '@agentic-hub/shared';

function emptyCounts(): Record<Severity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));

/**
 * Calcule le score (0-100) de chaque dimension à partir des findings,
 * normalisé par la taille du code (LOC) pour ne pas pénaliser les gros repos.
 */
export function scoreDimensions(
  findings: Finding[],
  loc: number,
  config: ScoringConfig,
): DimensionResult[] {
  const penalty = { ...SEVERITY_PENALTY, ...(config.penalty ?? {}) };
  const baseline = config.locBaseline;
  // Facteur de tolérance : 1 pour les petits repos, décroît pour les gros.
  const locFactor = baseline / Math.max(loc, baseline);

  const byDim = new Map<Dimension, { raw: number; counts: Record<Severity, number> }>();
  for (const d of DIMENSIONS) byDim.set(d, { raw: 0, counts: emptyCounts() });

  for (const f of findings) {
    const bucket = byDim.get(f.dimension);
    if (!bucket) continue;
    bucket.raw += penalty[f.severity];
    bucket.counts[f.severity] += 1;
  }

  return DIMENSIONS.map((dimension) => {
    const bucket = byDim.get(dimension)!;
    const score = clamp(100 - bucket.raw * locFactor);
    return {
      dimension,
      score: Math.round(score * 10) / 10,
      summary: summarize(dimension, bucket.counts),
      counts: bucket.counts,
    };
  });
}

function summarize(dimension: Dimension, counts: Record<Severity, number>): string {
  const total = SEVERITIES.reduce((s, sev) => s + counts[sev], 0);
  if (total === 0) return 'Aucun problème détecté.';
  const parts = SEVERITIES.filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${s}`);
  return `${total} problème(s) — ${parts.join(', ')}.`;
}

/** Score global = moyenne pondérée des scores de dimension. */
export function scoreGlobal(dimensions: DimensionResult[], config: ScoringConfig): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const d of dimensions) {
    const w = config.weights[d.dimension] ?? 0;
    weighted += d.score * w;
    totalWeight += w;
  }
  if (totalWeight === 0) return 0;
  return Math.round((weighted / totalWeight) * 10) / 10;
}
