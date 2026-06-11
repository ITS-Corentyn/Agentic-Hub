#!/usr/bin/env bash
# Agentic-Hub - Mise a jour (macOS/Linux).
#  - git fetch : ne fait rien si rien n'a change ;
#  - git pull si en retard ;
#  - rebuild SEULEMENT si la logique applicative a change ; sinon redemarrage leger.
#  --auto : mode silencieux (LaunchAgent/cron), journalise, tolerant si Docker eteint.
set -euo pipefail

ROOT=""
AUTO=0
for a in "$@"; do
  case "$a" in
    --auto) AUTO=1 ;;
    *) ROOT="$a" ;;
  esac
done
[ -n "$ROOT" ] || ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cyan()   { printf '\033[36m  %s\033[0m\n' "$1"; }
green()  { printf '\033[32m  %s\033[0m\n' "$1"; }
yellow() { printf '\033[33m  %s\033[0m\n' "$1"; }
step()   { printf '\n\033[35m==> %s\033[0m\n' "$1"; }

# Journalisation en mode auto.
if [ "$AUTO" = 1 ]; then
  mkdir -p "$ROOT/logs"
  exec >> "$ROOT/logs/auto-update.log" 2>&1
  echo "[auto-update] $(date +%FT%T)"
fi

command -v git >/dev/null 2>&1 || { yellow "Git introuvable. Relance l'installeur."; exit 1; }

DOCKER_UP=0
if docker info >/dev/null 2>&1; then DOCKER_UP=1; fi
if [ "$DOCKER_UP" = 0 ] && [ "$AUTO" = 0 ]; then
  yellow "Docker n'est pas demarre. Lance Docker Desktop puis relance."; exit 1
fi

step "Verification des mises a jour"
git -C "$ROOT" fetch --quiet origin || true
OLD="$(git -C "$ROOT" rev-parse HEAD)"
if ! REMOTE="$(git -C "$ROOT" rev-parse '@{u}' 2>/dev/null)"; then
  BR="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
  REMOTE="$(git -C "$ROOT" rev-parse "origin/${BR}" 2>/dev/null || echo "")"
fi

if [ -z "$REMOTE" ] || [ "$OLD" = "$REMOTE" ]; then
  green "Tu es deja a jour (aucun changement sur le depot)."
  exit 0
fi

BEHIND="$(git -C "$ROOT" rev-list "${OLD}..${REMOTE}" --count)"
step "Mise a jour disponible (${BEHIND} commit(s)) - application..."
git -C "$ROOT" pull --ff-only
NEW="$(git -C "$ROOT" rev-parse HEAD)"

if git -C "$ROOT" diff --name-only "$OLD" "$NEW" \
   | grep -qE '^(apps/|packages/|scanners/|infra/|pnpm-lock\.yaml|package\.json|.*Dockerfile)'; then
  NEED_BUILD=1
else
  NEED_BUILD=0
fi

# Docker eteint en mode auto : code a jour, images au prochain demarrage.
if [ "$DOCKER_UP" = 0 ]; then
  yellow "Docker est arrete - le code est a jour ; images reconstruites au prochain demarrage."
  exit 0
fi

USE_GPU=false
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits >/dev/null 2>&1; then
  USE_GPU=true
fi

export GIT_SHA="$NEW"  # version deployee (bandeau MAJ)
ENV_FILE="$ROOT/.env"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT/infra/docker-compose.yml")
[ "$USE_GPU" = true ] && COMPOSE+=(-f "$ROOT/infra/docker-compose.gpu.yml")

if [ "$NEED_BUILD" = 1 ]; then
  step "Reconstruction des images impactees (peut prendre quelques minutes)"
  if ! "${COMPOSE[@]}" up -d --build && [ "$USE_GPU" = true ]; then
    yellow "Echec GPU - nouvelle tentative en mode CPU."
    COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT/infra/docker-compose.yml")
    "${COMPOSE[@]}" up -d --build
  fi
else
  cyan "Changements non applicatifs (docs/config) - redemarrage leger."
  "${COMPOSE[@]}" up -d
fi

green "Mise a jour terminee ! (${OLD:0:8} -> ${NEW:0:8})"
