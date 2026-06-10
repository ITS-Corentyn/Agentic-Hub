import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { RepoMetrics } from '@agentic-hub/shared';

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  'generated',
]);

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.py': 'Python',
  '.go': 'Go',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.java': 'Java',
  '.cs': 'C#',
  '.rs': 'Rust',
};

/** Parcourt le repo et calcule LOC, nombre de fichiers et langages détectés. */
export function computeMetrics(root: string): RepoMetrics {
  let loc = 0;
  let files = 0;
  const langLoc = new Map<string, number>();

  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;
        walk(full);
      } else {
        const lang = LANG_BY_EXT[extname(entry).toLowerCase()];
        if (!lang) continue;
        if (st.size > 2 * 1024 * 1024) continue; // ignore fichiers énormes (minifiés)
        let lines = 0;
        try {
          lines = readFileSync(full, 'utf8').split('\n').length;
        } catch {
          continue;
        }
        loc += lines;
        files += 1;
        langLoc.set(lang, (langLoc.get(lang) ?? 0) + lines);
      }
    }
  };

  walk(root);

  const languages = [...langLoc.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);

  return { loc, files, languages };
}
