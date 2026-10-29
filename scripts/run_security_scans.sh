#!/usr/bin/env bash
# Scans de sécurité à lancer avant la mise en production (docs/SCANS-SECURITE.md).
# Usage : scripts/run_security_scans.sh <adresse de l'environnement de TEST> [dossier-de-rapport]
# Ne scanne QUE l'adresse donnée : jamais la production, jamais un tiers. Chaque scan est indépendant :
# un échec n'empêche pas les suivants ; le code retour final est 1 si l'un d'eux a signalé un écart.
# Les images Docker sont téléchargées au premier lancement : épingler leur version (variables *_IMAGE)
# et noter les versions dans le rapport.
set -u
TARGET="${1:?adresse de test requise, ex. https://test.exemple.org}"
OUT="${2:-docs/evaluation/scans/$(date -u +%F)}"
ZAP_IMAGE="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:stable}"
TESTSSL_IMAGE="${TESTSSL_IMAGE:-drwetter/testssl.sh:latest}"
TRIVY_IMAGE="${TRIVY_IMAGE:-aquasec/trivy:latest}"
GITLEAKS_IMAGE="${GITLEAKS_IMAGE:-zricethezav/gitleaks:latest}"
APP_IMAGE="${APP_IMAGE:-}" # image de l'atelier à auditer avec Trivy (voir le Dockerfile, section 15)
mkdir -p "$OUT"
status=0
step() { printf '\n== %s\n' "$1"; }
run() { "$@" || { echo "ÉCART OU ÉCHEC : $*"; status=1; }; }

step "En-têtes de sécurité"
run node web/scripts/check-headers.mjs "$TARGET" | tee "$OUT/en-tetes.txt"

step "Dépendances Node (npm audit)"
(cd web && run npm audit --audit-level=high) | tee "$OUT/npm-audit.txt"

step "Dépendances Python (pip-audit)"
if command -v pip-audit >/dev/null; then
  run pip-audit --local | tee "$OUT/pip-audit.txt"
else echo "pip-audit absent : pip install pip-audit (dans un environnement séparé)"; status=1; fi

step "Secrets : filet interne puis gitleaks sur l'historique"
run python scripts/scan_secrets.py --history | tee "$OUT/secrets-internes.txt"
if command -v docker >/dev/null; then
  run docker run --rm -v "$PWD:/repo" "$GITLEAKS_IMAGE" detect --source /repo --redact \
    --report-format json --report-path /repo/"$OUT"/gitleaks.json
else echo "docker absent : gitleaks non lancé"; status=1; fi

if command -v docker >/dev/null; then
  step "OWASP ZAP : scan de base (passif), sur l'environnement de test"
  run docker run --rm -v "$PWD/$OUT:/zap/wrk:rw" "$ZAP_IMAGE" zap-baseline.py \
    -t "$TARGET" -r zap-base.html -J zap-base.json
  # Le scan actif attaque réellement l'application : environnement de test UNIQUEMENT, jamais la production.
  if [ "${ZAP_ACTIVE:-0}" = "1" ]; then
    step "OWASP ZAP : scan complet (actif)"
    run docker run --rm -v "$PWD/$OUT:/zap/wrk:rw" "$ZAP_IMAGE" zap-full-scan.py \
      -t "$TARGET" -r zap-full.html -J zap-full.json
  else echo "Scan actif non lancé (ZAP_ACTIVE=1 pour le faire, sur l'environnement de test)."; fi

  case "$TARGET" in https://*)
    step "TLS (testssl.sh)"
    run docker run --rm "$TESTSSL_IMAGE" --protocols --ciphers --server-defaults \
      --headers --warnings off "${TARGET#https://}" | tee "$OUT/testssl.txt" ;;
  *) echo "Adresse en HTTP : scan TLS ignoré." ;;
  esac

  if [ -n "$APP_IMAGE" ]; then
    step "Image de l'atelier (Trivy)"
    run docker run --rm "$TRIVY_IMAGE" image --severity HIGH,CRITICAL --exit-code 1 "$APP_IMAGE" \
      | tee "$OUT/trivy.txt"
  else echo "APP_IMAGE non défini : Trivy non lancé (pas d'image avant la section 15)."; fi
else
  echo "docker absent : ZAP, testssl et Trivy non lancés."; status=1
fi

step "Résultat"
[ "$status" = 0 ] && echo "Aucun écart signalé." || echo "Au moins un écart ou un scan non lancé : lire $OUT."
echo "Rapport dans $OUT"
exit "$status"
