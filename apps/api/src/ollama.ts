import {
  buildStaticSynthesis,
  buildSynthesisPrompt,
} from '@agentic-hub/audit-engine';
import { SeveritySchema, DimensionSchema, type AuditResult, type Synthesis } from '@agentic-hub/shared';
import { config } from './config.js';

/**
 * Génère la synthèse via Ollama (LLM local gratuit). En cas d'échec ou si Ollama
 * est désactivé/injoignable, retombe sur la synthèse déterministe (gabarit).
 * Le scoring et les findings restent identiques : seule la narration change.
 */
export async function generateSynthesis(result: AuditResult): Promise<Synthesis> {
  const fallback = buildStaticSynthesis(result);
  if (!config.ollama.enabled) return fallback;

  try {
    const prompt = buildSynthesisPrompt(result);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    const res = await fetch(`${config.ollama.url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.ollama.model,
        prompt,
        format: 'json',
        stream: false,
        options: { temperature: 0.2 },
      }),
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) return fallback;
    const data = (await res.json()) as { response?: string };
    const parsed = safeParse(data.response ?? '');
    if (!parsed) return fallback;

    return normalizeLlmSynthesis(parsed, result, config.ollama.model);
  } catch {
    return fallback;
  }
}

function safeParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.search(/[{[]/);
    if (start >= 0) {
      try {
        return JSON.parse(text.slice(start));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Valide/normalise la sortie LLM ; complète les champs manquants depuis le fallback. */
function normalizeLlmSynthesis(raw: any, result: AuditResult, model: string): Synthesis {
  const base = buildStaticSynthesis(result);
  const top10 = Array.isArray(raw.top10)
    ? raw.top10.slice(0, 10).map((t: any, i: number) => ({
        rank: Number(t.rank) || i + 1,
        title: String(t.title ?? 'Problème'),
        severity: SeveritySchema.catch('medium').parse(t.severity),
        dimension: DimensionSchema.catch('quality').parse(t.dimension),
        remediation: String(t.remediation ?? ''),
      }))
    : base.top10;

  const mapRoadmap = (arr: any): typeof base.roadmap7d =>
    Array.isArray(arr)
      ? arr.slice(0, 12).map((r: any) => ({
          title: String(r.title ?? ''),
          dimension: DimensionSchema.optional().catch(undefined).parse(r.dimension),
          effort: ['S', 'M', 'L'].includes(r.effort) ? r.effort : 'M',
          impact: ['low', 'medium', 'high', 'critical'].includes(r.impact) ? r.impact : 'medium',
        }))
      : [];

  return {
    executiveSummary: String(raw.executiveSummary ?? base.executiveSummary),
    top10,
    roadmap7d: mapRoadmap(raw.roadmap7d).length ? mapRoadmap(raw.roadmap7d) : base.roadmap7d,
    roadmap30d: mapRoadmap(raw.roadmap30d).length ? mapRoadmap(raw.roadmap30d) : base.roadmap30d,
    model,
    llmGenerated: true,
  };
}
