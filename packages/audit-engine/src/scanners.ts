import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Finding, ToolName } from '@agentic-hub/shared';
import { execAsync, hasTool, tryParseJson } from './util.js';
import {
  normalizeDependencyCruiser,
  normalizeDepcheck,
  normalizeEslint,
  normalizeGitleaks,
  normalizeJscpd,
  normalizeMadge,
  normalizeNpmAudit,
  normalizeOsv,
  normalizeLighthouse,
  normalizeSemgrep,
  normalizeTrivy,
  normalizeTsPrune,
} from './normalizers.js';

export interface ScannerOutput {
  tool: ToolName;
  ran: boolean;
  /** Sortie brute (pour traçabilité / ScanArtifact). */
  raw: string;
  findings: Finding[];
  note?: string;
}

/** Contexte transmis aux runners (options dynamiques par audit). */
export interface ScanContext {
  /** URL d'une app web déployée pour l'audit Lighthouse (opt-in). */
  lighthouseUrl?: string | null;
}

/** Sous-dossier de code à analyser (src si présent, sinon racine). */
function codeDir(root: string): string {
  const src = join(root, 'src');
  return existsSync(src) ? src : root;
}

function tmpFile(ext = 'json'): string {
  return join(tmpdir(), `ah-${randomUUID()}.${ext}`);
}

type Runner = (root: string, ctx: ScanContext) => Promise<ScannerOutput>;

function skipped(tool: ToolName, note = 'outil non installé'): ScannerOutput {
  return { tool, ran: false, raw: '', findings: [], note };
}

// ── Lighthouse (opt-in : nécessite une URL d'app déployée) ────
const runLighthouse: Runner = async (root, ctx) => {
  const url = ctx.lighthouseUrl?.trim();
  if (!url) return skipped('lighthouse', 'aucune URL Lighthouse configurée');
  if (!hasTool('lighthouse')) return skipped('lighthouse');
  const res = await execAsync(
    'lighthouse',
    [
      url,
      '--quiet',
      '--output=json',
      '--output-path=stdout',
      '--only-categories=performance,accessibility,seo,best-practices',
      '--chrome-flags=--headless --no-sandbox --disable-gpu',
    ],
    root,
    180_000,
  );
  const parsed = tryParseJson(res.stdout);
  if (!parsed) return { tool: 'lighthouse', ran: false, raw: res.stderr, findings: [] };
  return { tool: 'lighthouse', ran: true, raw: res.stdout, findings: normalizeLighthouse(parsed, url) };
};

// ── Semgrep ───────────────────────────────────────────────────
const SEMGREP_CONFIGS = (process.env.SEMGREP_CONFIGS ?? 'p/security-audit,p/secrets,p/owasp-top-ten')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const runSemgrep: Runner = async (root) => {
  if (!hasTool('semgrep')) return skipped('semgrep');
  const configs = [...SEMGREP_CONFIGS];
  const customRules = join(root, '.agentic-hub', 'semgrep');
  if (existsSync(customRules)) configs.push(customRules);
  const configArgs = configs.flatMap((c) => ['--config', c]);
  const res = await execAsync(
    'semgrep',
    ['scan', '--json', '--quiet', '--metrics=off', '--timeout=0', '--disable-version-check', ...configArgs, '.'],
    root,
    900_000,
  );
  const parsed = tryParseJson(res.stdout);
  if (!parsed) {
    return { tool: 'semgrep', ran: false, raw: res.stdout || res.stderr, findings: [], note: 'Sortie illisible' };
  }
  return { tool: 'semgrep', ran: true, raw: res.stdout, findings: normalizeSemgrep(parsed, root) };
};

// ── Gitleaks ──────────────────────────────────────────────────
const runGitleaks: Runner = async (root) => {
  if (!hasTool('gitleaks')) return skipped('gitleaks');
  const out = tmpFile();
  await execAsync(
    'gitleaks',
    ['detect', '--source', root, '--no-git', '--no-banner', '-f', 'json', '-r', out, '--exit-code', '0'],
    root,
  );
  if (!existsSync(out)) return { tool: 'gitleaks', ran: true, raw: '[]', findings: [] };
  const raw = readFileSync(out, 'utf8');
  return { tool: 'gitleaks', ran: true, raw, findings: normalizeGitleaks(tryParseJson(raw) ?? [], root) };
};

// ── Trivy ─────────────────────────────────────────────────────
const runTrivy: Runner = async (root) => {
  if (!hasTool('trivy')) return skipped('trivy');
  const res = await execAsync(
    'trivy',
    ['fs', '--quiet', '--scanners', 'vuln,misconfig,secret,license', '--format', 'json', root],
    root,
    900_000,
  );
  const parsed = tryParseJson(res.stdout);
  if (!parsed) return { tool: 'trivy', ran: false, raw: res.stderr, findings: [] };
  return { tool: 'trivy', ran: true, raw: res.stdout, findings: normalizeTrivy(parsed, root) };
};

// ── OSV-Scanner ───────────────────────────────────────────────
const runOsv: Runner = async (root) => {
  if (!hasTool('osv-scanner')) return skipped('osv-scanner');
  const res = await execAsync('osv-scanner', ['--format', 'json', '--recursive', root], root, 600_000);
  const parsed = tryParseJson(res.stdout);
  if (!parsed) return { tool: 'osv-scanner', ran: true, raw: res.stdout || res.stderr, findings: [] };
  return { tool: 'osv-scanner', ran: true, raw: res.stdout, findings: normalizeOsv(parsed, root) };
};

// ── npm audit (fallback dépendances) ──────────────────────────
const runNpmAudit: Runner = async (root) => {
  if (!existsSync(join(root, 'package-lock.json'))) return skipped('npm-audit', 'pas de package-lock.json');
  if (!hasTool('npm')) return skipped('npm-audit');
  const res = await execAsync('npm', ['audit', '--json'], root, 300_000);
  const parsed = tryParseJson(res.stdout);
  if (!parsed) return { tool: 'npm-audit', ran: false, raw: res.stderr, findings: [] };
  return { tool: 'npm-audit', ran: true, raw: res.stdout, findings: normalizeNpmAudit(parsed) };
};

// ── depcheck (dépendances inutilisées / manquantes) ──────────
const runDepcheck: Runner = async (root) => {
  if (!existsSync(join(root, 'package.json'))) return skipped('depcheck', 'pas de package.json');
  if (!hasTool('depcheck')) return skipped('depcheck');
  const res = await execAsync('depcheck', ['--json'], root, 180_000);
  const parsed = tryParseJson(res.stdout);
  if (!parsed) return { tool: 'depcheck', ran: false, raw: res.stderr, findings: [] };
  return { tool: 'depcheck', ran: true, raw: res.stdout, findings: normalizeDepcheck(parsed) };
};

// ── ts-prune (exports TS inutilisés / code mort) ──────────────
const runTsPrune: Runner = async (root) => {
  if (!existsSync(join(root, 'tsconfig.json'))) return skipped('ts-prune', 'pas de tsconfig.json');
  if (!hasTool('ts-prune')) return skipped('ts-prune');
  const res = await execAsync('ts-prune', [], root, 180_000);
  if (res.notFound) return skipped('ts-prune');
  return { tool: 'ts-prune', ran: true, raw: res.stdout, findings: normalizeTsPrune(res.stdout, root) };
};

// ── ESLint (toolbox TS/Vue via env, sinon fallback JS) ────────
const ESLINT_CONFIG = `import js from '@eslint/js';
export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.min.js', '**/coverage/**', '**/vendor/**'] },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      complexity: ['warn', 12],
      'max-depth': ['warn', 4],
      'max-lines-per-function': ['warn', 80],
      'max-params': ['warn', 5],
      'max-nested-callbacks': ['warn', 4],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-var': 'warn',
      eqeqeq: 'warn',
    },
  },
];
`;

const runEslint: Runner = async (root) => {
  const bin = process.env.ESLINT_BIN ?? 'eslint';
  if (bin === 'eslint' && !hasTool('eslint')) return skipped('eslint');
  let cfg = process.env.ESLINT_CONFIG;
  if (!cfg) {
    cfg = tmpFile('mjs');
    writeFileSync(cfg, ESLINT_CONFIG);
  }
  const res = await execAsync(
    bin,
    ['--no-config-lookup', '--config', cfg, '--format', 'json', '--no-error-on-unmatched-pattern', '.'],
    root,
    300_000,
  );
  if (res.notFound) return skipped('eslint');
  const parsed = tryParseJson(res.stdout);
  if (!parsed) return { tool: 'eslint', ran: false, raw: res.stderr, findings: [] };
  return { tool: 'eslint', ran: true, raw: res.stdout, findings: normalizeEslint(parsed, root) };
};

// ── jscpd (duplication) ───────────────────────────────────────
const runJscpd: Runner = async (root) => {
  if (!hasTool('jscpd')) return skipped('jscpd');
  const outDir = mkdtempSync(join(tmpdir(), 'ah-jscpd-'));
  await execAsync(
    'jscpd',
    ['--silent', '--reporters', 'json', '--output', outDir, '--ignore', '**/node_modules/**,**/dist/**', root],
    root,
    300_000,
  );
  const report = join(outDir, 'jscpd-report.json');
  if (!existsSync(report)) return { tool: 'jscpd', ran: true, raw: '{}', findings: [] };
  const raw = readFileSync(report, 'utf8');
  return { tool: 'jscpd', ran: true, raw, findings: normalizeJscpd(tryParseJson(raw) ?? {}, root) };
};

// ── dependency-cruiser (architecture) ─────────────────────────
const DEPCRUISE_CONFIG = `module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'no-orphans', severity: 'warn', from: { orphan: true, pathNot: '\\\\.(d\\\\.ts|json)$' }, to: {} },
    { name: 'not-to-dev-dep', severity: 'error', from: { pathNot: '\\\\.(spec|test)\\\\.' }, to: { dependencyTypes: ['npm-dev'] } },
  ],
  options: { doNotFollow: { path: 'node_modules' }, tsConfig: {} },
};
`;

const runDependencyCruiser: Runner = async (root) => {
  if (!hasTool('depcruise') && !hasTool('dependency-cruiser')) return skipped('dependency-cruiser');
  const bin = hasTool('depcruise') ? 'depcruise' : 'dependency-cruiser';
  const cfg = tmpFile('cjs');
  writeFileSync(cfg, DEPCRUISE_CONFIG);
  const target = existsSync(join(root, 'src')) ? 'src' : '.';
  const res = await execAsync(bin, ['--config', cfg, '--output-type', 'json', target], root, 300_000);
  const parsed = tryParseJson(res.stdout);
  if (!parsed) return { tool: 'dependency-cruiser', ran: false, raw: res.stderr, findings: [] };
  return {
    tool: 'dependency-cruiser',
    ran: true,
    raw: res.stdout,
    findings: normalizeDependencyCruiser(parsed, root),
  };
};

// ── madge (cycles) ────────────────────────────────────────────
const runMadge: Runner = async (root) => {
  if (!hasTool('madge')) return skipped('madge');
  const res = await execAsync('madge', ['--json', '--circular', codeDir(root)], root, 300_000);
  const parsed = tryParseJson(res.stdout);
  if (!parsed) return { tool: 'madge', ran: false, raw: res.stderr, findings: [] };
  return { tool: 'madge', ran: true, raw: res.stdout, findings: normalizeMadge(parsed) };
};

export const RUNNERS: Runner[] = [
  runSemgrep,
  runGitleaks,
  runTrivy,
  runOsv,
  runNpmAudit,
  runDepcheck,
  runTsPrune,
  runEslint,
  runJscpd,
  runDependencyCruiser,
  runMadge,
  runLighthouse,
];

/** Concurrence par défaut (équilibre vitesse / charge CPU-mémoire). */
const DEFAULT_CONCURRENCY = Number(process.env.SCAN_CONCURRENCY ?? 4);

/**
 * Exécute tous les scanners disponibles EN PARALLÈLE (pool borné) et agrège
 * leurs sorties. Bien plus rapide que l'exécution séquentielle.
 */
export async function runAllScanners(
  root: string,
  ctx: ScanContext = {},
  onProgress?: (tool: ToolName) => void,
  concurrency = DEFAULT_CONCURRENCY,
): Promise<ScannerOutput[]> {
  const results: ScannerOutput[] = new Array(RUNNERS.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= RUNNERS.length) return;
      try {
        const out = await RUNNERS[i]!(root, ctx);
        results[i] = out;
        onProgress?.(out.tool);
      } catch {
        results[i] = { tool: 'engine', ran: false, raw: '', findings: [], note: 'erreur runner' };
      }
    }
  }

  const pool = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(pool);
  return results;
}
