#!/usr/bin/env bash
# Lance le rapport des erreurs récurrentes et pousse le résultat vers un monitor « push » d'Uptime Kuma.
# Usage : log-report-push.sh <dossier des journaux>      (AQR_PUSH_URL dans l'environnement ; sans lui, affiche seulement)
set -u
LOGS="${1:?dossier des journaux requis}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# AQR_REPORT_CMD : commande du rapport (dans un conteneur : « docker exec atelier node scripts/log-report.mjs /data/logs »).
if [ -n "${AQR_REPORT_CMD:-}" ]; then REPORT="$($AQR_REPORT_CMD 2>&1)"; else REPORT="$(node "$HERE/../../web/scripts/log-report.mjs" "$LOGS" 2>&1)"; fi
CODE=$?
echo "$REPORT"
case "$CODE" in
  0) STATUS=up;   MSG="Aucune erreur récurrente" ;;
  1) STATUS=down; MSG="Erreur récurrente ou chaîne d'audit rompue : lire le rapport" ;;
  *) STATUS=down; MSG="Rapport impossible (journaux absents ?)" ;;
esac
if [ -n "${AQR_PUSH_URL:-}" ]; then
  curl -fsS --max-time 15 --get --data-urlencode "status=$STATUS" --data-urlencode "msg=$MSG" "$AQR_PUSH_URL" >/dev/null \
    || echo "Poussée vers la supervision impossible" >&2
else
  echo "AQR_PUSH_URL non défini : rien n'est poussé." >&2
fi
exit "$CODE"
