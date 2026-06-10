#!/usr/bin/env bash
# Agentic-Hub — arrête les conteneurs (sans supprimer les données).
cd "$(dirname "$0")"
docker compose --env-file "./.env" -f "./infra/docker-compose.yml" stop
echo
echo "Stack arrêtée. Double-clique Install-macOS.command pour redémarrer."
