import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding } from '@agentic-hub/shared';
import { makeFinding } from './util.js';

interface Ecosystem {
  manifest: string;
  packageEcosystem: string;
}

const ECOSYSTEMS: Ecosystem[] = [
  { manifest: 'package.json', packageEcosystem: 'npm' },
  { manifest: 'requirements.txt', packageEcosystem: 'pip' },
  { manifest: 'pyproject.toml', packageEcosystem: 'pip' },
  { manifest: 'go.mod', packageEcosystem: 'gomod' },
  { manifest: 'Gemfile', packageEcosystem: 'bundler' },
  { manifest: 'composer.json', packageEcosystem: 'composer' },
  { manifest: 'pom.xml', packageEcosystem: 'maven' },
  { manifest: 'Cargo.toml', packageEcosystem: 'cargo' },
  { manifest: 'Dockerfile', packageEcosystem: 'docker' },
];

export interface DependabotAnalysis {
  present: boolean;
  ecosystems: string[];
  /** Contenu YAML proposé pour `.github/dependabot.yml`. */
  proposedConfig: string;
  findings: Finding[];
}

export function analyzeDependabot(root: string): DependabotAnalysis {
  const present =
    existsSync(join(root, '.github', 'dependabot.yml')) ||
    existsSync(join(root, '.github', 'dependabot.yaml'));

  const detected = ECOSYSTEMS.filter((e) => existsSync(join(root, e.manifest)));
  const ecosystems = [...new Set(detected.map((e) => e.packageEcosystem))];

  const proposedConfig = buildDependabotYaml(ecosystems);

  const findings: Finding[] = [];
  if (!present && ecosystems.length > 0) {
    findings.push(
      makeFinding({
        dimension: 'dependencies',
        tool: 'engine',
        severity: 'medium',
        ruleId: 'dependabot-missing',
        title: 'Dependabot non configuré',
        description: `Le repository utilise ${ecosystems.join(', ')} mais ne possède pas de \`.github/dependabot.yml\`. Les mises à jour de sécurité automatiques ne sont pas activées.`,
        filePath: '.github/dependabot.yml',
        line: null,
        remediation:
          'Ajouter un fichier `.github/dependabot.yml` (configuration proposée disponible dans le rapport / via l’API) pour activer les mises à jour automatiques des dépendances.',
        reference: 'https://docs.github.com/code-security/dependabot',
      }),
    );
  }

  return { present, ecosystems, proposedConfig, findings };
}

export function buildDependabotYaml(ecosystems: string[]): string {
  const list = ecosystems.length ? ecosystems : ['npm'];
  const updates = list
    .map(
      (eco) => `  - package-ecosystem: "${eco}"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
    labels:
      - "dependencies"`,
    )
    .join('\n');
  return `version: 2
updates:
${updates}
`;
}
