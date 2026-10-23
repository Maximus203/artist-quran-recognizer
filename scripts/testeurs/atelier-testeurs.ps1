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

  L'adresse cloudflared (quick tunnel) change à chaque démarrage. Elle est écrite dans
  D:\01-Dev\Data\aqr-tunnel\url.txt.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\testeurs\atelier-testeurs.ps1 -Action restart
#>
param(
    [ValidateSet('start', 'stop', 'restart', 'status', 'install', 'uninstall')]
    [string]$Action = 'status',
    [switch]$Build,
    [int]$Port = 3200
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:Path ='C:\Users\diouf\AppData\Local\nvm\v24.19.0;' + $env:Path

# Racine du checkout qui contient ce script (web/ et src/ en dépendent).
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Web = Join-Path $Root 'web'
$State = 'D:\01-Dev\Data\aqr-tunnel'
$StateFile = Join-Path $State 'etat.json'
$UrlFile = Join-Path $State 'url.txt'
$TokenFile = Join-Path $State 'token.txt'
$LogDir = Join-Path $State 'logs'
$ReviewDir = 'D:\01-Dev\Data\aqr-review-testeurs'
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
        foreach ($id in @($state.cloudflaredPid, $state.nodePid)) {
            if ($id) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
        }
    }
    # Orphelins de ce tunnel (même port) ; un autre processus sur le port n'est arrêté que s'il est Next.
    Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
        Where-Object { $_.CommandLine -match "127\.0\.0\.1:$Port" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"
            if ($proc -and $proc.CommandLine -match 'next') {
                Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
            }
        }
    if (Test-Path $StateFile) { Remove-Item $StateFile -Force }
    Log 'arrêté'
}

function Start-All {
    Stop-All
    if (-not (Test-Path $TokenFile)) { throw "jeton absent : $TokenFile" }
    if (-not (Test-Path $Cloudflared)) { throw "cloudflared introuvable : $Cloudflared (winget install Cloudflare.cloudflared)" }
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $token = (Get-Content $TokenFile -Raw).Trim()

    if ($Build -or -not (Test-Path (Join-Path $Web '.next\BUILD_ID'))) {
        Log 'construction de l''interface (npm run build)'
        Push-Location $Web
        try {
            & npm run build *>> (Join-Path $LogDir 'build.log')
            if ($LASTEXITCODE -ne 0) { throw 'build en échec, voir logs\build.log' }
        } finally { Pop-Location }
    }

    # Tunnel : le réseau peut ne pas être prêt au démarrage, on réessaie jusqu'à 10 minutes.
    $deadline = (Get-Date).AddMinutes(10)
    $url = $null
    $cfPid = $null
    $cfLog = Join-Path $LogDir 'cloudflared.log'
    while (-not $url) {
        Remove-Item $cfLog -ErrorAction SilentlyContinue
        $cf = Start-Process -FilePath $Cloudflared `
            -ArgumentList @('tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$Port") `
            -WindowStyle Hidden -PassThru `
            -RedirectStandardError $cfLog -RedirectStandardOutput (Join-Path $LogDir 'cloudflared.out')
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
    $hostName = ([Uri]$url).Host
    Log "tunnel : $url"

    $env:AQR_ACCESS_TOKEN = $token
    $env:AQR_ALLOWED_HOSTS = $hostName
    $env:AQR_PUBLIC_ORIGIN = $url
    $env:AQR_CORPUS_DIR = Join-Path $Root 'data\corpus'
    $env:AQR_MODELS_DIR = $ModelsDir
    $env:AQR_REVIEW_DIR = $ReviewDir
    $env:AQR_FONTS_DIR = $FontsDir
    $env:AQR_PYTHON = $Python
    $env:PYTHONPATH = Join-Path $Root 'src'

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
        Stop-Process -Id $next.Id -Force -ErrorAction SilentlyContinue
        Stop-Process -Id $cfPid -Force -ErrorAction SilentlyContinue
        throw "l'atelier ne répond pas sur le port $Port (voir logs\next.err.log)"
    }

    @{ cloudflaredPid = $cfPid; nodePid = $next.Id; url = $url; port = $Port; startedAt = (Get-Date).ToString('s') } |
        ConvertTo-Json | Set-Content -Encoding utf8 $StateFile
    Set-Content -Encoding ascii $UrlFile $url
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
