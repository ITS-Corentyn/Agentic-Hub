#!/usr/bin/env bash
# Agentic-Hub - Desinstallation (macOS/Linux).
# Arrete/supprime les conteneurs, retire la mise a jour auto, et propose (avec
# confirmation) de supprimer les donnees, les images, et le dossier du projet.
set -uo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cyan()   { printf '\033[36m  %s\033[0m\n' "$1"; }
green()  { printf '\033[32m  %s\033[0m\n' "$1"; }
yellow() { printf '\033[33m  %s\033[0m\n' "$1"; }
step()   { printf '\n\033[35m==> %s\033[0m\n' "$1"; }
ask()    { read -r -p "$1" r; [ "$r" = "o" ] || [ "$r" = "O" ]; }

step "Desinstallation d'Agentic-Hub"
cyan "Dossier : $ROOT"
yellow "Cela va arreter et supprimer les conteneurs Docker de l'application."
if ! ask "  Continuer la desinstallation ? (o/N) "; then cyan "Annule."; exit 0; fi

ENV_FILE="$ROOT/.env"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT/infra/docker-compose.yml")

if ask "  Supprimer aussi les DONNEES (historique d'audits + modeles LLM) ? (o/N) "; then
  step "Arret et suppression des conteneurs + donnees"
  "${COMPOSE[@]}" down -v --remove-orphans || true
  green "Conteneurs et donnees (volumes) supprimes."
else
  step "Arret et suppression des conteneurs"
  "${COMPOSE[@]}" down --remove-orphans || true
  green "Conteneurs supprimes (donnees conservees)."
fi

if ask "  Supprimer les images construites (agentic-hub-api / agentic-hub-web) ? (o/N) "; then
  docker rmi agentic-hub-api agentic-hub-web 2>/dev/null || true
  cyan "Images de base (postgres, ollama) conservees."
fi

# Mise a jour automatique (LaunchAgent macOS / cron Linux)
PLIST="$HOME/Library/LaunchAgents/com.agentic-hub.autoupdate.plist"
if [ -f "$PLIST" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  green "LaunchAgent de mise a jour automatique retire."
fi
if command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -q 'agentic-hub'; then
  crontab -l 2>/dev/null | grep -v 'agentic-hub' | crontab - || true
  green "Entree cron de mise a jour retiree."
fi

# Dossier du projet
if ask "  Supprimer le DOSSIER du projet ($ROOT) ? (o/N) "; then
  yellow "Le dossier sera supprime juste apres la fermeture."
  ( sleep 3; rm -rf "$ROOT" ) >/dev/null 2>&1 &
fi

step "Termine"
green "Agentic-Hub a ete desinstalle."
