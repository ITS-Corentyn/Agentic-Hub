<#
  Agentic-Hub - Desinstallation (Windows). ASCII uniquement (PowerShell 5.1).
  Arrete/supprime les conteneurs, retire la mise a jour auto, et propose (avec
  confirmation) de supprimer les donnees, les images, et le dossier du projet.
#>
param([string]$RepoRoot)
$ErrorActionPreference = 'Continue'
if (-not $RepoRoot) { $RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path }
else { try { $RepoRoot = (Resolve-Path $RepoRoot).Path } catch {} }

function Info($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  $m" -ForegroundColor Yellow }
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Magenta }
function Ask($m)  { $r = Read-Host $m; return ($r -eq 'o' -or $r -eq 'O') }

Step "Desinstallation d'Agentic-Hub"
Info "Dossier : $RepoRoot"
Warn "Cela va arreter et supprimer les conteneurs Docker de l'application."
if (-not (Ask "  Continuer la desinstallation ? (o/N)")) { Info "Annule."; Read-Host "Entree pour fermer"; exit 0 }

$envPath = Join-Path $RepoRoot '.env'
$compose = @('--env-file', $envPath, '-f', (Join-Path $RepoRoot 'infra\docker-compose.yml'))

$rmData = Ask "  Supprimer aussi les DONNEES (historique d'audits + modeles LLM telecharges) ? (o/N)"

Step "Arret et suppression des conteneurs"
if ($rmData) {
  & docker compose @compose down -v --remove-orphans 2>&1 | Write-Host
  Ok "Conteneurs et donnees (volumes) supprimes."
} else {
  & docker compose @compose down --remove-orphans 2>&1 | Write-Host
  Ok "Conteneurs supprimes (donnees conservees dans les volumes Docker)."
}

if (Ask "  Supprimer les images Docker construites (agentic-hub-api / agentic-hub-web) ? (o/N)") {
  & docker rmi agentic-hub-api agentic-hub-web 2>&1 | Write-Host
  Info "Images de base (postgres, ollama) conservees (potentiellement utilisees ailleurs)."
}

# Mise a jour automatique
schtasks /Delete /TN 'AgenticHub-AutoUpdate' /F *> $null
Ok "Mise a jour automatique retiree (si elle etait active)."

# Dossier du projet
if (Ask "  Supprimer le DOSSIER du projet ($RepoRoot) ? (o/N)") {
  Warn "Le dossier sera supprime juste apres la fermeture de cette fenetre."
  Start-Process cmd -ArgumentList '/c', "timeout /t 3 >nul & rmdir /s /q `"$RepoRoot`"" -WindowStyle Hidden
}

Step "Termine"
Ok "Agentic-Hub a ete desinstalle."
Read-Host "Appuie sur Entree pour fermer"
