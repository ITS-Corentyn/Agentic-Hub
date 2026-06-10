import {
  DIMENSION_LABELS,
  SEVERITIES,
  SEVERITY_RANK,
  type AuditResult,
  type Dimension,
  type Finding,
  type Severity,
  type Synthesis,
} from '@agentic-hub/shared';

const SEV_EMOJI: Record<Severity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
  info: '⚪',
};

function scoreBadge(score: number): string {
  if (score >= 90) return `🟢 ${score}/100`;
  if (score >= 75) return `🟡 ${score}/100`;
  if (score >= 50) return `🟠 ${score}/100`;
  return `🔴 ${score}/100`;
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      (a.filePath ?? '').localeCompare(b.filePath ?? ''),
  );
}

function findingBlock(f: Finding): string {
  const loc = f.filePath ? `\`${f.filePath}${f.line ? `:${f.line}` : ''}\`` : '—';
  const lines = [
    `#### ${SEV_EMOJI[f.severity]} ${f.title}`,
    '',
    `- **Sévérité** : ${f.severity}`,
    `- **Outil** : ${f.tool}${f.ruleId ? ` (\`${f.ruleId}\`)` : ''}`,
    `- **Emplacement** : ${loc}`,
  ];
  if (f.description) lines.push(`- **Description** : ${f.description.replace(/\n+/g, ' ').trim()}`);
  if (f.remediation) lines.push(`- **✅ Correctif** : ${f.remediation}`);
  if (f.reference) lines.push(`- **Référence** : ${f.reference}`);
  return lines.join('\n');
}

/**
 * Génère un rapport Markdown complet et détaillé pour un repository :
 * synthèse exécutive, scores, top problèmes, détails par dimension, remédiations.
 */
export function generateReport(
  result: AuditResult,
  synthesis?: Synthesis | null,
  proposedDependabot?: string,
): string {
  const md: string[] = [];
  const repo = result.repository.fullName;

  md.push(`# Rapport d'audit — ${repo}`);
  md.push('');
  md.push(
    `> Généré le ${new Date(result.generatedAt).toLocaleString('fr-FR')}${
      result.commitSha ? ` · commit \`${result.commitSha.slice(0, 8)}\`` : ''
    }`,
  );
  md.push('');
  md.push(`## 🎯 Score global : ${scoreBadge(result.globalScore)}`);
  md.push('');

  // Tableau des scores par dimension
  md.push('| Dimension | Score | Résumé |');
  md.push('|---|---|---|');
  for (const d of result.dimensions) {
    md.push(`| ${DIMENSION_LABELS[d.dimension]} | ${scoreBadge(d.score)} | ${d.summary} |`);
  }
  md.push('');

  // Métriques & couverture
  md.push('### 📊 Métriques & couverture');
  md.push('');
  md.push(
    `- **Code analysé** : ${result.metrics.loc.toLocaleString('fr-FR')} lignes, ${result.metrics.files} fichiers`,
  );
  md.push(`- **Langages** : ${result.metrics.languages.join(', ') || '—'}`);
  md.push(`- **Outils exécutés** : ${result.toolsRun.join(', ') || '—'}`);
  if (result.toolsSkipped.length) {
    md.push(`- **Outils ignorés** (non disponibles) : ${result.toolsSkipped.join(', ')}`);
  }
  md.push('');

  // Synthèse LLM (ou gabarit)
  if (synthesis) {
    md.push('## 🧭 Synthèse exécutive');
    md.push('');
    md.push(synthesis.executiveSummary);
    md.push('');
    if (synthesis.top10.length) {
      md.push('### 🔝 Top problèmes prioritaires');
      md.push('');
      md.push('| # | Problème | Sévérité | Dimension | Correctif |');
      md.push('|---|---|---|---|---|');
      for (const t of synthesis.top10) {
        md.push(
          `| ${t.rank} | ${t.title} | ${SEV_EMOJI[t.severity]} ${t.severity} | ${DIMENSION_LABELS[t.dimension]} | ${t.remediation} |`,
        );
      }
      md.push('');
    }
    if (synthesis.roadmap7d.length || synthesis.roadmap30d.length) {
      md.push('### 🗺️ Roadmap');
      md.push('');
      md.push('**7 jours**');
      for (const r of synthesis.roadmap7d) md.push(`- [ ] ${r.title} _(effort ${r.effort}, impact ${r.impact})_`);
      md.push('');
      md.push('**30 jours**');
      for (const r of synthesis.roadmap30d) md.push(`- [ ] ${r.title} _(effort ${r.effort}, impact ${r.impact})_`);
      md.push('');
    }
    md.push(
      `_Synthèse ${synthesis.llmGenerated ? `générée par le modèle local \`${synthesis.model}\`` : 'générée par gabarit statique (LLM désactivé)'}._`,
    );
    md.push('');
  }

  // Détail par dimension
  md.push('## 🔍 Détail des problèmes par dimension');
  md.push('');
  const byDim = groupByDimension(result.findings);
  for (const d of result.dimensions) {
    const findings = sortFindings(byDim.get(d.dimension) ?? []);
    md.push(`### ${DIMENSION_LABELS[d.dimension]} — ${scoreBadge(d.score)}`);
    md.push('');
    if (!findings.length) {
      md.push('_Aucun problème détecté._');
      md.push('');
      continue;
    }
    md.push(severityCountLine(findings));
    md.push('');
    for (const f of findings) {
      md.push(findingBlock(f));
      md.push('');
    }
  }

  // Dependabot proposé
  if (proposedDependabot) {
    md.push('## 🤖 Configuration Dependabot proposée');
    md.push('');
    md.push('À placer dans `.github/dependabot.yml` :');
    md.push('');
    md.push('```yaml');
    md.push(proposedDependabot.trimEnd());
    md.push('```');
    md.push('');
  }

  md.push('---');
  md.push('_Rapport produit par Agentic-Hub — audit 100 % open-source, sans API payante._');
  return md.join('\n');
}

function groupByDimension(findings: Finding[]): Map<Dimension, Finding[]> {
  const map = new Map<Dimension, Finding[]>();
  for (const f of findings) {
    const arr = map.get(f.dimension) ?? [];
    arr.push(f);
    map.set(f.dimension, arr);
  }
  return map;
}

function severityCountLine(findings: Finding[]): string {
  const counts = SEVERITIES.map((s) => {
    const n = findings.filter((f) => f.severity === s).length;
    return n ? `${SEV_EMOJI[s]} ${n} ${s}` : null;
  }).filter(Boolean);
  return counts.join(' · ');
}
