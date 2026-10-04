#!/usr/bin/env bash
# Active les hooks du dépôt (idempotent). À lancer une fois par clone ; fait automatiquement
# au démarrage de session par .claude/settings.json.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
cd "$root"
chmod +x .githooks/commit-msg .githooks/pre-push
git config core.hooksPath .githooks
echo "hooks actifs : $(git config core.hooksPath)"
