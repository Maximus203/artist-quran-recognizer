<#
.SYNOPSIS
  Agent du moteur à distance (ADR-0017) sur le poste Windows à GPU : il appelle l'atelier, analyse, dépose le résultat.

.DESCRIPTION
  Sans option : lance l'agent (et le relance s'il tombe, sauf jeton refusé).
  -Check      : vérifie tout sans rien modifier (Python, modèles, corpus, GPU, jeton, VPN, nom de l'atelier).
  -Install    : (en administrateur) fait résoudre le nom de l'atelier vers le VPN d'administration dans le fichier
                hosts, et crée la tâche planifiée « AQR Engine Agent » (démarre à l'ouverture de session, sans fenêtre).
  -Uninstall  : (en administrateur) retire la tâche et l'entrée du fichier hosts.

  Le jeton d'agent n'est JAMAIS passé en argument ni dans l'environnement : l'agent le lit dans un fichier
  ($HOME\.aqr\engine-agent.token). Journal : $HOME\.aqr\agent.log.
#>
[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$Install,
  [switch]$Uninstall,
  [string]$Url = "https://quran-tr.artist-dev.com",
  # Adresse d'Alpha sur le VPN d'administration (wg0) : seule route autorisée pour les routes du moteur depuis ce poste.
  [string]$VpnAddress = "10.77.0.1",
  [string]$TokenFile = (Join-Path $HOME ".aqr\engine-agent.token"),
  [string]$ModelsDir = "D:\01-Dev\Data\aqr-models"
)

$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Python = Join-Path $Repo ".venv\Scripts\python.exe"
$Corpus = Join-Path $Repo "data\corpus"
$Work = Join-Path $HOME ".aqr\work"
$Log = Join-Path $HOME ".aqr\agent.log"
$HostName = ([Uri]$Url).Host
$HostsFile = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"
$TaskName = "AQR Engine Agent"
$Marker = "# aqr-engine-agent"

function Test-Admin {
  ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-Step([string]$Label, [bool]$Ok, [string]$Detail = "") {
  $mark = if ($Ok) { "OK   " } else { "ECHEC" }
  Write-Host ("{0} {1} {2}" -f $mark, $Label, $Detail)
  return $Ok
}

function Invoke-Check {
  $all = $true
  $all = (Write-Step "Python du dépôt" (Test-Path $Python) $Python) -and $all
  $all = (Write-Step "Modèles" (Test-Path (Join-Path $ModelsDir "fastconformer-quran")) $ModelsDir) -and $all
  $all = (Write-Step "Corpus" (Test-Path (Join-Path $Corpus "LOCK.json")) $Corpus) -and $all
  $gpu = (& nvidia-smi --query-gpu=name --format=csv,noheader 2>$null)
  $null = Write-Step "GPU (sinon le moteur tourne sur processeur)" ([bool]$gpu) ("" + $gpu)
  $tokenOk = $false
  if (Test-Path $TokenFile) {
    $raw = (Get-Content $TokenFile -Raw).Trim()
    $tokenOk = $raw -match '^qea_[A-Za-z0-9_-]{43}$'
  }
  $all = (Write-Step "Fichier du jeton d'agent (forme seulement)" $tokenOk $TokenFile) -and $all
  $hostsLine = Select-String -Path $HostsFile -Pattern ([regex]::Escape($HostName)) -ErrorAction SilentlyContinue
  $all = (Write-Step "Nom de l'atelier résolu vers le VPN (fichier hosts)" ([bool]$hostsLine) $HostName) -and $all
  $vpn = Test-NetConnection $VpnAddress -Port 443 -WarningAction SilentlyContinue
  $all = (Write-Step "Atelier joignable par le VPN d'administration" $vpn.TcpTestSucceeded "$VpnAddress`:443") -and $all
  return $all
}

function Install-Agent {
  if (-not (Test-Admin)) { throw "Lance ce script dans un PowerShell ouvert EN ADMINISTRATEUR (-Install modifie le fichier hosts)." }
  if (-not (Invoke-Check)) { Write-Host "Des vérifications échouent : corrige-les avant l'installation (voir ci-dessus)."; }
  $present = Select-String -Path $HostsFile -Pattern ([regex]::Escape($HostName)) -ErrorAction SilentlyContinue
  if (-not $present) {
    Add-Content -Path $HostsFile -Value "$VpnAddress $HostName $Marker"
    Write-Host "OK    hosts : $HostName -> $VpnAddress"
  }
  $script = Join-Path $PSScriptRoot "aqr-engine-agent.ps1"
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Write-Host "OK    tâche planifiée « $TaskName » (à l'ouverture de session). Démarrage immédiat : Start-ScheduledTask '$TaskName'"
}

function Uninstall-Agent {
  if (-not (Test-Admin)) { throw "Lance ce script EN ADMINISTRATEUR." }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  $lines = Get-Content $HostsFile | Where-Object { $_ -notmatch [regex]::Escape($Marker) }
  Set-Content -Path $HostsFile -Value $lines
  Write-Host "OK    tâche et entrée hosts retirées."
}

function Start-Agent {
  New-Item -ItemType Directory -Force -Path $Work | Out-Null
  if (Test-Path $Log) { Move-Item -Force $Log "$Log.1" }
  # L'agent lit le jeton dans un fichier : jamais dans l'environnement ni dans la ligne de commande.
  $env:AQR_ENGINE_URL = $Url
  $env:AQR_ENGINE_TOKEN_FILE = $TokenFile
  $env:AQR_ENGINE_WORK_DIR = $Work
  $env:AQR_MODELS_DIR = $ModelsDir
  $env:AQR_CORPUS_DIR = $Corpus
  $env:PYTHONUNBUFFERED = "1"
  Set-Location $Repo
  while ($true) {
    $process = Start-Process -FilePath $Python -ArgumentList @("-m", "aqr.cli", "engine-agent") -NoNewWindow -Wait -PassThru `
      -RedirectStandardError $Log
    # 3 = jeton refusé (révoqué) : inutile de réessayer, un administrateur doit en créer un nouveau.
    if ($process.ExitCode -eq 3 -or $process.ExitCode -eq 2) { break }
    Start-Sleep -Seconds 15
  }
  exit $process.ExitCode
}

if ($Check) { if (Invoke-Check) { exit 0 } else { exit 1 } }
elseif ($Install) { Install-Agent }
elseif ($Uninstall) { Uninstall-Agent }
else { Start-Agent }
