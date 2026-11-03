<#
  Lance le service d'écoute en direct (`aqr live-serve`, port 8765) à côté d'un atelier lancé à la main
  (`npm run dev` / `next start`). Sans lui, l'écran « En direct » affiche « Impossible de joindre le
  service d'écoute ». Le script d'atelier de test (`scripts/testeurs/atelier-testeurs.ps1 start`) le
  lance déjà lui-même : celui-ci sert pour un atelier local sans tunnel.

  Il reprend la clé de signature de l'atelier (live-signing.key de AQR_REVIEW_DIR) : sans la même clé,
  le service refuserait les jetons de l'atelier. Idempotent : si le service répond déjà, il ne fait rien.

  Usage :  .\scripts\live-serve.ps1            (démarre si besoin)
           .\scripts\live-serve.ps1 -Stop      (l'arrête)
#>
param(
    [string]$ReviewDir = $(if ($env:AQR_REVIEW_DIR) { $env:AQR_REVIEW_DIR } else { 'D:\01-Dev\Data\aqr-review' }),
    [string]$ModelsDir = $(if ($env:AQR_MODELS_DIR) { $env:AQR_MODELS_DIR } else { 'D:\01-Dev\Data\aqr-models' }),
    [int]$Port = 8765,
    [switch]$Stop
)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $Repo '.venv\Scripts\python.exe'
$Corpus = if ($env:AQR_CORPUS_DIR) { $env:AQR_CORPUS_DIR } else { Join-Path $Repo 'data\corpus' }
$Key = Join-Path $ReviewDir 'live-signing.key'
$LogDir = Join-Path (Split-Path -Parent $ReviewDir) 'tmp\live'

function Test-Live {
    try { return (Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 }
    catch { return $false }
}

if ($Stop) {
    Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'aqr\.cli.*live-serve' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "service du direct arrêté (pid $($_.ProcessId))" }
    return
}
if (Test-Live) { Write-Host "Le service du direct répond déjà sur le port $Port."; return }
if (-not (Test-Path $Python)) { throw "Python du dépôt introuvable : $Python (créer .venv puis pip install -e '.[live,muno]')" }
if (-not (Test-Path $Key)) { throw "clé de signature introuvable : $Key (lancer l'atelier une fois : il la crée)" }

New-Item -ItemType Directory -Force $LogDir | Out-Null
$env:AQR_REVIEW_DIR = $ReviewDir
$env:AQR_MODELS_DIR = $ModelsDir
$env:AQR_CORPUS_DIR = $Corpus
$env:AQR_LIVE_KEY_FILE = $Key
$proc = Start-Process -FilePath $Python `
    -ArgumentList @('-m', 'aqr.cli', 'live-serve', '--port', "$Port", '--corpus-dir', $Corpus, '--asr-threads', '2', '--warm-translations', 'french_hameedullah') `
    -RedirectStandardOutput (Join-Path $LogDir 'live.log') -RedirectStandardError (Join-Path $LogDir 'live.err.log') `
    -WindowStyle Hidden -PassThru
Write-Host "démarrage du service du direct (pid $($proc.Id)), chargement du modèle…"
for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 2
    if ($proc.HasExited) { throw "le service s'est arrêté : voir $LogDir\live.err.log" }
    if (Test-Live) { Write-Host "Service du direct prêt : ws://127.0.0.1:$Port/live"; return }
}
throw "le service du direct ne répond pas après 3 minutes : voir $LogDir\live.err.log"
