$ErrorActionPreference = "Stop"
if (-not (Test-Path .git)) { git init }
git add -A
git commit -m "scaffold: nouveau projet" --quiet
if ($LASTEXITCODE -ne 0) { Write-Host "Rien à committer (déjà fait ?)" }
Write-Host "Prochaine étape : ouvrir ce dossier dans Claude Code et lancer /artist-init"
