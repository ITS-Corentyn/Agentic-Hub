#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Auto-audit open-source du repository courant.
# Remplace l'ancien pipeline `claude --print` (API Anthropic payante, supprimée).
# Produit reports/audit-result.json + reports/final-audit.md via le moteur d'audit.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="${1:-$PWD}"
mkdir -p reports

ENGINE="packages/audit-engine/dist/cli.js"
if [[ ! -f "$ENGINE" ]]; then
  echo "▶ Build du moteur d'audit…"
  pnpm --filter @agentic-hub/shared build
  pnpm --filter @agentic-hub/audit-engine build
fi

echo "▶ Audit open-source de : $ROOT"
node "$ENGINE" scan "$ROOT" \
  --out reports/audit-result.json \
  --report reports/final-audit.md \
  --repo "${GITHUB_REPOSITORY:-local/repo}"

echo "✔ Rapports générés :"
echo "   - reports/audit-result.json (données structurées)"
echo "   - reports/final-audit.md    (rapport complet)"
