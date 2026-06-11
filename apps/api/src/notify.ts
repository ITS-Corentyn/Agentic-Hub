import { prisma } from '@agentic-hub/db';
import { NotifyConfigSchema, type AuditResult, type GateResult } from '@agentic-hub/shared';

/** Envoie un message vers un webhook compatible Slack / Mattermost / Discord. */
async function postWebhook(url: string, text: string): Promise<void> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10_000);
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `text` (Slack/Mattermost) + `content` (Discord) : compatible large.
      body: JSON.stringify({ text, content: text }),
      signal: controller.signal,
    }).finally(() => clearTimeout(t));
  } catch {
    /* notification best-effort */
  }
}

/**
 * Notifie selon la config (mode) à la fin d'un audit.
 * - always : toujours ;
 * - critical : s'il existe au moins un finding critique ;
 * - score-drop : si le score a baissé vs l'audit précédent.
 */
export async function notifyAuditDone(params: {
  result: AuditResult;
  gate: GateResult;
  previousScore: number | null;
  repoFullName: string;
}): Promise<void> {
  const setting = await prisma.setting.findUnique({ where: { id: 1 } });
  const cfg = NotifyConfigSchema.safeParse(setting?.notify);
  if (!cfg.success || cfg.data.mode === 'off' || !cfg.data.webhookUrl) return;

  const { result, gate, previousScore } = params;
  const critical = result.findings.filter((f) => f.severity === 'critical').length;
  const scoreDropped = previousScore != null && result.globalScore < previousScore;

  let should = false;
  switch (cfg.data.mode) {
    case 'always':
      should = true;
      break;
    case 'critical':
      should = critical > 0 || !gate.passed;
      break;
    case 'score-drop':
      should = scoreDropped || !gate.passed;
      break;
  }
  if (!should) return;

  const trend =
    previousScore != null
      ? ` (précédent ${previousScore}, ${result.globalScore - previousScore >= 0 ? '+' : ''}${
          Math.round((result.globalScore - previousScore) * 10) / 10
        })`
      : '';
  const gateLine = gate.passed ? '✅ Gate OK' : `❌ Gate KO — ${gate.reasons.join(' ; ')}`;
  const text =
    `*Agentic-Hub* — audit de *${params.repoFullName}*\n` +
    `Score : *${result.globalScore}/100*${trend}\n` +
    `Findings : ${result.findings.length} (${critical} critique(s))\n` +
    gateLine;

  await postWebhook(cfg.data.webhookUrl, text);
}
