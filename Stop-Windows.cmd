@echo off
REM Agentic-Hub — arrête les conteneurs (sans supprimer les données).
docker compose --env-file "%~dp0.env" -f "%~dp0infra\docker-compose.yml" stop
echo.
echo Stack arretee. Double-clique Install-Windows.cmd pour redemarrer.
pause
