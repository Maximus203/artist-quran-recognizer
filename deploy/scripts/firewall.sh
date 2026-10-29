#!/usr/bin/env bash
# Pare-feu de l'hôte (ufw) : seuls 80 et 443 ouverts sur Internet, SSH restreint. NE FAIT RIEN sans --apply :
# sans lui, affiche les commandes. À rejouer sur la machine cible, une fois identifiée et accessible autrement
# que par SSH (console) au cas où une règle couperait la session.
# Usage : firewall.sh [--apply] --ssh-from <réseau, ex. 100.64.0.0/10 pour Tailscale ou 192.168.1.0/24>
set -eu
APPLY=0; SSH_FROM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --ssh-from) SSH_FROM="${2:?réseau requis}"; shift ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac; shift
done
[ -n "$SSH_FROM" ] || { echo "--ssh-from est obligatoire : SSH n'est jamais ouvert à tout Internet." >&2; exit 2; }
CMDS=(
  "ufw default deny incoming"
  "ufw default allow outgoing"
  "ufw allow 80/tcp"
  "ufw allow 443/tcp"
  "ufw allow from $SSH_FROM to any port 22 proto tcp"
  "ufw --force enable"
)
for c in "${CMDS[@]}"; do
  if [ "$APPLY" = 1 ]; then echo "+ $c"; $c; else echo "(à exécuter) $c"; fi
done
[ "$APPLY" = 1 ] || echo "Rien n'a été appliqué. Les ports 3000 (atelier) et 8765 (direct) restent fermés : seul le proxy y accède."
