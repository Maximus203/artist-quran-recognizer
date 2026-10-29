#!/usr/bin/env bash
# Arrêt d'urgence sans tout couper (docs/INFRASTRUCTURE.md). Effet en moins de 2 secondes, sans redémarrage.
#   service-mode.sh restricted   plus d'inscriptions, d'envois, d'analyses ni de direct ; lecture et connexion restent
#   service-mode.sh maintenance  tout répond 503 avec une page claire, sauf /api/health
#   service-mode.sh normal       lève les deux
#   service-mode.sh status
set -eu
DATA="${AQR_REVIEW_DIR:-/var/lib/aqr}"
CTL="$DATA/control"
case "${1:-status}" in
  restricted)  mkdir -p "$CTL"; : > "$CTL/restricted"; rm -f "$CTL/maintenance" ;;
  maintenance) mkdir -p "$CTL"; : > "$CTL/maintenance" ;;
  normal)      rm -f "$CTL/restricted" "$CTL/maintenance" ;;
  status)      ;;
  *) echo "Usage : $0 restricted|maintenance|normal|status" >&2; exit 2 ;;
esac
if [ -e "$CTL/maintenance" ]; then echo "mode : maintenance"
elif [ -e "$CTL/restricted" ]; then echo "mode : restricted"
else echo "mode : normal"; fi
