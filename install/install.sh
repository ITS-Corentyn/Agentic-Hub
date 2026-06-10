#!/usr/bin/env bash
# Agentic-Hub — Installeur macOS / Linux (sans Node/npm). Tout tourne dans Docker.
#   1) vérifie Docker  2) détecte le matériel (GPU/VRAM ou RAM) → modèle Ollama
#   3) prépare .env (ports libres + modèle)  4) build + up  5) pull du modèle  6) ouvre l'UI
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cyan() { printf '\033[36m  %s\033[0m\n' "$1"; }
green() { printf '\033[32m  %s\033[0m\n' "$1"; }
yellow() { printf '\033[33m  %s\033[0m\n' "$1"; }
step() { printf '\n\033[35m==> %s\033[0m\n' "$1"; }

OS="$(uname -s)"

open_url() {
  case "$OS" in
    Darwin) open "$1" ;;
    Linux) xdg-open "$1" >/dev/null 2>&1 || true ;;
  esac
}

# ── 1. Docker ────────────────────────────────────────────────
step "Vérification de Docker"
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  yellow "Docker n'est pas disponible (non installé ou non démarré)."
  if [ "$OS" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    read -r -p "  Installer Docker Desktop via Homebrew ? (o/N) " ans
    if [ "$ans" = "o" ] || [ "$ans" = "O" ]; then
      brew install --cask docker
      yellow "Docker Desktop installé. Lance-le (Applications → Docker), attends qu'il soit prêt, puis relance ce script."
      exit 1
    fi
  fi
  yellow "Installe Docker Desktop : https://www.docker.com/products/docker-desktop/"
  yellow "Démarre-le puis relance ce script."
  exit 1
fi
green "Docker est prêt."

# ── 2. Détection matériel + choix du modèle ──────────────────
step "Détection du matériel"
USE_GPU=false
MEM_GB=0
MODEL=""

if command -v nvidia-smi >/dev/null 2>&1; then
  VRAM_MIB="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -n1 | tr -d ' ' || true)"
  if [[ "$VRAM_MIB" =~ ^[0-9]+$ ]]; then
    USE_GPU=true
    MEM_GB=$(( VRAM_MIB / 1024 ))
  fi
fi

if [ "$USE_GPU" = true ]; then
  if   [ "$MEM_GB" -lt 5 ];  then MODEL="qwen2.5-coder:1.5b"
  elif [ "$MEM_GB" -lt 9 ];  then MODEL="qwen2.5-coder:3b"
  elif [ "$MEM_GB" -lt 18 ]; then MODEL="qwen2.5-coder:7b"
  else MODEL="qwen2.5-coder:14b"; fi
  green "GPU NVIDIA détecté — ${MEM_GB} Go VRAM → modèle ${MODEL} (GPU)"
else
  # RAM totale (macOS: sysctl ; Linux: /proc/meminfo)
  if [ "$OS" = "Darwin" ]; then
    BYTES="$(sysctl -n hw.memsize)"
    MEM_GB=$(( BYTES / 1024 / 1024 / 1024 ))
  else
    KB="$(awk '/MemTotal/{print $2}' /proc/meminfo)"
    MEM_GB=$(( KB / 1024 / 1024 ))
  fi
  if   [ "$MEM_GB" -lt 6 ];  then MODEL="qwen2.5-coder:1.5b"
  elif [ "$MEM_GB" -lt 12 ]; then MODEL="qwen2.5-coder:3b"
  else MODEL="qwen2.5-coder:7b"; fi   # CPU : plafonné à 7b
  if [ "$OS" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then
    green "Mac Apple Silicon — ${MEM_GB} Go (mémoire unifiée) → modèle ${MODEL} (CPU dans Docker)"
    yellow "Astuce perf : sur Mac, Docker n'accède pas au GPU. Pour accélérer, installe Ollama nativement (brew install ollama) et mets OLLAMA_URL=http://host.docker.internal:11434 dans .env."
  else
    green "Pas de GPU NVIDIA — ${MEM_GB} Go RAM → modèle ${MODEL} (CPU)"
  fi
fi

# ── 3. Préparation du .env ───────────────────────────────────
step "Configuration (.env)"
ENV_FILE="$ROOT/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT/.env.example" "$ENV_FILE"
  cyan ".env créé depuis .env.example (renseigne les clés GitHub OAuth pour la connexion par compte)."
else
  cyan ".env existant conservé (secrets préservés)."
fi

port_free() {
  if command -v lsof >/dev/null 2>&1; then ! lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then ! nc -z localhost "$1" >/dev/null 2>&1
  else return 0; fi
}
pick_port() { for p in "$@"; do if port_free "$p"; then echo "$p"; return; fi; done; echo "$1"; }
get_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d ' '; }
# Réutilise un port déjà choisi (install existante), sinon en pick un libre.
resolve_port() { local cur; cur="$(get_env "$1")"; if [[ "$cur" =~ ^[0-9]+$ ]]; then echo "$cur"; else shift; pick_port "$@"; fi; }
set_env() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    # remplace la ligne (séparateur | pour éviter les soucis d'URL)
    sed -i.bak -E "s|^${key}=.*|${key}=${val}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

API_PORT="$(resolve_port API_HOST_PORT 3000 3200 3300 4000 4100 5005)"
WEB_PORT="$(resolve_port WEB_PORT 8080 8088 8090 8200 8888)"
PG_PORT="$(resolve_port POSTGRES_HOST_PORT 5432 5433 5440 15432 55432)"
OLLAMA_PORT="$(resolve_port OLLAMA_HOST_PORT 11434 11435 11440 21434)"
set_env API_HOST_PORT "$API_PORT"
set_env WEB_PORT "$WEB_PORT"
set_env POSTGRES_HOST_PORT "$PG_PORT"
set_env OLLAMA_HOST_PORT "$OLLAMA_PORT"
set_env WEB_ORIGIN "http://localhost:${WEB_PORT}"
set_env VITE_API_BASE "http://localhost:${API_PORT}"
set_env OLLAMA_MODEL "$MODEL"
green "API:${API_PORT}  Web:${WEB_PORT}  DB:${PG_PORT}  Ollama:${OLLAMA_PORT}  Modèle:${MODEL}"

# ── 4. Build + démarrage ─────────────────────────────────────
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT/infra/docker-compose.yml")
if [ "$USE_GPU" = true ]; then COMPOSE+=(-f "$ROOT/infra/docker-compose.gpu.yml"); fi

step "Construction et démarrage de la stack (peut prendre plusieurs minutes)"
if ! "${COMPOSE[@]}" up -d --build; then
  if [ "$USE_GPU" = true ]; then
    yellow "Échec avec le GPU — nouvelle tentative en mode CPU."
    COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT/infra/docker-compose.yml")
    "${COMPOSE[@]}" up -d --build
  else
    yellow "Le démarrage a échoué. Voir 'docker compose logs'."; exit 1
  fi
fi
green "Stack démarrée."

# Pull Ollama avec barre de progression sur UNE seule ligne (via l'API HTTP).
ollama_pull_pretty() {
  local model="$1" port="${2:-11434}"
  curl -s -o /dev/null --max-time 5 "http://localhost:${port}/api/version" || return 1
  curl -s -N -X POST "http://localhost:${port}/api/pull" \
       -H 'Content-Type: application/json' \
       -d "{\"model\":\"${model}\",\"stream\":true}" \
  | while IFS= read -r line; do
      [ -z "$line" ] && continue
      total=$(printf '%s' "$line" | grep -o '"total":[0-9]\+' | grep -o '[0-9]\+' | head -1)
      completed=$(printf '%s' "$line" | grep -o '"completed":[0-9]\+' | grep -o '[0-9]\+' | head -1)
      status=$(printf '%s' "$line" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
      if [ -n "$total" ] && [ "$total" -gt 0 ] 2>/dev/null; then
        [ -z "$completed" ] && completed=0
        pct=$(( completed * 100 / total )); fill=$(( pct / 2 ))
        bar="$(printf '%*s' "$fill" '' | tr ' ' '#')$(printf '%*s' $((50 - fill)) '' | tr ' ' '.')"
        go="$(awk -v c="$completed" -v t="$total" 'BEGIN{printf "%.2f/%.2f Go", c/1073741824, t/1073741824}')"
        printf '\r  [%s] %3d%%  %s  %s        ' "$bar" "$pct" "$go" "$status"
      else
        printf '\r  %-70s' "$status"
      fi
    done
  printf '\n'
}

# Assistant pas-à-pas pour configurer l'OAuth GitHub depuis l'installeur.
github_oauth_setup() {
  step "Connexion GitHub (recommandé — pour auditer tes repos)"
  if grep -qE '^GITHUB_OAUTH_CLIENT_ID=.+' "$ENV_FILE"; then
    green "OAuth GitHub déjà configuré. Dans l'appli : « Se connecter » puis « Synchroniser GitHub »."
    return
  fi
  local cb="http://localhost:${API_PORT}/api/auth/github/callback"
  cyan "Crée une « OAuth App » GitHub (2 min) pour récupérer TES repos et ceux de tes organisations :"
  echo
  echo "    1) Ouvre : https://github.com/settings/developers"
  echo "       (Settings -> Developer settings -> OAuth Apps)"
  echo "    2) Clique « New OAuth App »"
  echo "    3) Remplis :"
  echo "         Application name            : Agentic-Hub"
  echo "         Homepage URL                : http://localhost:${WEB_PORT}"
  echo "         Authorization callback URL  : ${cb}"
  echo "    4) Clique « Register application »"
  echo "    5) Copie le « Client ID »"
  echo "    6) Clique « Generate a new client secret » et copie la valeur"
  echo
  read -r -p "  Ouvrir la page GitHub maintenant ? (O/n) " op
  if [ "$op" != "n" ] && [ "$op" != "N" ]; then open_url "https://github.com/settings/developers"; fi
  read -r -p "  Colle ton Client ID (ou Entrée pour configurer plus tard) : " cid
  [ -z "$cid" ] && { yellow "Étape ignorée — voir README pour configurer plus tard."; return; }
  read -r -p "  Colle ton Client Secret : " sec
  [ -z "$sec" ] && { yellow "Secret vide — étape ignorée."; return; }
  set_env GITHUB_OAUTH_CLIENT_ID "$cid"
  set_env GITHUB_OAUTH_CLIENT_SECRET "$sec"
  set_env GITHUB_OAUTH_CALLBACK_URL "$cb"
  cyan "Application de la configuration (redémarrage de l'API)..."
  "${COMPOSE[@]}" up -d api || true
  green "OAuth configuré ! Dans l'appli : « Se connecter » puis « Synchroniser GitHub »."
}

# Active la mise a jour automatique (macOS: LaunchAgent ; Linux: cron suggere).
enable_auto_update() {
  step "Mises à jour automatiques"
  if [ "$OS" != "Darwin" ]; then
    cyan "Linux — pour automatiser, ajoute une tâche cron :"
    echo "    (crontab -l 2>/dev/null; echo \"0 */2 * * * bash '$ROOT/install/update.sh' '$ROOT' --auto\") | crontab -"
    return
  fi
  local plist="$HOME/Library/LaunchAgents/com.agentic-hub.autoupdate.plist"
  read -r -p "  Activer la mise à jour automatique (au démarrage + toutes les 2h) ? (O/n) " ans
  if [ "$ans" = "n" ] || [ "$ans" = "N" ]; then
    cyan "Désactivée. Utilise Update-macOS.command pour mettre à jour."
    return
  fi
  mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/logs"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.agentic-hub.autoupdate</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${ROOT}/install/update.sh</string>
    <string>${ROOT}</string>
    <string>--auto</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>7200</integer>
  <key>StandardOutPath</key><string>${ROOT}/logs/auto-update.out</string>
  <key>StandardErrorPath</key><string>${ROOT}/logs/auto-update.err</string>
</dict>
</plist>
PLIST
  launchctl unload "$plist" 2>/dev/null || true
  if launchctl load -w "$plist" 2>/dev/null; then
    green "Mises à jour automatiques activées (au démarrage + toutes les 2h)."
    cyan "Pour désactiver : launchctl unload '$plist' && rm '$plist'"
  else
    yellow "Impossible de charger le LaunchAgent — utilise Update-macOS.command."
  fi
}

# ── 5. Configuration GitHub OAuth (guide pas à pas) ──────────
github_oauth_setup

# ── 6. Téléchargement du modèle (barre de progression) ───────
step "Téléchargement du modèle ${MODEL} (une seule fois)"
if ollama_pull_pretty "$MODEL" "$OLLAMA_PORT"; then
  green "Modèle prêt."
else
  yellow "Téléchargement standard (barre indisponible)..."
  if ! "${COMPOSE[@]}" exec -T ollama ollama pull "$MODEL"; then
    yellow "Le pull du modèle a échoué — la narration LLM utilisera le fallback."
  else
    green "Modèle prêt."
  fi
fi

# ── 6.5 Mises à jour automatiques ────────────────────────────
enable_auto_update

# ── 7. Fin ───────────────────────────────────────────────────
step "Terminé !"
green "Interface : http://localhost:${WEB_PORT}"
green "API       : http://localhost:${API_PORT}/api/health"
open_url "http://localhost:${WEB_PORT}"
