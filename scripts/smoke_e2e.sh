#!/usr/bin/env bash
# Smoke de bout en bout : CLI (`aqr recognize`) puis navigateur (atelier web).
# Prérequis : AQR_AUDIO_DIR (hors dépôt), AQR_MODELS_DIR, corpus (scripts/fetch_corpus.py),
# ffmpeg, `npm ci && npm run build` dans web/. Chromium : AQR_SMOKE_CHROMIUM (défaut
# /opt/pw-browsers/chromium) ; aucun `playwright install` n'est lancé.
#   scripts/smoke_e2e.sh            # fetch (si besoin) + CLI + navigateur
#   scripts/smoke_e2e.sh cli|browser
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${AQR_AUDIO_DIR:?AQR_AUDIO_DIR est requis (dossier hors dépôt)}"
: "${AQR_MODELS_DIR:?AQR_MODELS_DIR est requis}"
python="${AQR_PYTHON:-python}"
step="${1:-all}"
clips="$AQR_AUDIO_DIR/everyayah/Alafasy_128kbps"

if [ ! -f "$clips/112004.mp3" ]; then
  "$python" "$root/scripts/fetch_everyayah.py" --reciters Alafasy_128kbps --surahs 112
fi

if [ "$step" = all ] || [ "$step" = cli ]; then
  (cd "$root" && "$python" -m pytest -m slow tests/e2e -v)
fi

if [ "$step" = all ] || [ "$step" = browser ]; then
  wav="$AQR_AUDIO_DIR/sourate112.wav"
  ffmpeg -loglevel error -y \
    -i "$clips/112001.mp3" -i "$clips/112002.mp3" -i "$clips/112003.mp3" -i "$clips/112004.mp3" \
    -filter_complex "concat=n=4:v=0:a=1" -ar 16000 -ac 1 "$wav"
  (cd "$root/web" && AQR_SMOKE_AUDIO="$wav" AQR_PYTHON="$python" npm run --silent smoke:browser)
fi
