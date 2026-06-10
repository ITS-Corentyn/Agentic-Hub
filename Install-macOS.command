#!/usr/bin/env bash
# ============================================================
#  Agentic-Hub — Installeur AUTONOME macOS (un seul fichier).
#  Partage ce fichier : un double-clic suffit. Il installe Docker
#  et Git si besoin, clone le projet, détecte le matériel, build,
#  démarre tout et télécharge le modèle LLM. Aucun Node/npm requis.
#  (Fonctionne aussi tel quel à l'intérieur d'un dépôt déjà cloné.)
#  1er lancement bloqué par macOS ? clic droit → Ouvrir → Ouvrir.
# ============================================================
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_URL="https://github.com/ITS-Corentyn/Agentic-Hub.git"

cyan()   { printf '\033[36m  %s\033[0m\n' "$1"; }
green()  { printf '\033[32m  %s\033[0m\n' "$1"; }
yellow() { printf '\033[33m  %s\033[0m\n' "$1"; }
step()   { printf '\n\033[35m==> %s\033[0m\n' "$1"; }

if [ -f "$DIR/infra/docker-compose.yml" ]; then
  ROOT="$DIR"
  cyan "Dépôt détecté sur place : $ROOT"
else
  ROOT="$DIR/Agentic-Hub"

  # Git requis pour cloner un dépôt privé (authentification au 1er accès).
  if ! command -v git >/dev/null 2>&1; then
    yellow "Git n'est pas installé."
    if command -v brew >/dev/null 2>&1; then
      step "Installation de Git via Homebrew"; brew install git
    else
      step "Déclenchement de l'installation des outils de développement (git)"
      xcode-select --install || true
      yellow "Termine l'installation de Git puis relance ce fichier."
      exit 1
    fi
  fi

  if [ -d "$ROOT/.git" ]; then
    step "Mise à jour du projet (git pull)"; git -C "$ROOT" pull --ff-only
  else
    step "Clonage du projet (authentifie-toi si demandé)"; git clone "$REPO_URL" "$ROOT"
  fi
  [ -f "$ROOT/install/install.sh" ] || { yellow "Échec de récupération du projet."; exit 1; }
fi

# Délègue à l'installeur du dépôt (Docker, matériel, build, modèle, navigateur).
exec bash "$ROOT/install/install.sh"
