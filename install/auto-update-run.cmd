@echo off
REM Lance la mise a jour silencieuse d'Agentic-Hub (appele par la tache planifiee).
REM %~dp0 = dossier install\ ; %~dp0.. = racine du depot.
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0update.ps1" "%~dp0.." -Auto
