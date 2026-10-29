#!/usr/bin/env bash
# Mise en service d'une version : sauvegarde, construction à côté, bascule du lien « current », contrôle, retour
# automatique si la sonde ne passe pas. Les versions sont dans /opt/aqr/releases/<sha>/ ; « current » pointe sur l'une d'elles.
# Usage : release.sh <sha>          (le dépôt est déjà cloné dans /opt/aqr/releases/<sha>)
set -eu
SHA="${1:?sha requis}"
BASE=/opt/aqr
NEW="$BASE/releases/$SHA"
[ -d "$NEW" ] || { echo "Version absente : $NEW" >&2; exit 2; }
PREVIOUS="$(readlink -f "$BASE/current" 2>/dev/null || true)"
echo "1/5 sauvegarde avant bascule"
node "$NEW/web/scripts/backup.mjs" backup --root /var/lib/aqr --out /var/backups/aqr --keep 14
echo "2/5 construction (à côté de la version en service)"
( cd "$NEW/web" && npm ci --omit=dev --no-audit --no-fund && npm run build )
echo "3/5 bascule"
ln -sfn "$NEW" "$BASE/current.new" && mv -T "$BASE/current.new" "$BASE/current"
echo "$PREVIOUS" > "$BASE/previous"
systemctl restart aqr-atelier
echo "4/5 contrôle de la sonde (60 s au plus)"
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/api/health >/dev/null; then echo "5/5 en service : $SHA"; exit 0; fi
  sleep 2
done
echo "La sonde ne passe pas : retour à la version précédente" >&2
"$(dirname "$0")/rollback.sh" --no-backup-restore
exit 1
