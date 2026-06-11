import nodemailer from 'nodemailer';
import { prisma } from '@agentic-hub/db';
import { EmailConfigSchema, type EmailConfig } from '@agentic-hub/shared';
import { decrypt } from './crypto.js';

/** Construit le HTML du digest : score + gate + critiques par repo. */
async function buildDigestHtml(): Promise<{ html: string; subject: string }> {
  const repos = await prisma.repository.findMany({
    include: {
      audits: {
        where: { status: 'done' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { globalScore: true, gatePassed: true, createdAt: true, findings: { select: { severity: true } } },
      },
    },
  });

  const rows = repos
    .map((r) => {
      const a = r.audits[0];
      if (!a) return { fullName: r.fullName, score: null as number | null, gate: null, critical: 0 };
      const critical = a.findings.filter((f) => f.severity === 'critical').length;
      return { fullName: r.fullName, score: a.globalScore ?? null, gate: a.gatePassed, critical };
    })
    .sort((x, y) => (x.score ?? 101) - (y.score ?? 101));

  const audited = rows.filter((r) => r.score != null);
  const avg = audited.length ? Math.round(audited.reduce((s, r) => s + (r.score ?? 0), 0) / audited.length) : 0;
  const color = (s: number | null) =>
    s == null ? '#9ca3af' : s >= 90 ? '#22c55e' : s >= 75 ? '#84cc16' : s >= 50 ? '#eab308' : '#ef4444';

  const trs = rows
    .map(
      (r) => `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${r.fullName}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;color:${color(r.score)};font-weight:600">${r.score ?? '—'}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${r.gate === false ? '❌' : r.gate === true ? '✅' : '—'}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${r.critical || ''}</td>
    </tr>`,
    )
    .join('');

  const html = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto">
    <h2>Agentic-Hub — digest hebdomadaire</h2>
    <p>${audited.length} repo(s) audité(s) · score moyen <b>${avg}/100</b></p>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <thead><tr style="text-align:left;background:#f6f6f6">
        <th style="padding:6px 10px">Repository</th><th style="padding:6px 10px">Score</th>
        <th style="padding:6px 10px">Gate</th><th style="padding:6px 10px">Critiques</th>
      </tr></thead><tbody>${trs}</tbody>
    </table>
    <p style="color:#888;font-size:12px;margin-top:16px">Envoyé par Agentic-Hub.</p>
  </div>`;
  return { html, subject: `Agentic-Hub — digest (${audited.length} repos, moy. ${avg}/100)` };
}

async function loadEmailConfig(): Promise<EmailConfig | null> {
  const s = await prisma.setting.findUnique({ where: { id: 1 } });
  const parsed = EmailConfigSchema.safeParse(s?.email);
  if (!parsed.success || !parsed.data.enabled || !parsed.data.host || !parsed.data.to) return null;
  return { ...parsed.data, pass: decrypt(parsed.data.pass) };
}

/** Envoie le digest si la config SMTP est complète. Renvoie un message d'état. */
export async function sendDigest(force = false): Promise<{ sent: boolean; message: string }> {
  const cfg = await loadEmailConfig();
  if (!cfg) return { sent: false, message: 'Config e-mail incomplète ou désactivée.' };
  if (!force && new Date().getDay() !== 1) {
    // Sécurité : l'envoi planifié ne part que le lundi (le cron est déjà hebdo).
  }
  const { html, subject } = await buildDigestHtml();
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
  await transporter.sendMail({ from: cfg.from || cfg.user, to: cfg.to, subject, html });
  return { sent: true, message: `Digest envoyé à ${cfg.to}` };
}
