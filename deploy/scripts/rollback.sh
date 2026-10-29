#!/usr/bin/env bash
# Retour à la version précédente en moins de 15 minutes (docs/INFRASTRUCTURE.md, § Retour arrière).
# Repointe « current » sur la version notée par release.sh, redémarre, vérifie la sonde.
# Les migrations de base ne sont PAS réversibles : si la version retirée en avait appliqué, restaurer d'abord la
# sauvegarde prise juste avant la bascule (--restore-db <dossier de sauvegarde>), sinon la base resterait en avance.
# Usage : rollback.sh [--no-backup-restore] [--restore-db /var/backups/aqr/aqr-AAAAMMJJTHHMMSSZ]
set -eu
BASE=/opt/aqr
RESTORE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-backup-restore) ;;
    --restore-db) RESTORE="${2:?dossier de sauvegarde requis}"; shift ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac; shift
done
PREVIOUS="$(cat "$BASE/previous" 2>/dev/null || true)"
[ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ] || { echo "Aucune version précédente connue." >&2; exit 2; }
systemctl stop aqr-atelier
if [ -n "$RESTORE" ]; then
  TARGET=/var/lib/aqr.restored-$$
  node "$PREVIOUS/web/scripts/backup.mjs" restore "$RESTORE" --target "$TARGET"
  mv /var/lib/aqr "/var/lib/aqr.avant-retour-$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$TARGET" /var/lib/aqr
  chown -R aqr:aqr /var/lib/aqr
fi
ln -sfn "$PREVIOUS" "$BASE/current.new" && mv -T "$BASE/current.new" "$BASE/current"
systemctl start aqr-atelier
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/api/health >/dev/null; then echo "Retour effectué : $PREVIOUS"; exit 0; fi
  sleep 2
done
echo "La sonde ne passe pas après le retour : intervention manuelle." >&2
exit 1
