#!/usr/bin/env bash
# Smoke de bout en bout : CLI (`aqr recognize`) puis navigateur (atelier web).
# Prérequis : AQR_AUDIO_DIR (hors dépôt), AQR_MODELS_DIR, corpus (scripts/fetch_corpus.py),
# ffmpeg, `npm ci && npm run build` dans web/. Chromium : AQR_SMOKE_CHROMIUM (défaut
# /opt/pw-browsers/chromium) ; aucun `playwright install` n'est lancé.
#   scripts/smoke_e2e.sh            # fetch (si besoin) + CLI + navigateur
#   scripts/smoke_e2e.sh cli|browser
# Mode strict PAR DÉFAUT (variable absente ou vide) : une ressource absente est un ÉCHEC avec sa
# raison. Seul AQR_SMOKE_STRICT=0, explicite, saute les étapes impossibles, et le résumé final le
# dit clairement (« NON EXÉCUTÉ ») : un smoke sauté n'est jamais présenté comme un succès.
set -euo pipefail
usage() { echo "usage : scripts/smoke_e2e.sh [all|cli|browser]   (défaut : all)"; }
if [ "$#" -gt 1 ]; then usage >&2; exit 2; fi
case "${1:-all}" in
  all | cli | browser) step="${1:-all}" ;;
  -h | --help) usage; exit 0 ;;
  *) echo "étape inconnue : « $1 »" >&2; usage >&2; exit 2 ;;
esac
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export AQR_SMOKE_STRICT="${AQR_SMOKE_STRICT:-1}"
: "${AQR_AUDIO_DIR:?AQR_AUDIO_DIR est requis (dossier hors dépôt)}"
: "${AQR_MODELS_DIR:?AQR_MODELS_DIR est requis}"
python="${AQR_PYTHON:-python}"
clips="$AQR_AUDIO_DIR/everyayah/Alafasy_128kbps"
logs="$(mktemp -d)"
trap 'rm -rf "$logs"' EXIT

# Strict sauf refus explicite (0|false|no|off) : une valeur inconnue ne désarme pas le contrôle.
is_strict() { case "$(printf '%s' "$AQR_SMOKE_STRICT" | tr '[:upper:]' '[:lower:]')" in 0 | false | no | off) return 1 ;; *) return 0 ;; esac; }

# Ressource d'outillage absente : échec en strict, étape sautée sinon.
cli_status="non demandé"
browser_status="non demandé"
worst=0
if ! command -v ffmpeg > /dev/null 2>&1; then
  if is_strict; then
    echo "FAIL smoke_e2e (mode strict, défaut ; AQR_SMOKE_STRICT=0 pour autoriser le skip) : ffmpeg absent du PATH" >&2
    exit 2
  fi
  echo "SKIP smoke_e2e : NON EXÉCUTÉ, ffmpeg absent du PATH (AQR_SMOKE_STRICT=0 explicite : skip autorisé)"
  echo "== Résumé smoke e2e : NON EXÉCUTÉ (ffmpeg absent) =="
  exit 0
fi

if [ ! -f "$clips/112004.mp3" ]; then
  "$python" "$root/scripts/fetch_everyayah.py" --reciters Alafasy_128kbps --surahs 112
fi

wav="$AQR_AUDIO_DIR/sourate112.wav"
if [ "$step" = all ] || [ "$step" = browser ]; then
  ffmpeg -loglevel error -y \
    -i "$clips/112001.mp3" -i "$clips/112002.mp3" -i "$clips/112003.mp3" -i "$clips/112004.mp3" \
    -filter_complex "concat=n=4:v=0:a=1" -ar 16000 -ac 1 "$wav"
  # Échec rapide AVANT l'étape CLI de plusieurs minutes si Chromium, le build ou un modèle manque.
  if is_strict; then
    (cd "$root/web" && AQR_SMOKE_AUDIO="$wav" AQR_PYTHON="$python" node e2e/browser-smoke.mjs --check)
  fi
fi

# Une étape : $1 nom, $2 journal, reste = commande. Statut : OK | ÉCHEC | NON EXÉCUTÉ.
run_step() {
  local name="$1" log="$2" skip_marker="$3" rc status
  shift 3
  set +e
  "$@" 2>&1 | tee "$log"
  rc="${PIPESTATUS[0]}"
  set -e
  if [ "$rc" -ne 0 ]; then
    status="ÉCHEC (code $rc)"
    if [ "$rc" -gt "$worst" ]; then worst="$rc"; fi
  elif grep -q "$skip_marker" "$log"; then
    status="NON EXÉCUTÉ (ressource absente, voir ci-dessus)"
  else
    status="OK"
  fi
  printf -v "${name}_status" '%s' "$status"
}

if [ "$step" = all ] || [ "$step" = cli ]; then
  run_step cli "$logs/cli.log" "smoke e2e : NON EXÉCUTÉ" \
    bash -c 'cd "$1" && exec "$2" -m pytest -m slow tests/e2e -v -rs' _ "$root" "$python"
fi

if [ "$step" = all ] || [ "$step" = browser ]; then
  run_step browser "$logs/browser.log" "^SKIP browser-smoke" \
    bash -c 'cd "$1/web" && AQR_SMOKE_AUDIO="$2" AQR_PYTHON="$3" exec npm run --silent smoke:browser' \
    _ "$root" "$wav" "$python"
fi

echo
echo "== Résumé smoke e2e (AQR_SMOKE_STRICT=$AQR_SMOKE_STRICT) =="
echo "CLI        : $cli_status"
echo "Navigateur : $browser_status"
exit "$worst"
