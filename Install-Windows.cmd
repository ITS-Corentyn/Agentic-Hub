@echo off
REM ============================================================
REM  Agentic-Hub - Installeur AUTONOME Windows (un seul fichier).
REM  Partage ce fichier : un double-clic suffit. Il installe Docker
REM  et Git si besoin, clone le projet, detecte le materiel, build,
REM  demarre tout et telecharge le modele LLM. Aucun Node/npm requis.
REM  (Fonctionne aussi tel quel a l'interieur d'un depot deja clone.)
REM ============================================================
setlocal EnableExtensions
for /f "delims=:" %%a in ('findstr /n /b /c:"@@PSSTART@@" "%~f0"') do set "PSL=%%a"
set "BOOT=%TEMP%\agentic-hub-setup.ps1"
more +%PSL% "%~f0" > "%BOOT%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%BOOT%" "%~dp0."
del "%BOOT%" >nul 2>&1
echo.
pause
exit /b
@@PSSTART@@
param([string]$BaseDir)
# EAP=Continue : git ecrit sa progression sur stderr ; sous 'Stop' cela ferait
# planter le bootstrap. On verifie le resultat via la presence des fichiers.
$ErrorActionPreference = 'Continue'
$BaseDir = (Resolve-Path $BaseDir).Path  # normalise (gere le point ajoute par le .cmd)
function Step($m){ Write-Host "`n==> $m" -ForegroundColor Magenta }
function Info($m){ Write-Host "  $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "  $m" -ForegroundColor Green }
function Warn($m){ Write-Host "  $m" -ForegroundColor Yellow }

$RepoUrl = 'https://github.com/ITS-Corentyn/Agentic-Hub.git'

# Si on est deja dans le depot (a cote de infra/), on l'utilise directement.
if (Test-Path (Join-Path $BaseDir 'infra\docker-compose.yml')) {
  $RepoRoot = (Resolve-Path $BaseDir).Path
  Info "Depot detecte sur place : $RepoRoot"
} else {
  $RepoRoot = Join-Path $BaseDir 'Agentic-Hub'

  # Git requis pour cloner un depot prive (authentification au 1er acces).
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Warn "Git n'est pas installe."
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      Step "Installation de Git via winget"
      winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
      $env:Path += ';C:\Program Files\Git\cmd'
    }
  }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Warn "Installe Git (https://git-scm.com/download/win) puis relance ce fichier."
    Read-Host "Entree pour quitter"; exit 1
  }

  if (Test-Path (Join-Path $RepoRoot '.git')) {
    Step "Mise a jour du projet (git pull)"
    & git -C $RepoRoot pull --ff-only 2>&1 | Write-Host
  } else {
    Step "Clonage du projet (authentifie-toi dans la fenetre GitHub si demande)"
    & git clone $RepoUrl $RepoRoot 2>&1 | Write-Host
  }
  if (-not (Test-Path (Join-Path $RepoRoot 'install\install.ps1'))) {
    Warn "Echec de recuperation du projet."; Read-Host "Entree pour quitter"; exit 1
  }
}

# Delegue a l'installeur du depot (Docker, materiel, build, modele, navigateur).
& (Join-Path $RepoRoot 'install\install.ps1')
