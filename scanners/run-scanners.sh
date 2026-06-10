#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Exécute la suite de scanners open-source sur un repository puis
# normalise les résultats en un JSON unifié, et (optionnellement)
# le POST vers l'API d'ingestion.
#
# Variables d'environnement attendues :
#   TARGET_DIR    Chemin du repo à auditer (défaut: $PWD)
#   OUT_FILE      Fichier de sortie JSON unifié (défaut: audit-result.json)
#   AUDIT_ID      Identifiant d'audit (transmis à l'ingestion)
#   COMMIT_SHA    SHA du commit audité (optionnel, métadonnée)
#   INGEST_URL    Si défini, POST le résultat ici (ex: http://host:3000/api/ingest)
#   INGEST_TOKEN  Bearer token pour l'ingestion
# ──────────────────────────────────────────────────────────────
set -euo pipefail

TARGET_DIR="${TARGET_DIR:-$PWD}"
OUT_FILE="${OUT_FILE:-audit-result.json}"
ENGINE="${ENGINE_CLI:-/app/packages/audit-engine/dist/cli.js}"

echo "▶ Audit de : $TARGET_DIR"

# Le moteur orchestre tous les scanners disponibles, normalise et score.
node "$ENGINE" scan "$TARGET_DIR" \
  --out "$OUT_FILE" \
  ${AUDIT_ID:+--audit-id "$AUDIT_ID"} \
  ${COMMIT_SHA:+--commit "$COMMIT_SHA"}

echo "✔ Résultat unifié écrit dans : $OUT_FILE"

if [[ -n "${INGEST_URL:-}" ]]; then
  echo "▶ Ingestion vers : $INGEST_URL"
  curl -sS -X POST "$INGEST_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${INGEST_TOKEN:-}" \
    --data-binary "@$OUT_FILE" \
    --fail-with-body
  echo ""
  echo "✔ Ingestion terminée"
fi
