import {
  DIMENSION_LABELS,
  SEVERITY_RANK,
  type AuditResult,
  type Finding,
  type RoadmapItem,
  type Synthesis,
} from '@agentic-hub/shared';

function topFindings(result: AuditResult, n: number): Finding[] {
  return [...result.findings]
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, n);
}

/**
 * Synthèse déterministe (sans LLM) — sert de fallback quand Ollama est désactivé
 * et de structure de référence pour la sortie attendue du LLM.
 */
export function buildStaticSynthesis(result: AuditResult): Synthesis {
  const total = result.findings.length;
  const critical = result.findings.filter((f) => f.severity === 'critical').length;
  const high = result.findings.filter((f) => f.severity === 'high').length;
  const worst = [...result.dimensions].sort((a, b) => a.score - b.score).slice(0, 3);

  const executiveSummary =
    `Le repository ${result.repository.fullName} obtient un score global de ${result.globalScore}/100. ` +
    `${total} problème(s) détecté(s) (${critical} critique(s), ${high} élevé(s)). ` +
    `Les dimensions les plus exposées sont : ${worst
      .map((d) => `${DIMENSION_LABELS[d.dimension]} (${d.score}/100)`)
      .join(', ')}. ` +
    (critical > 0
      ? 'Priorité absolue : traiter les vulnérabilités critiques (secrets exposés / failles) avant toute mise en production.'
      : 'Aucune vulnérabilité critique : concentrer les efforts sur la réduction de la dette et des dépendances obsolètes.');

  const top10 = topFindings(result, 10).map((f, i) => ({
    rank: i + 1,
    title: f.title,
    severity: f.severity,
    dimension: f.dimension,
    remediation: f.remediation || 'Voir le détail du finding.',
  }));

  const roadmap7d: RoadmapItem[] = topFindings(result, 5).map((f) => ({
    title: `Corriger : ${f.title}`,
    dimension: f.dimension,
    effort: f.severity === 'critical' ? 'M' : 'S',
    impact: f.severity === 'critical' ? 'critical' : f.severity === 'high' ? 'high' : 'medium',
  }));

  const roadmap30d: RoadmapItem[] = worst.map((d) => ({
    title: `Plan d'amélioration ${DIMENSION_LABELS[d.dimension]} (objectif ≥ 85/100)`,
    dimension: d.dimension,
    effort: 'L',
    impact: 'high',
  }));

  return {
    executiveSummary,
    top10,
    roadmap7d,
    roadmap30d,
    model: 'static-template',
    llmGenerated: false,
  };
}

/**
 * Construit le prompt envoyé à Ollama. Le LLM ne voit QUE des faits déjà
 * collectés (findings/scores) — il ne narre, ne priorise et ne synthétise pas
 * d'autres informations. Sortie attendue : JSON strict conforme à Synthesis.
 */
export function buildSynthesisPrompt(result: AuditResult): string {
  const facts = {
    repository: result.repository.fullName,
    globalScore: result.globalScore,
    metrics: result.metrics,
    dimensions: result.dimensions.map((d) => ({
      dimension: d.dimension,
      score: d.score,
      counts: d.counts,
    })),
    topFindings: topFindings(result, 20).map((f) => ({
      severity: f.severity,
      dimension: f.dimension,
      title: f.title,
      file: f.filePath,
      remediation: f.remediation,
    })),
  };

  return `Tu es un CTO chargé d'un audit global. Tu reçois UNIQUEMENT des faits déjà
collectés par des scanners open-source (aucune supposition). Ta mission : fusionner,
dédoublonner, prioriser et produire une synthèse actionnable.

Réponds STRICTEMENT en JSON valide (aucun texte hors JSON), au format :
{
  "executiveSummary": "string (3-6 phrases, en français)",
  "top10": [{"rank": 1, "title": "...", "severity": "critical|high|medium|low|info", "dimension": "security|dependencies|quality|architecture|backend|frontend|performance", "remediation": "..."}],
  "roadmap7d": [{"title": "...", "dimension": "...", "effort": "S|M|L", "impact": "low|medium|high|critical"}],
  "roadmap30d": [{"title": "...", "dimension": "...", "effort": "S|M|L", "impact": "low|medium|high|critical"}]
}

FAITS (JSON) :
${JSON.stringify(facts, null, 2)}
`;
}
