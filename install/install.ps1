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

# Pull d'un modele Ollama avec une barre de progression sur UNE seule ligne
# (via l'API HTTP en streaming). Renvoie $true si OK, $false pour fallback CLI.
function Invoke-OllamaPull($model, $port) {
  $uri = "http://localhost:$port/api/pull"
  $body = "{`"model`":`"$model`",`"stream`":true}"
  try {
    $req = [System.Net.HttpWebRequest]::Create($uri)
    $req.Method = 'POST'
    $req.ContentType = 'application/json'
    $req.Timeout = 60000
    $req.ReadWriteTimeout = [int]::MaxValue
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $req.ContentLength = $bytes.Length
    $rs = $req.GetRequestStream(); $rs.Write($bytes, 0, $bytes.Length); $rs.Close()
    $resp = $req.GetResponse()
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $last = ''
    while (-not $reader.EndOfStream) {
      $line = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($line)) { continue }
      try { $o = $line | ConvertFrom-Json } catch { continue }
      if ($o.error) { Write-Host ''; Warn "Ollama: $($o.error)"; return $false }
      $status = [string]$o.status
      if ($o.total -and [double]$o.total -gt 0) {
        $pct = [int][math]::Floor(([double]$o.completed / [double]$o.total) * 100)
        $fill = [int][math]::Floor($pct / 2)
        $bar = ('#' * $fill) + ('.' * (50 - $fill))
        $go = "{0:N2}/{1:N2} Go" -f ([double]$o.completed / 1GB), ([double]$o.total / 1GB)
        Write-Host ("`r  [{0}] {1,3}%  {2}  {3}        " -f $bar, $pct, $go, $status) -NoNewline -ForegroundColor Cyan
      } elseif ($status -ne $last) {
        Write-Host ("`r  {0}{1}" -f $status, (' ' * 60)) -NoNewline -ForegroundColor Cyan
      }
      $last = $status
    }
    $reader.Close(); $resp.Close()
    Write-Host ''
    return $true
  } catch {
    Write-Host ''
    return $false
  }
}

# Assistant pas-a-pas pour configurer l'OAuth GitHub (depuis l'installeur).
function Invoke-GithubOAuthSetup($envPath, $apiPort, $webPort, $composeArgs) {
  Step "Connexion GitHub (recommande - pour auditer tes repos)"
  if (Get-EnvVar $envPath 'GITHUB_OAUTH_CLIENT_ID') {
    Ok "OAuth GitHub deja configure. Dans l'appli : 'Se connecter' puis 'Synchroniser GitHub'."
    return
  }
  $cb = "http://localhost:$apiPort/api/auth/github/callback"
  Info "Cree une 'OAuth App' GitHub (2 min) pour recuperer TES repos et ceux de tes organisations :"
  Write-Host ''
  Write-Host "    1) Ouvre : https://github.com/settings/developers" -ForegroundColor White
  Write-Host "       (Settings -> Developer settings -> OAuth Apps)" -ForegroundColor DarkGray
  Write-Host "    2) Clique 'New OAuth App'" -ForegroundColor White
  Write-Host "    3) Remplis les champs :" -ForegroundColor White
  Write-Host "         Application name            : Agentic-Hub" -ForegroundColor White
  Write-Host "         Homepage URL                : http://localhost:$webPort" -ForegroundColor White
  Write-Host "         Authorization callback URL  : $cb" -ForegroundColor Yellow
  Write-Host "    4) Clique 'Register application'" -ForegroundColor White
  Write-Host "    5) Copie le 'Client ID' affiche" -ForegroundColor White
  Write-Host "    6) Clique 'Generate a new client secret' et copie la valeur" -ForegroundColor White
  Write-Host ''
  $open = Read-Host "  Ouvrir la page GitHub maintenant ? (O/n)"
  if ($open -ne 'n' -and $open -ne 'N') { Start-Process "https://github.com/settings/developers" | Out-Null }

  $cid = Read-Host "  Colle ton Client ID (ou Entree pour configurer plus tard)"
  if ([string]::IsNullOrWhiteSpace($cid)) {
    Warn "Etape ignoree. Tu pourras configurer OAuth plus tard (voir README), puis relancer l'installeur."
    return
  }
  $sec = Read-Host "  Colle ton Client Secret"
  if ([string]::IsNullOrWhiteSpace($sec)) { Warn "Secret vide - etape ignoree."; return }

  Set-EnvVar $envPath 'GITHUB_OAUTH_CLIENT_ID' $cid.Trim()
  Set-EnvVar $envPath 'GITHUB_OAUTH_CLIENT_SECRET' $sec.Trim()
  Set-EnvVar $envPath 'GITHUB_OAUTH_CALLBACK_URL' $cb
  Info "Application de la configuration (redemarrage de l'API)..."
  & docker compose @composeArgs up -d api 2>&1 | Write-Host
  Ok "OAuth configure ! Dans l'appli : clique 'Se connecter' puis 'Synchroniser GitHub'."
}

# Active la mise a jour automatique via une tache planifiee schtasks (toutes les
# 2h, en arriere-plan). schtasks /SC HOURLY ne necessite PAS de droits admin.
function Enable-AutoUpdate($repoRoot) {
  Step "Mises a jour automatiques"
  $taskName = 'AgenticHub-AutoUpdate'
  schtasks /Query /TN $taskName *> $null
  if ($LASTEXITCODE -eq 0) {
    Ok "Deja activees (verification toutes les 2h, en arriere-plan)."
    return
  }
  $ans = Read-Host "  Activer la mise a jour automatique (toutes les 2h, en arriere-plan) ? (O/n)"
  if ($ans -eq 'n' -or $ans -eq 'N') {
    Info "Desactivee. Tu pourras mettre a jour avec Update-Windows.cmd."
    return
  }
  $wrapper = Join-Path $repoRoot 'install\auto-update-run.cmd'
  $out = schtasks /Create /TN $taskName /TR "`"$wrapper`"" /SC HOURLY /MO 2 /F 2>&1
  if ($LASTEXITCODE -eq 0) {
    Ok "Mises a jour automatiques activees (verification toutes les 2h)."
    Info "Pour desactiver : schtasks /Delete /TN $taskName /F"
  } else {
    Warn ("Impossible de creer la tache planifiee : " + ($out -join ' '))
    Info "Tu pourras mettre a jour manuellement avec Update-Windows.cmd."
  }
}

Step "Configuration (.env)"
$envPath = Join-Path $RepoRoot '.env'
if (-not (Test-Path $envPath)) {
  Copy-Item (Join-Path $RepoRoot '.env.example') $envPath
  Info ".env cree depuis .env.example (pense a renseigner les cles GitHub OAuth pour la connexion par compte)."
} else {
  Info ".env existant conserve (secrets preserves)."
}

$apiPort    = Resolve-Port $envPath 'API_HOST_PORT'     @(3000, 3200, 3300, 4000, 4100, 5005)
$webPort    = Resolve-Port $envPath 'WEB_PORT'          @(8080, 8088, 8090, 8200, 8888)
$pgPort     = Resolve-Port $envPath 'POSTGRES_HOST_PORT' @(5432, 5433, 5440, 15432, 55432)
$ollamaPort = Resolve-Port $envPath 'OLLAMA_HOST_PORT'  @(11434, 11435, 11440, 21434)
Set-EnvVar $envPath 'API_HOST_PORT' $apiPort
Set-EnvVar $envPath 'WEB_PORT' $webPort
Set-EnvVar $envPath 'POSTGRES_HOST_PORT' $pgPort
Set-EnvVar $envPath 'OLLAMA_HOST_PORT' $ollamaPort
Set-EnvVar $envPath 'WEB_ORIGIN' "http://localhost:$webPort"
Set-EnvVar $envPath 'VITE_API_BASE' "http://localhost:$apiPort"
Set-EnvVar $envPath 'OLLAMA_MODEL' $plan.Model
Ok "API:$apiPort  Web:$webPort  DB:$pgPort  Ollama:$ollamaPort  Modele:$($plan.Model)"

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

# -- 5. Configuration GitHub OAuth (guide pas a pas) ----------
Invoke-GithubOAuthSetup $envPath $apiPort $webPort $composeArgs

# -- 6. Telechargement du modele LLM (barre de progression) ---
Step "Telechargement du modele $($plan.Model) (une seule fois, peut etre long)"
if (Invoke-OllamaPull $plan.Model $ollamaPort) {
  Ok "Modele pret."
} else {
  Warn "Telechargement standard en cours (barre indisponible)..."
  & docker compose @composeArgs exec -T ollama ollama pull $plan.Model 2>&1 | Write-Host
  if ($LASTEXITCODE -ne 0) { Warn "Le pull du modele a echoue - la narration LLM utilisera le fallback." }
  else { Ok "Modele pret." }
}

# -- 6.5 Mises a jour automatiques ----------------------------
Enable-AutoUpdate $RepoRoot

# -- 7. Ouverture du navigateur -------------------------------
Step "Termine !"
Ok "Interface : http://localhost:$webPort"
Ok "API       : http://localhost:$apiPort/api/health"
Start-Process "http://localhost:$webPort"
Read-Host "Appuie sur Entree pour fermer cette fenetre"
