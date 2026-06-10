import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Dimension, Finding, Severity, ToolName } from '@agentic-hub/shared';

export interface ExecResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  /** true si le binaire est introuvable dans le PATH. */
  notFound: boolean;
}

/** Exécute une commande de façon synchrone et capture stdout/stderr. */
export function exec(cmd: string, args: string[], cwd: string, timeoutMs = 600_000): ExecResult {
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    shell: process.platform === 'win32', // permet de résoudre les .cmd/.ps1 sous Windows
  });
  const notFound = !!res.error && (res.error as NodeJS.ErrnoException).code === 'ENOENT';
  return {
    ok: res.status === 0,
    code: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    notFound,
  };
}

/** Vérifie qu'un outil est disponible dans le PATH. */
export function hasTool(bin: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const res = spawnSync(probe, [bin], { encoding: 'utf8', shell: process.platform === 'win32' });
  return res.status === 0;
}

/** Empreinte stable d'un finding (dédoublonnage inter-audits). */
export function fingerprint(parts: (string | number | null | undefined)[]): string {
  return createHash('sha1').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 16);
}

/** Parse JSON en tolérant les sorties vides / bruitées. */
export function tryParseJson<T = unknown>(text: string): T | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Certains outils préfixent des logs : tenter d'isoler le 1er objet/array JSON.
    const start = trimmed.search(/[[{]/);
    if (start > 0) {
      try {
        return JSON.parse(trimmed.slice(start)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
// Heuristiques de dimensionnement (backend / frontend)
// ──────────────────────────────────────────────────────────────

const FRONTEND_RE = /(\.vue$|\.svelte$|\.jsx$|\.tsx$|[\\/](components?|pages|views|ui|src[\\/]app)[\\/])/i;
const BACKEND_RE =
  /([\\/](server|api|routes?|controllers?|services?|middlewares?|repositories?|models?)[\\/]|\.server\.|[\\/]prisma[\\/])/i;

export function isFrontendPath(p: string | null | undefined): boolean {
  return !!p && FRONTEND_RE.test(p);
}
export function isBackendPath(p: string | null | undefined): boolean {
  return !!p && BACKEND_RE.test(p);
}

/**
 * Affine la dimension d'un finding "neutre" (qualité/perf) selon le chemin :
 * un finding qualité dans un fichier frontend devient "frontend", etc.
 * Les findings de sécurité restent en sécurité.
 */
export function refineDimension(base: Dimension, filePath: string | null): Dimension {
  if (base !== 'quality' && base !== 'performance') return base;
  if (isFrontendPath(filePath)) return 'frontend';
  if (isBackendPath(filePath)) return 'backend';
  return base;
}

export function makeFinding(input: {
  dimension: Dimension;
  tool: ToolName;
  severity: Severity;
  title: string;
  ruleId?: string;
  description?: string;
  filePath?: string | null;
  line?: number | null;
  remediation?: string;
  reference?: string | null;
}): Finding {
  const dimension = refineDimension(input.dimension, input.filePath ?? null);
  return {
    dimension,
    tool: input.tool,
    severity: input.severity,
    ruleId: input.ruleId ?? '',
    title: input.title,
    description: input.description ?? '',
    filePath: input.filePath ?? null,
    line: input.line ?? null,
    remediation: input.remediation ?? '',
    reference: input.reference ?? null,
    fingerprint: fingerprint([
      input.tool,
      input.ruleId,
      input.filePath,
      input.line,
      input.title,
    ]),
  };
}

/** Déduplique des findings par empreinte. */
export function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const f of findings) if (!seen.has(f.fingerprint)) seen.set(f.fingerprint, f);
  return [...seen.values()];
}
