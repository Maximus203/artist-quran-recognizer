#!/usr/bin/env bash
# Arrêt d'urgence sans tout couper (docs/INFRASTRUCTURE.md). Effet en moins de 2 secondes, sans redémarrage.
#   service-mode.sh restricted   plus d'inscriptions, d'envois, d'analyses ni de direct ; lecture et connexion restent
#   service-mode.sh maintenance  tout répond 503 avec une page claire, sauf /api/health
#   service-mode.sh normal       lève les deux (si AQR_SERVICE_MODE=restricted est fixé au démarrage, il reste appliqué)
#   service-mode.sh status
# Sur Alpha : agit dans le conteneur « atelier » (dossier /data/control). Avec AQR_REVIEW_DIR défini : agit en local.
set -eu
if [ -n "${AQR_REVIEW_DIR:-}" ]; then RUN=(); CTL="$AQR_REVIEW_DIR/control"
else RUN=(docker exec atelier); CTL=/data/control; fi
case "${1:-status}" in
  restricted)  "${RUN[@]}" sh -c "mkdir -p '$CTL' && : > '$CTL/restricted' && rm -f '$CTL/maintenance'" ;;
  maintenance) "${RUN[@]}" sh -c "mkdir -p '$CTL' && : > '$CTL/maintenance'" ;;
  normal)      "${RUN[@]}" sh -c "rm -f '$CTL/restricted' '$CTL/maintenance'" ;;
  status)      ;;
  *) echo "Usage : $0 restricted|maintenance|normal|status" >&2; exit 2 ;;
esac
"${RUN[@]}" sh -c "if [ -e '$CTL/maintenance' ]; then echo 'mode : maintenance'; elif [ -e '$CTL/restricted' ]; then echo 'mode : restricted'; else echo 'mode : normal'; fi"
