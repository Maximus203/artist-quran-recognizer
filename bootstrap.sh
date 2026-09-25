#!/usr/bin/env bash
set -euo pipefail
if [ ! -d .git ]; then git init; fi
git add -A
git commit -m "scaffold: nouveau projet" --allow-empty-message --quiet || echo "Rien à committer (déjà fait ?)"
echo "Prochaine étape : ouvrir ce dossier dans Claude Code et lancer /artist-init"
