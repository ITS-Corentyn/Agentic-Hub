@echo off
REM ============================================================
REM  Agentic-Hub - Mettre a jour (Windows).
REM  Double-clic : recupere les dernieres modifs du depot et ne
REM  reconstruit que si la logique applicative a change.
REM  (Pas besoin de reinstaller. Fonctionne aussi a cote du depot.)
REM ============================================================
setlocal EnableExtensions
for /f "delims=:" %%a in ('findstr /n /b /c:"@@PSSTART@@" "%~f0"') do set "PSL=%%a"
set "BOOT=%TEMP%\agentic-hub-update.ps1"
more +%PSL% "%~f0" > "%BOOT%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%BOOT%" "%~dp0."
del "%BOOT%" >nul 2>&1
exit /b
@@PSSTART@@
param([string]$BaseDir)
$ErrorActionPreference = 'Continue'
$BaseDir = (Resolve-Path $BaseDir).Path
function Warn($m){ Write-Host "  $m" -ForegroundColor Yellow }

# Localise le depot : a cote du fichier, ou dans un sous-dossier Agentic-Hub.
$RepoRoot = $null
if (Test-Path (Join-Path $BaseDir 'infra\docker-compose.yml')) {
  $RepoRoot = $BaseDir
} elseif (Test-Path (Join-Path $BaseDir 'Agentic-Hub\infra\docker-compose.yml')) {
  $RepoRoot = Join-Path $BaseDir 'Agentic-Hub'
}
if (-not $RepoRoot) {
  Warn "Agentic-Hub n'est pas installe ici. Lance d'abord Install-Windows.cmd."
  Read-Host "Appuie sur Entree pour quitter"; exit 1
}

& (Join-Path $RepoRoot 'install\update.ps1') $RepoRoot
