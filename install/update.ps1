<#
  Agentic-Hub - Mise a jour (Windows). ASCII uniquement (PowerShell 5.1).
  - git fetch : ne fait rien si rien n'a change ;
  - git pull si en retard ;
  - reconstruit les images SEULEMENT si la logique applicative a change
    (apps/ packages/ scanners/ infra/ Dockerfile/ lockfile) ; sinon redemarrage leger ;
  - applique les migrations au demarrage de l'API.
  -Auto : mode silencieux (tache planifiee), sans prompt, journalise, tolerant si
          Docker est eteint (les images se mettront a jour au prochain demarrage).
#>
param([string]$RepoRoot, [switch]$Auto)
$ErrorActionPreference = 'Continue'
if (-not $RepoRoot) { $RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path }
else { try { $RepoRoot = (Resolve-Path $RepoRoot).Path } catch {} }

function Info($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  $m" -ForegroundColor Yellow }
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Magenta }
function Pause-IfInteractive { if (-not $Auto) { Read-Host "Appuie sur Entree pour fermer" } }

# Journalisation en mode auto.
if ($Auto) {
  $logDir = Join-Path $RepoRoot 'logs'
  if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
  try { Start-Transcript -Path (Join-Path $logDir 'auto-update.log') -Append | Out-Null } catch {}
  Write-Host "[auto-update] $(Get-Date -Format s)"
}

# -- Pre-requis git --
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Warn "Git introuvable. Relance Install-Windows.cmd."; Pause-IfInteractive
  if ($Auto) { try { Stop-Transcript | Out-Null } catch {} }
  exit 1
}

function Test-DockerDaemon { & docker info > $null 2>&1; return ($LASTEXITCODE -eq 0) }
function Start-DockerDesktop {
  $c = @(
    (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'),
    (Join-Path $env:LOCALAPPDATA 'Docker\Docker Desktop.exe')
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if ($c) { Start-Process $c | Out-Null; return $true }
  return $false
}

$dockerUp = Test-DockerDaemon
if (-not $dockerUp -and -not $Auto) {
  Warn "Docker n'est pas demarre - tentative de demarrage..."
  Start-DockerDesktop | Out-Null
  $deadline = (Get-Date).AddSeconds(180)
  while (((Get-Date) -lt $deadline) -and (-not (Test-DockerDaemon))) { Start-Sleep -Seconds 3 }
  $dockerUp = Test-DockerDaemon
  if (-not $dockerUp) { Warn "Docker indisponible. Ouvre Docker Desktop puis relance."; Pause-IfInteractive; exit 1 }
}

# -- Y a-t-il une mise a jour ? --
Step "Verification des mises a jour"
& git -C $RepoRoot fetch --quiet origin 2>&1 | Out-Null
$old = (& git -C $RepoRoot rev-parse HEAD 2>$null).Trim()
$remote = (& git -C $RepoRoot rev-parse '@{u}' 2>$null)
if (-not $remote) {
  $branch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null).Trim()
  $remote = (& git -C $RepoRoot rev-parse "origin/$branch" 2>$null)
}
$remote = "$remote".Trim()
if (-not $remote -or $old -eq $remote) {
  Ok "Tu es deja a jour (aucun changement sur le depot)."
  if ($Auto) { try { Stop-Transcript | Out-Null } catch {} }
  Pause-IfInteractive; exit 0
}

$behind = ("" + (& git -C $RepoRoot rev-list "$old..$remote" --count 2>$null)).Trim()
Step "Mise a jour disponible ($behind commit(s)) - application..."
& git -C $RepoRoot pull --ff-only 2>&1 | Write-Host
$new = (& git -C $RepoRoot rev-parse HEAD 2>$null).Trim()

# -- Faut-il reconstruire ? (uniquement si la logique applicative a change) --
$changed = & git -C $RepoRoot diff --name-only "$old" "$new" 2>$null
$needBuild = @($changed | Where-Object {
  $_ -match '^(apps/|packages/|scanners/|infra/|pnpm-lock\.yaml|package\.json|.*Dockerfile)'
}).Count -gt 0

# Docker eteint en mode auto : on s'arrete apres le pull (images au prochain demarrage).
if (-not $dockerUp) {
  Warn "Docker est arrete - le code est a jour ; les images se reconstruiront au prochain demarrage."
  if ($Auto) { try { Stop-Transcript | Out-Null } catch {} }
  Pause-IfInteractive; exit 0
}

# -- GPU ? (re-detection pour preserver l'acceleration) --
$useGpu = $false
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
  $v = (& nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>$null | Select-Object -First 1)
  if ($v -match '^\s*\d+\s*$') { $useGpu = $true }
}

$env:GIT_SHA = $new  # version deployee (bandeau "mise a jour")
$envPath = Join-Path $RepoRoot '.env'
$composeArgs = @('--env-file', $envPath, '-f', (Join-Path $RepoRoot 'infra\docker-compose.yml'))
if ($useGpu) { $composeArgs += @('-f', (Join-Path $RepoRoot 'infra\docker-compose.gpu.yml')) }

if ($needBuild) {
  Step "Reconstruction des images impactees (peut prendre quelques minutes)"
  & docker compose @composeArgs up -d --build 2>&1 | Write-Host
  if ($LASTEXITCODE -ne 0 -and $useGpu) {
    Warn "Echec GPU - nouvelle tentative en mode CPU."
    $composeArgs = @('--env-file', $envPath, '-f', (Join-Path $RepoRoot 'infra\docker-compose.yml'))
    & docker compose @composeArgs up -d --build 2>&1 | Write-Host
  }
} else {
  Info "Changements non applicatifs (docs/config) - redemarrage leger."
  & docker compose @composeArgs up -d 2>&1 | Write-Host
}

if ($LASTEXITCODE -ne 0) { Warn "La mise a jour a rencontre une erreur. Voir 'docker compose logs'." }
else { Ok "Mise a jour terminee ! ($old --> $new)" }
if ($Auto) { try { Stop-Transcript | Out-Null } catch {} }
Pause-IfInteractive
