#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuditResultSchema } from '@agentic-hub/shared';
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

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== 'scan') {
    console.error('Usage : audit-engine scan <dir> [--out result.json] [--report report.md]');
    process.exit(1);
  }

  const { args, positional } = parseArgs(rest);
  const target = resolve(positional[0] ?? process.cwd());

  console.error(`▶ Audit de ${target}`);
  const { result, proposedDependabot } = runAudit(target, {
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
}

main();
