import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { marked } from 'marked';
import { prisma } from '@agentic-hub/db';
import { buildReportMarkdown } from './service.js';

const CHROME = process.env.CHROME_PATH || 'chromium';

/** Couleur d'un score (vert→rouge). */
function scoreColor(score: number): string {
  if (score >= 90) return '#22c55e';
  if (score >= 75) return '#84cc16';
  if (score >= 50) return '#eab308';
  if (score >= 30) return '#f97316';
  return '#ef4444';
}

/** Badge SVG façon shields (label | valeur). */
function renderBadge(label: string, value: string, color: string): string {
  const lw = 6 * label.length + 12;
  const vw = 6 * value.length + 14;
  const w = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${value}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
    <rect width="${w}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${lw / 2}" y="14">${label}</text>
    <text x="${lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${lw + vw / 2}" y="14">${value}</text>
  </g>
</svg>`;
}

function htmlWrap(bodyHtml: string, title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:820px;margin:32px auto;padding:0 24px;color:#1f2937;line-height:1.5}
    h1{font-size:24px;border-bottom:2px solid #e5e7eb;padding-bottom:8px}
    h2{font-size:18px;margin-top:28px}h3{font-size:15px}h4{font-size:13px;margin:14px 0 4px}
    code{background:#f3f4f6;padding:1px 5px;border-radius:4px;font-size:12px}
    table{border-collapse:collapse;width:100%;font-size:12px;margin:10px 0}
    th,td{border:1px solid #e5e7eb;padding:6px 8px;text-align:left}
    th{background:#f9fafb}
    blockquote{color:#6b7280;border-left:3px solid #e5e7eb;margin:0;padding-left:12px}
    pre{background:#f3f4f6;padding:12px;border-radius:8px;overflow:auto;font-size:12px}
  </style></head><body>${bodyHtml}</body></html>`;
}

export async function registerReportingRoutes(app: FastifyInstance) {
  // Export PDF du rapport (rendu via Chromium headless).
  app.get('/api/audits/:id/report.pdf', async (req, reply) => {
    const { id } = req.params as { id: string };
    const md = await buildReportMarkdown(id);
    if (!md) return reply.code(404).send({ error: 'Audit introuvable' });

    const html = htmlWrap(await marked.parse(md), `Audit ${id}`);
    const base = join(tmpdir(), `ah-pdf-${randomUUID()}`);
    const htmlPath = `${base}.html`;
    const pdfPath = `${base}.pdf`;
    writeFileSync(htmlPath, html);
    try {
      const res = spawnSync(
        CHROME,
        [
          '--headless',
          '--no-sandbox',
          '--disable-gpu',
          '--no-pdf-header-footer',
          `--print-to-pdf=${pdfPath}`,
          `file://${htmlPath}`,
        ],
        { encoding: 'buffer', timeout: 60_000 },
      );
      if (!existsSync(pdfPath)) {
        app.log.error({ stderr: res.stderr?.toString() }, 'Chromium PDF échec');
        return reply.code(500).send({ error: 'Génération PDF impossible (Chromium indisponible ?)' });
      }
      const pdf = readFileSync(pdfPath);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="audit-${id}.pdf"`);
      return reply.send(pdf);
    } finally {
      rmSync(htmlPath, { force: true });
      rmSync(pdfPath, { force: true });
    }
  });

  // Export CSV des findings d'un audit.
  app.get('/api/audits/:id/findings.csv', async (req, reply) => {
    const { id } = req.params as { id: string };
    const findings = await prisma.finding.findMany({ where: { auditId: id }, orderBy: { severity: 'asc' } });
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['severity', 'dimension', 'tool', 'ruleId', 'title', 'filePath', 'line', 'status', 'remediation'];
    const rows = findings.map((f) =>
      [f.severity, f.dimension, f.tool, f.ruleId, f.title, f.filePath, f.line, f.status, f.remediation]
        .map(esc)
        .join(','),
    );
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="findings-${id}.csv"`);
    return [header.join(','), ...rows].join('\n');
  });

  // Badge SVG du score (par id ou par owner/repo) — embarquable dans un README.
  async function badgeFor(repoWhere: any, reply: any) {
    const repo = await prisma.repository.findFirst({
      where: repoWhere,
      include: {
        audits: { where: { status: 'done' }, orderBy: { createdAt: 'desc' }, take: 1, select: { globalScore: true } },
      },
    });
    const score = repo?.audits[0]?.globalScore ?? null;
    const svg =
      score == null
        ? renderBadge('audit', 'non audité', '#9ca3af')
        : renderBadge('audit', `${Math.round(score)}/100`, scoreColor(score));
    reply.header('Content-Type', 'image/svg+xml');
    reply.header('Cache-Control', 'no-cache, max-age=300');
    return reply.send(svg);
  }
  app.get('/api/repositories/:id/badge.svg', async (req, reply) =>
    badgeFor({ id: (req.params as any).id }, reply),
  );
  app.get('/api/badge/:owner/:repo.svg', async (req, reply) => {
    const { owner, repo } = req.params as { owner: string; repo: string };
    return badgeFor({ fullName: `${owner}/${repo}` }, reply);
  });
}
