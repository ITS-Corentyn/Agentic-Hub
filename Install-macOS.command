#!/usr/bin/env bash
# Agentic-Hub — installation/démarrage en un double-clic (macOS).
# Ne nécessite PAS Node/npm : tout tourne dans Docker.
# Ré-exécutable à volonté (idempotent : sert aussi à redémarrer).
cd "$(dirname "$0")"
exec bash "./install/install.sh"
