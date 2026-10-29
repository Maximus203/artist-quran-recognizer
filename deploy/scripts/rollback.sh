#!/usr/bin/env bash
# Retour à la version précédente de l'atelier en moins de 15 minutes (docs/INFRASTRUCTURE.md, § Retour arrière).
# Redémarre l'image notée dans /opt/atelier/previous et attend sa santé.
# Les migrations de base ne sont PAS réversibles : si la version retirée en avait appliqué, restaurer d'abord la
# sauvegarde prise avant la bascule (--restore-db <nom de sauvegarde>), sinon la base resterait en avance.
# Usage : rollback.sh [--restore-db aqr-AAAAMMJJTHHMMSSZ]
set -eu
DIR=/opt/atelier
COMPOSE="docker compose -f $DIR/compose.yaml --env-file $DIR/.env"
RESTORE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --restore-db) RESTORE="${2:?nom de sauvegarde requis}"; shift ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac; shift
done
PREVIOUS="$(cat "$DIR/previous" 2>/dev/null || true)"
[ -n "$PREVIOUS" ] && docker image inspect "atelier:$PREVIOUS" >/dev/null 2>&1 \
  || { echo "Aucune version précédente utilisable." >&2; exit 2; }
if [ -n "$RESTORE" ]; then
  # Restauration dans un volume NEUF, puis bascule : l'ancien volume est conservé (jamais écrasé).
  NEWVOL="atelier-data-restauré-$(date -u +%Y%m%dT%H%M%SZ)"
  docker volume create "$NEWVOL" >/dev/null
  ATELIER_TAG="$PREVIOUS" $COMPOSE stop atelier
  docker run --rm -v atelier-data:/old:ro -v "$NEWVOL":/new "atelier:$PREVIOUS" \
    node scripts/backup.mjs restore "/old/backups/$RESTORE" --target /new/restored
  docker run --rm -v "$NEWVOL":/new --entrypoint sh "atelier:$PREVIOUS" -c 'cp -a /new/restored/. /new/ && rm -rf /new/restored'
  echo "Volume restauré : $NEWVOL. Pointer « atelier-data » dessus dans compose.yaml, puis relancer ; l'ancien volume est conservé."
  exit 0
fi
echo "$PREVIOUS" > "$DIR/current"
ATELIER_TAG="$PREVIOUS" $COMPOSE up -d atelier
for _ in $(seq 1 45); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' atelier 2>/dev/null)" = healthy ] && { echo "Retour effectué : $PREVIOUS"; exit 0; }
  sleep 2
done
echo "Le conteneur n'est pas sain après le retour : intervention manuelle." >&2
exit 1
