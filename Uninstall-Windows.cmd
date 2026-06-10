@echo off
REM ============================================================
REM  Agentic-Hub - Desinstaller (Windows).
REM  Double-clic : arrete/supprime les conteneurs, retire la mise
REM  a jour auto, et propose de supprimer donnees/images/dossier.
REM  (Stop-Windows.cmd ne fait qu'ARRETER ; ceci DESINSTALLE.)
REM ============================================================
setlocal EnableExtensions
for /f "delims=:" %%a in ('findstr /n /b /c:"@@PSSTART@@" "%~f0"') do set "PSL=%%a"
set "BOOT=%TEMP%\agentic-hub-uninstall.ps1"
more +%PSL% "%~f0" > "%BOOT%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%BOOT%" "%~dp0."
del "%BOOT%" >nul 2>&1
exit /b
@@PSSTART@@
param([string]$BaseDir)
$ErrorActionPreference = 'Continue'
$BaseDir = (Resolve-Path $BaseDir).Path
function Warn($m){ Write-Host "  $m" -ForegroundColor Yellow }

$RepoRoot = $null
if (Test-Path (Join-Path $BaseDir 'infra\docker-compose.yml')) {
  $RepoRoot = $BaseDir
} elseif (Test-Path (Join-Path $BaseDir 'Agentic-Hub\infra\docker-compose.yml')) {
  $RepoRoot = Join-Path $BaseDir 'Agentic-Hub'
}
if (-not $RepoRoot) {
  Warn "Agentic-Hub n'est pas installe ici."
  Read-Host "Appuie sur Entree pour quitter"; exit 1
}

& (Join-Path $RepoRoot 'install\uninstall.ps1') $RepoRoot
