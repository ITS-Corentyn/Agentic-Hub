#!/usr/bin/env bash
# ============================================================
#  Agentic-Hub - Mettre a jour (macOS).
#  Double-clic : recupere les dernieres modifs et ne reconstruit
#  que si la logique applicative a change. Pas besoin de reinstaller.
# ============================================================
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$DIR/infra/docker-compose.yml" ]; then
  ROOT="$DIR"
elif [ -f "$DIR/Agentic-Hub/infra/docker-compose.yml" ]; then
  ROOT="$DIR/Agentic-Hub"
else
  printf '\033[33m  Agentic-Hub n'\''est pas installe ici. Lance d'\''abord Install-macOS.command\033[0m\n'
  exit 1
fi

exec bash "$ROOT/install/update.sh" "$ROOT"
