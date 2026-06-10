@echo off
REM Agentic-Hub — installation/démarrage en un double-clic (Windows).
REM Ne nécessite PAS Node/npm : tout tourne dans Docker.
REM Ré-exécutable à volonté (idempotent : sert aussi à redémarrer).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install\install.ps1"
