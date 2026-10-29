#!/usr/bin/env bash
# Mise en service d'une version de l'atelier sur Alpha : sauvegarde, démarrage de l'image <tag>, attente de la
# santé du conteneur, retour automatique si elle ne vient pas. L'image est déjà construite (docker build, voir
# deploy/docker/Dockerfile). Le tag en service est noté dans /opt/atelier/current, le précédent dans /opt/atelier/previous.
# Usage : release.sh <tag>        (variables ATELIER_HOST exportée ou dans /opt/atelier/.env)
set -eu
TAG="${1:?tag requis}"
DIR=/opt/atelier
COMPOSE="docker compose -f $DIR/compose.yaml --env-file $DIR/.env"
docker image inspect "atelier:$TAG" >/dev/null || { echo "Image absente : atelier:$TAG" >&2; exit 2; }
CURRENT="$(cat "$DIR/current" 2>/dev/null || true)"
if docker ps --format '{{.Names}}' | grep -qx atelier; then
  echo "1/4 sauvegarde avant bascule"
  docker exec atelier node scripts/backup.mjs backup --root /data --out /data/backups --keep 14
fi
echo "2/4 démarrage de $TAG"
echo "$CURRENT" > "$DIR/previous"
echo "$TAG" > "$DIR/current"
ATELIER_TAG="$TAG" $COMPOSE up -d atelier
echo "3/4 attente de la santé (90 s au plus)"
for _ in $(seq 1 45); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' atelier 2>/dev/null)" = healthy ] && { echo "4/4 en service : $TAG"; exit 0; }
  sleep 2
done
echo "Le conteneur n'est pas sain : retour à la version précédente" >&2
[ -n "$CURRENT" ] && "$(dirname "$0")/rollback.sh" || echo "Pas de version précédente." >&2
exit 1
