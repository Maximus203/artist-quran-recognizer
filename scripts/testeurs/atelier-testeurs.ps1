<#
.SYNOPSIS
  Atelier de test distant : atelier Next.js (port 3200) exposé par un tunnel Cloudflare (quick tunnel).

.DESCRIPTION
  start   : arrête ce qui tourne, lance cloudflared, lit l'adresse publique, lance l'atelier avec
            AQR_ACCESS_TOKEN, AQR_ALLOWED_HOSTS et AQR_PUBLIC_ORIGIN, puis vérifie qu'il répond.
  stop    : arrête le tunnel et l'atelier lancés par ce script (et les orphelins du même port).
  restart : stop puis start. Ajouter -Build après un git pull (reconstruit l'interface).
  status  : affiche l'état et l'adresse publique courante.
  install : crée la tâche planifiée « AtelierTesteurs » (démarrage à chaque ouverture de session).
  uninstall : supprime cette tâche.

  Écoute en direct (ADR-0011) : `start` lance aussi le service `aqr live-serve` (port 8765) et un second
  tunnel pour son WebSocket (le micro exige https, donc wss). Atelier et service partagent une clé de
  signature créée au premier démarrage (live-key.txt, jamais dans Git). -NoLive pour s'en passer.

  L'adresse cloudflared (quick tunnel) change à chaque démarrage. Elle est écrite dans
  D:\01-Dev\Data\aqr-tunnel\url.txt (atelier) et live-url.txt (direct).

  Essai jetable, sans toucher au tunnel ni aux données des testeurs :
  -Port 3420 -LivePort 8770 -StateDir <dossier> -ReviewDir <dossier> (token.txt à créer dans StateDir).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\testeurs\atelier-testeurs.ps1 -Action restart
#>
param(
    [ValidateSet('start', 'stop', 'restart', 'status', 'install', 'uninstall')]
    [string]$Action = 'status',
    [switch]$Build,
    [int]$Port = 3200,
    # Écoute en direct (ADR-0011) : le service `aqr live-serve` démarre à côté de l'atelier, avec son propre
    # tunnel (le WebSocket ne passe pas par le port de l'atelier). -NoLive pour ne pas le lancer.
    [int]$LivePort = 8765,
    [switch]$NoLive,
    # Dossiers d'état et de données : à changer pour un essai jetable (ne touche alors ni le tunnel ni les
    # données des testeurs).
    [string]$StateDir = 'D:\01-Dev\Data\aqr-tunnel',
    [string]$ReviewDir = 'D:\01-Dev\Data\aqr-review-testeurs'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:Path ='C:\Users\diouf\AppData\Local\nvm\v24.19.0;' + $env:Path

# Racine du checkout qui contient ce script (web/ et src/ en dépendent).
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Web = Join-Path $Root 'web'
$State = $StateDir
$StateFile = Join-Path $State 'etat.json'
$UrlFile = Join-Path $State 'url.txt'
$LiveUrlFile = Join-Path $State 'live-url.txt'
$TokenFile = Join-Path $State 'token.txt'
# Clé de signature des jetons du direct, partagée par l'atelier et le service : créée au premier démarrage,
# jamais dans Git.
$LiveKeyFile = Join-Path $State 'live-key.txt'
$LogDir = Join-Path $State 'logs'
$ModelsDir = 'D:\01-Dev\Data\aqr-models'
$FontsDir = 'D:\01-Dev\Data\aqr-fonts'
# Le venv du checkout principal : son installation éditable est remplacée par PYTHONPATH (voir plus bas).
$Python = 'D:\01-Dev\Perso\artist-quran-recognizer\.venv\Scripts\python.exe'
$Cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'

function Log([string]$Message) {
    Write-Host ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Message)
}

function Read-State {
    if (Test-Path $StateFile) { return Get-Content $StateFile -Raw | ConvertFrom-Json }
    return $null
}

function Stop-All {
    $state = Read-State
    if ($state) {
        foreach ($id in @($state.cloudflaredPid, $state.nodePid, $state.liveCloudflaredPid, $state.livePid)) {
            if ($id) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
        }
    }
    # Orphelins de ces tunnels (mêmes ports) ; un autre processus sur le port n'est arrêté que s'il est Next
    # (atelier) ou le service du direct (`aqr live-serve`).
    foreach ($p in @($Port, $LivePort)) {
        Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
            Where-Object { $_.CommandLine -match "127\.0\.0\.1:$p(\s|$)" } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    }
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"
            if ($proc -and $proc.CommandLine -match 'next') {
                Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
            }
        }
    Get-NetTCPConnection -LocalPort $LivePort -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"
            if ($proc -and $proc.CommandLine -match 'live-serve') {
                Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
            }
        }
    if (Test-Path $StateFile) { Remove-Item $StateFile -Force }
    Log 'arrêté'
}

# Tunnel Cloudflare rapide vers un port local : rend @{ pid; url }. Le réseau peut ne pas être prêt au
# démarrage : on réessaie jusqu'à 10 minutes.
function Start-QuickTunnel([int]$TargetPort, [string]$Name) {
    $deadline = (Get-Date).AddMinutes(10)
    $url = $null
    $cfPid = $null
    $cfLog = Join-Path $LogDir "$Name.log"
    while (-not $url) {
        Remove-Item $cfLog -ErrorAction SilentlyContinue
        $cf = Start-Process -FilePath $Cloudflared `
            -ArgumentList @('tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$TargetPort") `
            -WindowStyle Hidden -PassThru `
            -RedirectStandardError $cfLog -RedirectStandardOutput (Join-Path $LogDir "$Name.out")
        $cfPid = $cf.Id
        $t0 = Get-Date
        while (-not $url -and ((Get-Date) - $t0).TotalSeconds -lt 60 -and -not $cf.HasExited) {
            Start-Sleep -Seconds 2
            if (Test-Path $cfLog) {
                $match = Select-String -Path $cfLog -Pattern 'https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com' |
                    Select-Object -First 1
                if ($match) { $url = $match.Matches[0].Value }
            }
        }
        if (-not $url) {
            Stop-Process -Id $cfPid -Force -ErrorAction SilentlyContinue
            if ((Get-Date) -gt $deadline) { throw 'pas d''adresse cloudflared après 10 minutes (réseau ?)' }
            Log 'pas d''adresse cloudflared, nouvel essai dans 20 s'
            Start-Sleep -Seconds 20
        }
    }
    return @{ pid = $cfPid; url = $url }
}

# Secret créé au premier démarrage (32 octets aléatoires, dans le dossier d'état, jamais dans Git) puis relu.
function Get-Secret([string]$File) {
    if (-not (Test-Path $File)) {
        $bytes = New-Object byte[] 32
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        Set-Content -Encoding ascii $File ([Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_'))
    }
    return (Get-Content $File -Raw).Trim()
}

# Clé de signature du direct.
function Get-LiveKey { return Get-Secret $LiveKeyFile }

function Start-All {
    Stop-All
    if (-not (Test-Path $TokenFile)) { throw "jeton absent : $TokenFile" }
    if (-not (Test-Path $Cloudflared)) { throw "cloudflared introuvable : $Cloudflared (winget install Cloudflare.cloudflared)" }
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $token = (Get-Content $TokenFile -Raw).Trim()
    if ($token.Length -lt 32) { throw "jeton trop court dans $TokenFile : 32 caractères aléatoires au moins (le serveur refuserait de démarrer)" }

    if ($Build -or -not (Test-Path (Join-Path $Web '.next\BUILD_ID'))) {
        Log 'construction de l''interface (npm run build)'
        Push-Location $Web
        try {
            & npm run build *>> (Join-Path $LogDir 'build.log')
            if ($LASTEXITCODE -ne 0) { throw 'build en échec, voir logs\build.log' }
        } finally { Pop-Location }
    }

    $tunnel = Start-QuickTunnel $Port 'cloudflared'
    $cfPid = $tunnel.pid
    $url = $tunnel.url
    $hostName = ([Uri]$url).Host
    Log "tunnel : $url"

    $env:AQR_ACCESS_TOKEN = $token
    $env:AQR_ALLOWED_HOSTS = $hostName
    $env:AQR_PUBLIC_ORIGIN = $url
    # Valeurs de sécurité exigées au démarrage en production (docs/SECRETS-ET-CONFIGURATION.md).
    # Le tunnel est le proxy de confiance (il fournit l'adresse réelle du visiteur) ; les inscriptions restent
    # ouvertes comme avant, sauf si AQR_SIGNUP est déjà défini ; sel d'audit et clé des formulaires sont créés
    # une fois et conservés dans le dossier d'état.
    $env:AQR_TRUST_PROXY = '1'
    if (-not $env:AQR_SIGNUP) { $env:AQR_SIGNUP = 'open' }
    $env:AQR_AUDIT_SALT = Get-Secret (Join-Path $State 'audit-salt.txt')
    $env:AQR_FORM_KEY = Get-Secret (Join-Path $State 'form-key.txt')
    $env:AQR_CORPUS_DIR = Join-Path $Root 'data\corpus'
    $env:AQR_MODELS_DIR = $ModelsDir
    $env:AQR_REVIEW_DIR = $ReviewDir
    $env:AQR_FONTS_DIR = $FontsDir
    $env:AQR_PYTHON = $Python
    $env:PYTHONPATH = Join-Path $Root 'src'

    # Écoute en direct : service WebSocket + son tunnel, même clé de signature que l'atelier. Le service
    # accepte l'hôte de l'atelier (Origin) et le sien (Host) parce que AQR_ACCESS_TOKEN est défini.
    $liveCfPid = $null
    $livePid = $null
    $liveUrl = $null
    if (-not $NoLive) {
        $liveTunnel = Start-QuickTunnel $LivePort 'cloudflared-live'
        $liveCfPid = $liveTunnel.pid
        $liveHost = ([Uri]$liveTunnel.url).Host
        $liveUrl = 'wss://' + $liveHost + '/live'
        Log "tunnel du direct : $liveUrl"
        $env:AQR_LIVE_KEY = Get-LiveKey
        $env:AQR_LIVE_URL = $liveUrl
        $env:AQR_ALLOWED_HOSTS = "$hostName,$liveHost"
        $env:AQR_LIVE_PORT = "$LivePort"
        $livePy = Start-Process -FilePath $Python `
            -ArgumentList @('-m', 'aqr.cli', 'live-serve', '--corpus-dir', $env:AQR_CORPUS_DIR, '--asr-threads', '2', '--warm-translations', 'french_hameedullah') `
            -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $LogDir 'live.log') -RedirectStandardError (Join-Path $LogDir 'live.err.log')
        $livePid = $livePy.Id
        $liveReady = $false
        for ($i = 0; $i -lt 60 -and -not $liveReady; $i++) {
            Start-Sleep -Seconds 2
            try {
                $r = Invoke-WebRequest -Uri "http://127.0.0.1:$LivePort/health" -UseBasicParsing -TimeoutSec 5
                $liveReady = ($r.StatusCode -eq 200)
            } catch { $liveReady = $false }
        }
        if (-not $liveReady) {
            foreach ($id in @($livePid, $liveCfPid, $cfPid)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
            throw "le service du direct ne répond pas sur le port $LivePort (voir logs\live.err.log)"
        }
        Log 'service du direct en ligne'
    }

    $node = (Get-Command node.exe).Source
    $next = Start-Process -FilePath $node `
        -ArgumentList @((Join-Path $Web 'node_modules\next\dist\bin\next'), 'start', '--hostname', '127.0.0.1', '--port', "$Port") `
        -WorkingDirectory $Web -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $LogDir 'next.log') -RedirectStandardError (Join-Path $LogDir 'next.err.log')

    $ready = $false
    for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
        Start-Sleep -Seconds 2
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/access" -UseBasicParsing -TimeoutSec 5
            $ready = ($r.StatusCode -eq 200)
        } catch { $ready = $false }
    }
    if (-not $ready) {
        foreach ($id in @($next.Id, $cfPid, $livePid, $liveCfPid)) {
            if ($id) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
        }
        throw "l'atelier ne répond pas sur le port $Port (voir logs\next.err.log)"
    }

    @{ cloudflaredPid = $cfPid; nodePid = $next.Id; url = $url; port = $Port
       liveCloudflaredPid = $liveCfPid; livePid = $livePid; liveUrl = $liveUrl; livePort = $LivePort
       startedAt = (Get-Date).ToString('s') } |
        ConvertTo-Json | Set-Content -Encoding utf8 $StateFile
    Set-Content -Encoding ascii $UrlFile $url
    if ($liveUrl) { Set-Content -Encoding ascii $LiveUrlFile $liveUrl }
    Log "en ligne : $url"
}

function Install-Logon {
    # Tâche planifiée « AtelierTesteurs » : démarre atelier + tunnel à chaque ouverture de session.
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Action start"
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName 'AtelierTesteurs' -Action $action -Trigger $trigger -Settings $settings `
        -Description 'Atelier de test et tunnel Cloudflare, à chaque ouverture de session' -Force | Out-Null
    Log 'tâche « AtelierTesteurs » installée (démarrage à chaque ouverture de session)'
}

function Uninstall-Logon {
    Unregister-ScheduledTask -TaskName 'AtelierTesteurs' -Confirm:$false -ErrorAction SilentlyContinue
    Log 'tâche « AtelierTesteurs » supprimée'
}

function Show-Status {
    $state = Read-State
    if (-not $state) { Log 'arrêté (aucun état enregistré)'; return }
    $tunnelUp = [bool](Get-Process -Id $state.cloudflaredPid -ErrorAction SilentlyContinue)
    $appUp = [bool](Get-Process -Id $state.nodePid -ErrorAction SilentlyContinue)
    $tunnelState = 'arrêté'; if ($tunnelUp) { $tunnelState = 'actif' }
    $appState = 'arrêté'; if ($appUp) { $appState = 'actif' }
    Log "tunnel : $tunnelState ; atelier : $appState"
    Log "adresse : $($state.url)"
    if ($state.livePid) {
        $liveUp = [bool](Get-Process -Id $state.livePid -ErrorAction SilentlyContinue)
        $liveTunnelUp = [bool](Get-Process -Id $state.liveCloudflaredPid -ErrorAction SilentlyContinue)
        $liveState = 'arrêté'; if ($liveUp) { $liveState = 'actif' }
        $liveTunnelState = 'arrêté'; if ($liveTunnelUp) { $liveTunnelState = 'actif' }
        Log "direct : service $liveState ; tunnel $liveTunnelState ; $($state.liveUrl)"
    }
}

try {
    switch ($Action) {
        'start'   { Start-All }
        'restart' { Start-All }
        'stop'    { Stop-All }
        'status'  { Show-Status }
        'install' { Install-Logon }
        'uninstall' { Uninstall-Logon }
    }
} catch {
    Write-Host ('ERREUR : ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
