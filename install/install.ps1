<#
  Agentic-Hub — Installeur Windows (sans Node/npm).
  Tout tourne dans Docker. Ce script :
    1. vérifie Docker Desktop (et propose de l'installer via winget) ;
    2. détecte le matériel (GPU NVIDIA / VRAM ou RAM) et choisit le modèle Ollama ;
    3. prépare .env (ports libres, modèle) ;
    4. build + démarre la stack (postgres, ollama, api, web) ;
    5. télécharge le modèle LLM ;
    6. ouvre l'interface dans le navigateur.
#>
$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path

function Info($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  $m" -ForegroundColor Yellow }
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Magenta }

# ── 1. Docker ────────────────────────────────────────────────
function Test-Docker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
  docker info *> $null
  return ($LASTEXITCODE -eq 0)
}

Step "Vérification de Docker"
if (-not (Test-Docker)) {
  Warn "Docker n'est pas disponible (non installé ou non démarré)."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $r = Read-Host "  Installer Docker Desktop via winget maintenant ? (o/N)"
    if ($r -eq 'o' -or $r -eq 'O') {
      winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
      Warn "Docker Desktop installé. Démarre-le (icône Docker), attends qu'il soit prêt, puis relance ce script."
      Read-Host "Appuie sur Entrée pour quitter"; exit 1
    }
  }
  Warn "Installe Docker Desktop : https://www.docker.com/products/docker-desktop/"
  Warn "Démarre-le puis relance ce script."
  Read-Host "Appuie sur Entrée pour quitter"; exit 1
}
Ok "Docker est prêt."

# ── 2. Détection matériel + choix du modèle ──────────────────
function Get-LlmPlan {
  $vram = $null
  if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    try {
      $v = (& nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>$null | Select-Object -First 1)
      if ($v -match '^\s*\d+\s*$') { $vram = [int]$v.Trim() / 1024.0 }
    } catch {}
  }
  if ($vram) {
    $mem = [math]::Round($vram, 1); $gpu = $true
    if     ($mem -lt 5)  { $model = 'qwen2.5-coder:1.5b' }
    elseif ($mem -lt 9)  { $model = 'qwen2.5-coder:3b' }
    elseif ($mem -lt 18) { $model = 'qwen2.5-coder:7b' }
    else                 { $model = 'qwen2.5-coder:14b' }
  } else {
    $mem = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1); $gpu = $false
    if     ($mem -lt 6)  { $model = 'qwen2.5-coder:1.5b' }
    elseif ($mem -lt 12) { $model = 'qwen2.5-coder:3b' }
    else                 { $model = 'qwen2.5-coder:7b' }  # CPU : on plafonne à 7b
  }
  return [pscustomobject]@{ Model = $model; UseGpu = $gpu; MemGB = $mem }
}

Step "Détection du matériel"
$plan = Get-LlmPlan
if ($plan.UseGpu) { Ok ("GPU NVIDIA détecté — {0} Go VRAM → modèle {1} (GPU)" -f $plan.MemGB, $plan.Model) }
else              { Ok ("Pas de GPU NVIDIA — {0} Go RAM → modèle {1} (CPU)" -f $plan.MemGB, $plan.Model) }

# ── 3. Préparation du .env (ports libres + modèle) ───────────
function Test-PortFree($p) {
  -not (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}
function Pick-Port($cands) { foreach ($p in $cands) { if (Test-PortFree $p) { return $p } }; return $cands[0] }
function Set-EnvVar($path, $key, $value) {
  $lines = if (Test-Path $path) { Get-Content $path } else { @() }
  $found = $false
  $out = foreach ($l in $lines) { if ($l -match "^\s*$([regex]::Escape($key))=") { $found = $true; "$key=$value" } else { $l } }
  if (-not $found) { $out += "$key=$value" }
  Set-Content -Path $path -Value $out -Encoding UTF8
}
function Get-EnvVar($path, $key) {
  if (-not (Test-Path $path)) { return $null }
  $m = Select-String -Path $path -Pattern "^\s*$([regex]::Escape($key))=(.*)$" | Select-Object -First 1
  if ($m) { return $m.Matches[0].Groups[1].Value.Trim() } else { return $null }
}
# Réutilise un port déjà choisi (install existante), sinon en pick un libre.
function Resolve-Port($path, $key, $cands) {
  $cur = Get-EnvVar $path $key
  if ($cur -match '^\d+$') { return [int]$cur }
  return (Pick-Port $cands)
}

Step "Configuration (.env)"
$envPath = Join-Path $RepoRoot '.env'
if (-not (Test-Path $envPath)) {
  Copy-Item (Join-Path $RepoRoot '.env.example') $envPath
  Info ".env créé depuis .env.example (pense à renseigner les clés GitHub OAuth pour la connexion par compte)."
} else {
  Info ".env existant conservé (secrets préservés)."
}

$apiPort = Resolve-Port $envPath 'API_HOST_PORT' @(3000, 3200, 3300, 4000, 4100, 5005)
$webPort = Resolve-Port $envPath 'WEB_PORT' @(8080, 8088, 8090, 8200, 8888)
Set-EnvVar $envPath 'API_HOST_PORT' $apiPort
Set-EnvVar $envPath 'WEB_PORT' $webPort
Set-EnvVar $envPath 'WEB_ORIGIN' "http://localhost:$webPort"
Set-EnvVar $envPath 'VITE_API_BASE' "http://localhost:$apiPort"
Set-EnvVar $envPath 'OLLAMA_MODEL' $plan.Model
Ok "API:$apiPort  Web:$webPort  Modèle:$($plan.Model)"

# ── 4. Build + démarrage ─────────────────────────────────────
$composeArgs = @('--env-file', $envPath, '-f', (Join-Path $RepoRoot 'infra\docker-compose.yml'))
if ($plan.UseGpu) { $composeArgs += @('-f', (Join-Path $RepoRoot 'infra\docker-compose.gpu.yml')) }

Step "Construction et démarrage de la stack (peut prendre plusieurs minutes)"
docker compose @composeArgs up -d --build
if ($LASTEXITCODE -ne 0 -and $plan.UseGpu) {
  Warn "Échec avec le GPU — nouvelle tentative en mode CPU."
  $composeArgs = @('--env-file', $envPath, '-f', (Join-Path $RepoRoot 'infra\docker-compose.yml'))
  docker compose @composeArgs up -d --build
}
if ($LASTEXITCODE -ne 0) { Warn "Le démarrage a échoué. Voir 'docker compose logs'."; Read-Host "Entrée pour quitter"; exit 1 }
Ok "Stack démarrée."

# ── 5. Téléchargement du modèle LLM ──────────────────────────
Step "Téléchargement du modèle $($plan.Model) (une seule fois)"
docker compose @composeArgs exec -T ollama ollama pull $plan.Model
if ($LASTEXITCODE -ne 0) { Warn "Le pull du modèle a échoué — la narration LLM utilisera le fallback. Tu peux réessayer plus tard." }
else { Ok "Modèle prêt." }

# ── 6. Ouverture du navigateur ───────────────────────────────
Step "Terminé !"
Ok "Interface : http://localhost:$webPort"
Ok "API       : http://localhost:$apiPort/api/health"
Info "Pour connecter ton compte GitHub : renseigne GITHUB_OAUTH_CLIENT_ID/SECRET dans .env (voir README), relance, puis clique « Se connecter »."
Start-Process "http://localhost:$webPort"
Read-Host "Appuie sur Entrée pour fermer cette fenêtre"
