import { relative } from 'node:path';
import type { Finding, Severity } from '@agentic-hub/shared';
import { makeFinding } from './util.js';

/** Convertit un chemin absolu en chemin relatif au repo (lisible dans le rapport). */
function rel(root: string, p: string | null | undefined): string | null {
  if (!p) return null;
  try {
    const r = relative(root, p);
    return r && !r.startsWith('..') ? r.replace(/\\/g, '/') : p.replace(/\\/g, '/');
  } catch {
    return p;
  }
}

// ──────────────────────────────────────────────────────────────
// Semgrep — SAST (sécurité principalement)
// ──────────────────────────────────────────────────────────────
const SEMGREP_SEVERITY: Record<string, Severity> = {
  ERROR: 'high',
  WARNING: 'medium',
  INFO: 'low',
};

export function normalizeSemgrep(raw: any, root: string): Finding[] {
  const results = raw?.results;
  if (!Array.isArray(results)) return [];
  return results.map((r: any) => {
    const meta = r.extra?.metadata ?? {};
    const sevRaw = (meta.severity ?? r.extra?.severity ?? 'WARNING').toString().toUpperCase();
    const severity: Severity =
      sevRaw === 'CRITICAL' ? 'critical' : (SEMGREP_SEVERITY[sevRaw] ?? 'medium');
    const ref = Array.isArray(meta.references) ? meta.references[0] : (meta.source ?? null);
    return makeFinding({
      dimension: 'security',
      tool: 'semgrep',
      severity,
      ruleId: r.check_id ?? '',
      title: meta.shortDescription ?? r.extra?.message?.split('\n')[0] ?? r.check_id ?? 'Problème détecté',
      description: r.extra?.message ?? '',
      filePath: rel(root, r.path),
      line: r.start?.line ?? null,
      remediation:
        meta.fix ?? r.extra?.fix ?? "Corriger le motif signalé selon la règle Semgrep (voir la référence).",
      reference: ref ?? null,
    });
  });
}

// ──────────────────────────────────────────────────────────────
// Gitleaks — secrets
// ──────────────────────────────────────────────────────────────
export function normalizeGitleaks(raw: any, root: string): Finding[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s: any) =>
    makeFinding({
      dimension: 'security',
      tool: 'gitleaks',
      severity: 'critical',
      ruleId: s.RuleID ?? s.rule ?? 'secret',
      title: `Secret potentiel exposé : ${s.Description ?? s.RuleID ?? 'credential'}`,
      description: `Une chaîne ressemblant à un secret (${s.RuleID ?? 'secret'}) a été détectée${
        s.Commit ? ` au commit ${String(s.Commit).slice(0, 8)}` : ''
      }.`,
      filePath: rel(root, s.File),
      line: s.StartLine ?? null,
      remediation:
        "Révoquer immédiatement le secret, le retirer du code et de l'historique git (git filter-repo), puis le stocker dans un coffre-fort / variable d'environnement.",
      reference: null,
    }),
  );
}

// ──────────────────────────────────────────────────────────────
// Trivy — vulnérabilités de dépendances + misconfig + secrets
// ──────────────────────────────────────────────────────────────
const TRIVY_SEVERITY: Record<string, Severity> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  UNKNOWN: 'info',
};

export function normalizeTrivy(raw: any, root: string): Finding[] {
  const out: Finding[] = [];
  const results = raw?.Results;
  if (!Array.isArray(results)) return out;
  for (const r of results) {
    const target = r.Target ?? '';
    for (const v of r.Vulnerabilities ?? []) {
      out.push(
        makeFinding({
          dimension: 'dependencies',
          tool: 'trivy',
          severity: TRIVY_SEVERITY[(v.Severity ?? 'UNKNOWN').toUpperCase()] ?? 'info',
          ruleId: v.VulnerabilityID ?? '',
          title: `${v.PkgName}@${v.InstalledVersion} — ${v.VulnerabilityID}`,
          description: v.Title ?? v.Description ?? '',
          filePath: rel(root, target),
          line: null,
          remediation: v.FixedVersion
            ? `Mettre à jour ${v.PkgName} vers ${v.FixedVersion} ou une version ultérieure.`
            : `Aucun correctif publié : surveiller l'advisory, isoler ou remplacer ${v.PkgName}.`,
          reference: v.PrimaryURL ?? null,
        }),
      );
    }
    for (const m of r.Misconfigurations ?? []) {
      out.push(
        makeFinding({
          dimension: 'security',
          tool: 'trivy',
          severity: TRIVY_SEVERITY[(m.Severity ?? 'UNKNOWN').toUpperCase()] ?? 'low',
          ruleId: m.ID ?? '',
          title: m.Title ?? m.ID ?? 'Mauvaise configuration',
          description: m.Description ?? '',
          filePath: rel(root, target),
          line: m.CauseMetadata?.StartLine ?? null,
          remediation: m.Resolution ?? 'Corriger la configuration selon la recommandation Trivy.',
          reference: Array.isArray(m.References) ? m.References[0] : null,
        }),
      );
    }
    for (const s of r.Secrets ?? []) {
      out.push(
        makeFinding({
          dimension: 'security',
          tool: 'trivy',
          severity: 'critical',
          ruleId: s.RuleID ?? 'secret',
          title: `Secret détecté : ${s.Title ?? s.RuleID}`,
          description: s.Match ?? '',
          filePath: rel(root, target),
          line: s.StartLine ?? null,
          remediation: 'Révoquer et retirer le secret ; utiliser un gestionnaire de secrets.',
          reference: null,
        }),
      );
    }
    for (const l of r.Licenses ?? []) {
      out.push(
        makeFinding({
          dimension: 'dependencies',
          tool: 'trivy',
          severity: TRIVY_SEVERITY[(l.Severity ?? 'LOW').toUpperCase()] ?? 'low',
          ruleId: `license-${l.Name ?? 'unknown'}`,
          title: `Licence ${l.Name ?? 'inconnue'} — ${l.PkgName ?? l.FilePath ?? ''}`,
          description: `Licence ${l.Name ?? 'inconnue'} (catégorie ${l.Category ?? 'n/a'}) détectée${
            l.PkgName ? ` sur ${l.PkgName}` : ''
          }.`,
          filePath: rel(root, l.FilePath ?? target),
          line: null,
          remediation:
            "Vérifier la compatibilité de cette licence avec ton usage (copyleft/commercial) ; remplacer la dépendance si nécessaire.",
          reference: l.Link ?? null,
        }),
      );
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// depcheck — dépendances inutilisées / manquantes (deps + qualité)
// ──────────────────────────────────────────────────────────────
export function normalizeDepcheck(raw: any): Finding[] {
  const out: Finding[] = [];
  const unused: string[] = [...(raw?.dependencies ?? []), ...(raw?.devDependencies ?? [])];
  for (const dep of unused) {
    out.push(
      makeFinding({
        dimension: 'dependencies',
        tool: 'depcheck',
        severity: 'low',
        ruleId: 'unused-dependency',
        title: `Dépendance inutilisée : ${dep}`,
        description: `La dépendance \`${dep}\` est déclarée mais ne semble pas utilisée.`,
        filePath: 'package.json',
        line: null,
        remediation: `Retirer \`${dep}\` du package.json (allège le bundle et la surface d'attaque).`,
        reference: null,
      }),
    );
  }
  const missing = raw?.missing ?? {};
  for (const dep of Object.keys(missing)) {
    out.push(
      makeFinding({
        dimension: 'dependencies',
        tool: 'depcheck',
        severity: 'medium',
        ruleId: 'missing-dependency',
        title: `Dépendance manquante : ${dep}`,
        description: `\`${dep}\` est importée mais absente du package.json.`,
        filePath: 'package.json',
        line: null,
        remediation: `Ajouter \`${dep}\` aux dépendances déclarées.`,
        reference: null,
      }),
    );
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// OSV-Scanner — vulnérabilités de dépendances (lockfiles)
// ──────────────────────────────────────────────────────────────
export function normalizeOsv(raw: any, root: string): Finding[] {
  const out: Finding[] = [];
  for (const res of raw?.results ?? []) {
    const source = res.source?.path ?? '';
    for (const pkg of res.packages ?? []) {
      const name = pkg.package?.name ?? 'pkg';
      const version = pkg.package?.version ?? '';
      for (const v of pkg.vulnerabilities ?? []) {
        const sevText = (v.database_specific?.severity ?? '').toUpperCase();
        const severity: Severity =
          sevText === 'CRITICAL'
            ? 'critical'
            : sevText === 'HIGH'
              ? 'high'
              : sevText === 'MODERATE' || sevText === 'MEDIUM'
                ? 'medium'
                : 'low';
        const fixed = (pkg.groups ?? []).length ? '' : '';
        void fixed;
        out.push(
          makeFinding({
            dimension: 'dependencies',
            tool: 'osv-scanner',
            severity,
            ruleId: v.id ?? '',
            title: `${name}@${version} — ${v.id}`,
            description: v.summary ?? v.details?.slice(0, 280) ?? '',
            filePath: rel(root, source),
            line: null,
            remediation: `Mettre à jour ${name} vers une version corrigée (voir l'advisory ${v.id}).`,
            reference: `https://osv.dev/vulnerability/${v.id}`,
          }),
        );
      }
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// npm audit — fallback dépendances JS
// ──────────────────────────────────────────────────────────────
export function normalizeNpmAudit(raw: any): Finding[] {
  const out: Finding[] = [];
  const vulns = raw?.vulnerabilities;
  if (!vulns || typeof vulns !== 'object') return out;
  for (const [name, info] of Object.entries<any>(vulns)) {
    const severity: Severity =
      info.severity === 'critical'
        ? 'critical'
        : info.severity === 'high'
          ? 'high'
          : info.severity === 'moderate'
            ? 'medium'
            : 'low';
    const via = Array.isArray(info.via)
      ? info.via.find((v: any) => typeof v === 'object')
      : undefined;
    out.push(
      makeFinding({
        dimension: 'dependencies',
        tool: 'npm-audit',
        severity,
        ruleId: via?.source ? String(via.source) : name,
        title: `${name} — ${via?.title ?? 'dépendance vulnérable'}`,
        description: via?.title ?? `Dépendance ${name} signalée vulnérable par npm audit.`,
        filePath: 'package.json',
        line: null,
        remediation: info.fixAvailable
          ? `Exécuter \`npm audit fix\`${info.fixAvailable?.isSemVerMajor ? ' --force (changement majeur)' : ''} ou mettre à jour ${name}.`
          : `Aucun correctif automatique : remplacer ou isoler ${name}.`,
        reference: via?.url ?? null,
      }),
    );
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// ESLint — qualité / complexité (perf) / sécurité ponctuelle
// ──────────────────────────────────────────────────────────────
const ESLINT_PERF_RULES = new Set([
  'complexity',
  'max-depth',
  'max-lines',
  'max-lines-per-function',
  'max-nested-callbacks',
  'max-params',
]);
const ESLINT_SECURITY_RULES = new Set(['no-eval', 'no-implied-eval', 'no-new-func']);

export function normalizeEslint(raw: any, root: string): Finding[] {
  if (!Array.isArray(raw)) return [];
  const out: Finding[] = [];
  for (const file of raw) {
    for (const m of file.messages ?? []) {
      if (!m.ruleId) continue; // ignore erreurs de parsing
      const dimension = ESLINT_SECURITY_RULES.has(m.ruleId)
        ? 'security'
        : ESLINT_PERF_RULES.has(m.ruleId)
          ? 'performance'
          : 'quality';
      const severity: Severity = m.severity === 2 ? 'medium' : 'low';
      out.push(
        makeFinding({
          dimension,
          tool: 'eslint',
          severity,
          ruleId: m.ruleId,
          title: m.message,
          description: `Règle ESLint \`${m.ruleId}\` déclenchée.`,
          filePath: rel(root, file.filePath),
          line: m.line ?? null,
          remediation: `Corriger le code pour respecter la règle \`${m.ruleId}\` (refactor / simplification).`,
          reference: `https://eslint.org/docs/latest/rules/${m.ruleId}`,
        }),
      );
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// jscpd — duplication de code (qualité)
// ──────────────────────────────────────────────────────────────
export function normalizeJscpd(raw: any, root: string): Finding[] {
  const out: Finding[] = [];
  for (const d of raw?.duplicates ?? []) {
    const lines = d.lines ?? 0;
    const severity: Severity = lines > 120 ? 'high' : lines > 40 ? 'medium' : 'low';
    out.push(
      makeFinding({
        dimension: 'quality',
        tool: 'jscpd',
        severity,
        ruleId: 'duplication',
        title: `Duplication de ${lines} lignes`,
        description: `Bloc dupliqué entre ${d.firstFile?.name} et ${d.secondFile?.name}.`,
        filePath: rel(root, d.firstFile?.name),
        line: d.firstFile?.start ?? null,
        remediation:
          'Extraire le code dupliqué dans une fonction/module partagé (principe DRY).',
        reference: null,
      }),
    );
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// dependency-cruiser — règles d'architecture / couplage
// ──────────────────────────────────────────────────────────────
export function normalizeDependencyCruiser(raw: any, root: string): Finding[] {
  const out: Finding[] = [];
  const violations = raw?.summary?.violations ?? [];
  for (const v of violations) {
    const sev = (v.rule?.severity ?? 'warn').toLowerCase();
    const severity: Severity = sev === 'error' ? 'high' : sev === 'warn' ? 'medium' : 'low';
    out.push(
      makeFinding({
        dimension: 'architecture',
        tool: 'dependency-cruiser',
        severity,
        ruleId: v.rule?.name ?? 'dependency-rule',
        title: `Violation d'architecture : ${v.rule?.name ?? 'règle'}`,
        description: `Dépendance interdite de ${v.from} vers ${v.to}.`,
        filePath: rel(root, v.from),
        line: null,
        remediation:
          "Supprimer ou inverser cette dépendance (introduire une abstraction / respecter les couches).",
        reference: null,
      }),
    );
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// madge — dépendances circulaires (architecture)
// ──────────────────────────────────────────────────────────────
export function normalizeMadge(raw: any): Finding[] {
  const circular = raw?.circular ?? raw; // madge --json --circular → array d'arrays
  if (!Array.isArray(circular)) return [];
  return circular.map((cycle: string[]) =>
    makeFinding({
      dimension: 'architecture',
      tool: 'madge',
      severity: 'medium',
      ruleId: 'circular-dependency',
      title: `Dépendance circulaire (${cycle.length} modules)`,
      description: `Cycle : ${cycle.join(' → ')} → ${cycle[0]}`,
      filePath: cycle[0] ?? null,
      line: null,
      remediation:
        "Briser le cycle en extrayant l'interface partagée ou en inversant une dépendance.",
      reference: null,
    }),
  );
}
