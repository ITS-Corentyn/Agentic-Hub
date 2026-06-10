<#
  Agentic-Hub - Installeur Windows (sans Node/npm). Tout tourne dans Docker.
  (Texte volontairement en ASCII : Windows PowerShell 5.1 lit les .ps1 sans BOM
   en ANSI, donc les accents casseraient l'analyse.)
    1. verifie / demarre Docker Desktop ;
    2. detecte le materiel (GPU NVIDIA / VRAM ou RAM) et choisit le modele Ollama ;
    3. prepare .env (ports libres, modele) ;
    4. build + demarre la stack (postgres, ollama, api, web) ;
    5. telecharge le modele LLM ;
    6. ouvre l'interface dans le navigateur.
#>
# EAP=Continue : les commandes natives (docker, git, ollama) ecrivent sur stderr ;
# sous 'Stop' cela ferait planter le script. On verifie les codes de sortie a la main.
$ErrorActionPreference = 'Continue'
$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path

function Info($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  $m" -ForegroundColor Yellow }
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Magenta }

# -- 1. Docker ------------------------------------------------
function Test-DockerCli { [bool](Get-Command docker -ErrorAction SilentlyContinue) }
function Test-DockerDaemon {
  & docker info > $null 2>&1
  return ($LASTEXITCODE -eq 0)
}
function Start-DockerDesktop {
  $candidats = @(
    (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Docker\Docker\Docker Desktop.exe'),
    (Join-Path $env:LOCALAPPDATA 'Docker\Docker Desktop.exe')
  )
  $exe = $candidats | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if ($exe) { Start-Process $exe | Out-Null; return $true }
  return $false
}

Step "Verification de Docker"
if (-not (Test-DockerCli)) {
  Warn "Docker n'est pas installe."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $r = Read-Host "  Installer Docker Desktop via winget maintenant ? (o/N)"
    if ($r -eq 'o' -or $r -eq 'O') {
      winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
      Warn "Docker Desktop installe. Demarre-le (icone Docker), attends l'icone verte, puis relance ce script."
      Read-Host "Appuie sur Entree pour quitter"; exit 1
    }
  }
  Warn "Installe Docker Desktop : https://www.docker.com/products/docker-desktop/"
  Read-Host "Appuie sur Entree pour quitter"; exit 1
}

if (-not (Test-DockerDaemon)) {
  Warn "Docker Desktop est installe mais le moteur n'est pas demarre."
  if (Start-DockerDesktop) {
    Info "Demarrage de Docker Desktop en cours... (jusqu'a 180s)"
    $deadline = (Get-Date).AddSeconds(180)
    while (((Get-Date) -lt $deadline) -and (-not (Test-DockerDaemon))) { Start-Sleep -Seconds 3 }
  } else {
    Warn "Lance Docker Desktop manuellement, attends l'icone verte, puis relance ce script."
  }
  if (-not (Test-DockerDaemon)) {
    Warn "Le moteur Docker n'est toujours pas pret. Ouvre Docker Desktop, attends qu'il soit 'running', puis relance ce script."
    Read-Host "Appuie sur Entree pour quitter"; exit 1
  }
}
Ok "Docker est pret."

# -- 2. Detection materiel + choix du modele ------------------
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
    else                 { $model = 'qwen2.5-coder:7b' }  # CPU : on plafonne a 7b
  }
  return [pscustomobject]@{ Model = $model; UseGpu = $gpu; MemGB = $mem }
}

Step "Detection du materiel"
$plan = Get-LlmPlan
if ($plan.UseGpu) { Ok ("GPU NVIDIA detecte - {0} Go VRAM -> modele {1} (GPU)" -f $plan.MemGB, $plan.Model) }
else              { Ok ("Pas de GPU NVIDIA - {0} Go RAM -> modele {1} (CPU)" -f $plan.MemGB, $plan.Model) }

# -- 3. Preparation du .env (ports libres + modele) -----------
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
# Reutilise un port deja choisi (install existante), sinon en pick un libre.
function Resolve-Port($path, $key, $cands) {
  $cur = Get-EnvVar $path $key
  if ($cur -match '^\d+$') { return [int]$cur }
  return (Pick-Port $cands)
}

Step "Configuration (.env)"
$envPath = Join-Path $RepoRoot '.env'
if (-not (Test-Path $envPath)) {
  Copy-Item (Join-Path $RepoRoot '.env.example') $envPath
  Info ".env cree depuis .env.example (pense a renseigner les cles GitHub OAuth pour la connexion par compte)."
} else {
  Info ".env existant conserve (secrets preserves)."
}

$apiPort = Resolve-Port $envPath 'API_HOST_PORT' @(3000, 3200, 3300, 4000, 4100, 5005)
$webPort = Resolve-Port $envPath 'WEB_PORT' @(8080, 8088, 8090, 8200, 8888)
Set-EnvVar $envPath 'API_HOST_PORT' $apiPort
Set-EnvVar $envPath 'WEB_PORT' $webPort
Set-EnvVar $envPath 'WEB_ORIGIN' "http://localhost:$webPort"
Set-EnvVar $envPath 'VITE_API_BASE' "http://localhost:$apiPort"
Set-EnvVar $envPath 'OLLAMA_MODEL' $plan.Model
Ok "API:$apiPort  Web:$webPort  Modele:$($plan.Model)"

# -- 4. Build + demarrage -------------------------------------
$composeArgs = @('--env-file', $envPath, '-f', (Join-Path $RepoRoot 'infra\docker-compose.yml'))
if ($plan.UseGpu) { $composeArgs += @('-f', (Join-Path $RepoRoot 'infra\docker-compose.gpu.yml')) }

Step "Construction et demarrage de la stack (peut prendre plusieurs minutes)"
& docker compose @composeArgs up -d --build 2>&1 | Write-Host
if ($LASTEXITCODE -ne 0 -and $plan.UseGpu) {
  Warn "Echec avec le GPU - nouvelle tentative en mode CPU."
  $composeArgs = @('--env-file', $envPath, '-f', (Join-Path $RepoRoot 'infra\docker-compose.yml'))
  & docker compose @composeArgs up -d --build 2>&1 | Write-Host
}
if ($LASTEXITCODE -ne 0) { Warn "Le demarrage a echoue. Voir 'docker compose logs'."; Read-Host "Entree pour quitter"; exit 1 }
Ok "Stack demarree."

# -- 5. Telechargement du modele LLM --------------------------
Step "Telechargement du modele $($plan.Model) (une seule fois, peut etre long)"
& docker compose @composeArgs exec -T ollama ollama pull $plan.Model 2>&1 | Write-Host
if ($LASTEXITCODE -ne 0) { Warn "Le pull du modele a echoue - la narration LLM utilisera le fallback. Tu peux reessayer plus tard." }
else { Ok "Modele pret." }

# -- 6. Ouverture du navigateur -------------------------------
Step "Termine !"
Ok "Interface : http://localhost:$webPort"
Ok "API       : http://localhost:$apiPort/api/health"
Info "Pour connecter ton compte GitHub : renseigne GITHUB_OAUTH_CLIENT_ID/SECRET dans .env (voir README), relance, puis clique sur Se connecter."
Start-Process "http://localhost:$webPort"
Read-Host "Appuie sur Entree pour fermer cette fenetre"
