"""Smoke de bout en bout : `aqr recognize` (vrai processus, vrais modèles) sur un audio court.

Aucun audio dans Git. Les 4 versets de la sourate 112 (récitant Alafasy, EveryAyah) sont lus
dans `$AQR_AUDIO_DIR/everyayah/` (voir `scripts/fetch_everyayah.py --reciters Alafasy_128kbps
--surahs 112`), concaténés par ffmpeg dans un dossier temporaire. Toute ressource absente
(audio, ffmpeg, modèles, corpus) fait SAUTER le test, jamais échouer.
Lancer : `pytest -m slow tests/e2e`  (ou `scripts/smoke_e2e.sh`).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
CORPUS_DIR = ROOT / "data" / "corpus"
RECITER = "Alafasy_128kbps"
SURAH = 112
VERSES = 4

pytestmark = pytest.mark.slow


@pytest.fixture(scope="module")
def short_audio(tmp_path_factory: pytest.TempPathFactory) -> Path:
    audio_dir = os.environ.get("AQR_AUDIO_DIR")
    if not audio_dir:
        pytest.skip("AQR_AUDIO_DIR absent (lancer scripts/fetch_everyayah.py)")
    clips = [
        Path(audio_dir) / "everyayah" / RECITER / f"{SURAH:03d}{n:03d}.mp3"
        for n in range(1, VERSES + 1)
    ]
    missing = [c for c in clips if not c.exists()]
    if missing:
        pytest.skip(f"clip EveryAyah absent : {missing[0]} (lancer scripts/fetch_everyayah.py)")
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg absent du PATH")
    target = tmp_path_factory.mktemp("smoke") / f"sourate{SURAH}.wav"
    command = ["ffmpeg", "-loglevel", "error", "-y"]
    for clip in clips:
        command += ["-i", str(clip)]
    command += [
        "-filter_complex",
        f"concat=n={len(clips)}:v=0:a=1",
        "-ar",
        "16000",
        "-ac",
        "1",
        str(target),
    ]
    subprocess.run(command, check=True, capture_output=True)
    return target


def _require_engine() -> Path:
    models = os.environ.get("AQR_MODELS_DIR")
    if not models or not (Path(models) / "whisper-base-quran").is_dir():
        pytest.skip("AQR_MODELS_DIR absent ou sans whisper-base-quran (scripts/fetch_models.py)")
    if not (CORPUS_DIR / "LOCK.json").exists():
        pytest.skip("corpus absent (python scripts/fetch_corpus.py)")
    return Path(models)


def test_recognize_short_audio_names_the_right_surah(short_audio: Path, tmp_path: Path) -> None:
    models = _require_engine()
    out = tmp_path / "out"
    env = {**os.environ, "PYTHONPATH": str(ROOT / "src"), "TRANSFORMERS_VERBOSITY": "error"}
    done = subprocess.run(
        [
            sys.executable,
            "-m",
            "aqr.cli",
            "recognize",
            str(short_audio),
            "--out-dir",
            str(out),
            "--asr",
            "whisper",
            "--format",
            "json",
            "--device",
            "cpu",
            "--translation",
            "none",
            "--models-dir",
            str(models),
            "--corpus-dir",
            str(CORPUS_DIR),
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=1800,
    )
    assert done.returncode == 0, f"stderr:\n{done.stderr[-2000:]}"
    result = json.loads((out / f"sourate{SURAH}.recognition.json").read_text(encoding="utf-8"))
    assert result["schema"] == "aqr.recognition/1"
    assert result["source"]["duration_s"] > 5
    verses = [i for i in result["intervals"] if i["kind"] == "verse" and i["status"] != "uncertain"]
    assert verses, "aucun verset nommé"
    # I3 : la précision prime — tout verset nommé doit appartenir à la sourate récitée.
    refs = [v["ref"] for v in verses]
    assert all(r.startswith(f"{SURAH}:") for r in refs), refs
    # I1 : le texte arabe vient du corpus (non vide pour un verset reconnu).
    assert all(v.get("text") for v in verses)
    recognized = [v for v in verses if v["status"] == "recognized"]
    assert recognized, "aucun verset RECOGNIZED sur un audio propre de 4 versets"
