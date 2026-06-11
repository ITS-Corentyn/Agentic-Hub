#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuditResultSchema, SEVERITY_RANK, type Severity } from '@agentic-hub/shared';
import { runAudit } from './engine.js';
import { generateReport } from './report.js';
import { buildStaticSynthesis } from './synthesis.js';

/**
 * CLI du moteur d'audit.
 *   audit-engine scan <dir> [--out result.json] [--report report.md]
 *                           [--audit-id ID] [--commit SHA] [--repo owner/name]
 */
function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    } else {
      positional.push(a);
    }
  }
  return { args, positional };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== 'scan') {
    console.error('Usage : audit-engine scan <dir> [--out result.json] [--report report.md]');
    process.exit(1);
  }

  const { args, positional } = parseArgs(rest);
  const target = resolve(positional[0] ?? process.cwd());

  console.error(`▶ Audit de ${target}`);
  const { result, proposedDependabot } = await runAudit(target, {
    auditId: args['audit-id'] ?? null,
    commitSha: args['commit'] ?? null,
    repoFullName: args['repo'],
    onProgress: (tool) => console.error(`  · ${tool}`),
  });

  // Validation du contrat avant écriture.
  const validated = AuditResultSchema.parse(result);

  const outFile = args['out'] ?? 'audit-result.json';
  writeFileSync(outFile, JSON.stringify(validated, null, 2));
  console.error(`✔ ${validated.findings.length} finding(s) — score global ${validated.globalScore}/100`);
  console.error(`✔ Résultat écrit : ${outFile}`);

  if (args['report']) {
    const synthesis = buildStaticSynthesis(validated);
    const md = generateReport(validated, synthesis, proposedDependabot);
    writeFileSync(args['report'], md);
    console.error(`✔ Rapport Markdown écrit : ${args['report']}`);
  }

  // Gate CI : échec (exit 2) si les seuils fournis sont dépassés.
  const failScore = args['fail-on-score'] ? Number(args['fail-on-score']) : null;
  const failSev = (args['fail-on-severity'] as Severity | undefined) ?? null;
  if (failScore != null || failSev) {
    const reasons: string[] = [];
    if (failScore != null && validated.globalScore < failScore) {
      reasons.push(`score ${validated.globalScore} < ${failScore}`);
    }
    if (failSev) {
      const minRank = SEVERITY_RANK[failSev];
      const n = validated.findings.filter((f) => SEVERITY_RANK[f.severity] >= minRank).length;
      if (n > 0) reasons.push(`${n} finding(s) de sévérité >= ${failSev}`);
    }
    if (reasons.length) {
      console.error(`✖ Gate KO : ${reasons.join(' ; ')}`);
      process.exit(2);
    }
    console.error('✔ Gate OK');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
