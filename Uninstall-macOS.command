#!/usr/bin/env bash
# ============================================================
#  Agentic-Hub - Desinstaller (macOS).
#  Double-clic : arrete/supprime les conteneurs, retire la mise a
#  jour auto, et propose de supprimer donnees/images/dossier.
#  (Stop-macOS.command ne fait qu'ARRETER ; ceci DESINSTALLE.)
# ============================================================
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$DIR/infra/docker-compose.yml" ]; then
  ROOT="$DIR"
elif [ -f "$DIR/Agentic-Hub/infra/docker-compose.yml" ]; then
  ROOT="$DIR/Agentic-Hub"
else
  printf '\033[33m  Agentic-Hub n'\''est pas installe ici.\033[0m\n'
  exit 1
fi

exec bash "$ROOT/install/uninstall.sh" "$ROOT"
