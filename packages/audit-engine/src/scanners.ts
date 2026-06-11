import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Finding, ToolName } from '@agentic-hub/shared';
import { exec, hasTool, tryParseJson } from './util.js';
import {
  normalizeDependencyCruiser,
  normalizeDepcheck,
  normalizeEslint,
  normalizeGitleaks,
  normalizeJscpd,
  normalizeMadge,
  normalizeNpmAudit,
  normalizeOsv,
  normalizeSemgrep,
  normalizeTrivy,
} from './normalizers.js';

export interface ScannerOutput {
  tool: ToolName;
  ran: boolean;
  /** Sortie brute (pour traçabilité / ScanArtifact). */
  raw: string;
  findings: Finding[];
  note?: string;
}

/** Sous-dossier de code à analyser (src si présent, sinon racine). */
function codeDir(root: string): string {
  const src = join(root, 'src');
  return existsSync(src) ? src : root;
}

function tmpFile(ext = 'json'): string {
  return join(tmpdir(), `ah-${randomUUID()}.${ext}`);
}

type Runner = (root: string) => ScannerOutput;

// ── Semgrep ───────────────────────────────────────────────────
// Rulesets cibles (pre-caches au build de l'image pour fonctionner offline).
// Surchargeables via SEMGREP_CONFIGS (liste separee par des virgules).
const SEMGREP_CONFIGS = (
  process.env.SEMGREP_CONFIGS ?? 'p/security-audit,p/secrets,p/owasp-top-ten'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const runSemgrep: Runner = (root) => {
  if (!hasTool('semgrep')) return skipped('semgrep');
  const configs = [...SEMGREP_CONFIGS];
  // Règles Semgrep custom du repo (bring-your-own-rules) si présentes.
  const customRules = join(root, '.agentic-hub', 'semgrep');
  if (existsSync(customRules)) configs.push(customRules);
  const configArgs = configs.flatMap((c) => ['--config', c]);
  const res = exec(
    'semgrep',
    ['scan', '--json', '--quiet', '--metrics=off', '--timeout=0', '--disable-version-check', ...configArgs, '.'],
    root,
    900_000,
  );
  const parsed = tryParseJson(res.stdout);
  if (!parsed) {
    return {
      tool: 'semgrep',
      ran: false,
      raw: res.stdout || res.stderr,
      findings: [],
      note: 'Sortie illisible (rulesets non disponibles ?)',
    };
  }
  return { tool: 'semgrep', ran: true, raw: res.stdout, findings: normalizeSemgrep(parsed, root) };
};

// ── Gitleaks ──────────────────────────────────────────────────
const runGitleaks: Runner = (root) => {
  if (!hasTool('gitleaks')) return skipped('gitleaks');
  const out = tmpFile();
  exec(
    'gitleaks',
    ['detect', '--source', root, '--no-git', '--no-banner', '-f', 'json', '-r', out, '--exit-code', '0'],
    root,
  );
  if (!existsSync(out)) return { tool: 'gitleaks', ran: true, raw: '[]', findings: [] };
  const raw = readFileSync(out, 'utf8');
  return { tool: 'gitleaks', ran: true, raw, findings: normalizeGitleaks(tryParseJson(raw) ?? [], root) };
};

// ── Trivy ─────────────────────────────────────────────────────
const runTrivy: Runner = (root) => {
  if (!hasTool('trivy')) return skipped('trivy');
  const res = exec(
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
const runOsv: Runner = (root) => {
  if (!hasTool('osv-scanner')) return skipped('osv-scanner');
  const res = exec('osv-scanner', ['--format', 'json', '--recursive', root], root, 600_000);
  const parsed = tryParseJson(res.stdout);
  if (!parsed) return { tool: 'osv-scanner', ran: true, raw: res.stdout || res.stderr, findings: [] };
  return { tool: 'osv-scanner', ran: true, raw: res.stdout, findings: normalizeOsv(parsed, root) };
};

// ── npm audit (fallback dépendances) ──────────────────────────
const runNpmAudit: Runner = (root) => {
  if (!existsSync(join(root, 'package-lock.json'))) return skipped('npm-audit', 'pas de package-lock.json');
  if (!hasTool('npm')) return skipped('npm-audit');
  const res = exec('npm', ['audit', '--json'], root, 300_000);
  const parsed = tryParseJson(res.stdout);
  if (!parsed) return { tool: 'npm-audit', ran: false, raw: res.stderr, findings: [] };
  return { tool: 'npm-audit', ran: true, raw: res.stdout, findings: normalizeNpmAudit(parsed) };
};

// ── depcheck (dépendances inutilisées / manquantes) ──────────
const runDepcheck: Runner = (root) => {
  if (!existsSync(join(root, 'package.json'))) return skipped('depcheck', 'pas de package.json');
  if (!hasTool('depcheck')) return skipped('depcheck');
  const res = exec('depcheck', ['--json'], root, 180_000);
  const parsed = tryParseJson(res.stdout);
  if (!parsed) return { tool: 'depcheck', ran: false, raw: res.stderr, findings: [] };
  return { tool: 'depcheck', ran: true, raw: res.stdout, findings: normalizeDepcheck(parsed) };
};

// ── ESLint (config embarquée, best-effort sur JS) ─────────────
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

const runEslint: Runner = (root) => {
  // Toolbox ESLint externe (TS/Vue) fournie par l'image via ESLINT_BIN/ESLINT_CONFIG ;
  // sinon fallback sur une config embarquee (JS uniquement).
  const bin = process.env.ESLINT_BIN ?? 'eslint';
  const binName = bin === 'eslint' ? 'eslint' : bin;
  if (bin === 'eslint' && !hasTool('eslint')) return skipped('eslint');

  let cfg = process.env.ESLINT_CONFIG;
  if (!cfg) {
    cfg = tmpFile('mjs');
    writeFileSync(cfg, ESLINT_CONFIG);
  }
  const res = exec(
    binName,
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
const runJscpd: Runner = (root) => {
  if (!hasTool('jscpd')) return skipped('jscpd');
  const outDir = mkdtempSync(join(tmpdir(), 'ah-jscpd-'));
  exec(
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

const runDependencyCruiser: Runner = (root) => {
  if (!hasTool('depcruise') && !hasTool('dependency-cruiser')) return skipped('dependency-cruiser');
  const bin = hasTool('depcruise') ? 'depcruise' : 'dependency-cruiser';
  const cfg = tmpFile('cjs');
  writeFileSync(cfg, DEPCRUISE_CONFIG);
  const target = existsSync(join(root, 'src')) ? 'src' : '.';
  const res = exec(bin, ['--config', cfg, '--output-type', 'json', target], root, 300_000);
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
const runMadge: Runner = (root) => {
  if (!hasTool('madge')) return skipped('madge');
  const target = codeDir(root);
  const res = exec('madge', ['--json', '--circular', target], root, 300_000);
  const parsed = tryParseJson(res.stdout);
  if (!parsed) return { tool: 'madge', ran: false, raw: res.stderr, findings: [] };
  return { tool: 'madge', ran: true, raw: res.stdout, findings: normalizeMadge(parsed) };
};

function skipped(tool: ToolName, note = 'outil non installé'): ScannerOutput {
  return { tool, ran: false, raw: '', findings: [], note };
}

export const RUNNERS: Runner[] = [
  runSemgrep,
  runGitleaks,
  runTrivy,
  runOsv,
  runNpmAudit,
  runDepcheck,
  runEslint,
  runJscpd,
  runDependencyCruiser,
  runMadge,
];

/** Exécute tous les scanners disponibles et agrège leurs sorties. */
export function runAllScanners(root: string, onProgress?: (tool: ToolName) => void): ScannerOutput[] {
  return RUNNERS.map((run) => {
    const out = run(root);
    onProgress?.(out.tool);
    return out;
  });
}
