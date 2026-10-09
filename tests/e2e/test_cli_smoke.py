"""Smoke de bout en bout : `aqr recognize` (vrai processus, vrais modèles) sur un audio court.

Aucun audio dans Git. Les 4 versets de la sourate 112 (récitant Alafasy, EveryAyah) sont lus
dans `$AQR_AUDIO_DIR/everyayah/` (voir `scripts/fetch_everyayah.py --reciters Alafasy_128kbps
--surahs 112`), concaténés par ffmpeg dans un dossier temporaire.

Ressource absente (audio, ffmpeg, modèles, corpus vérifié par LOCK.json) : ÉCHEC avec la raison, le
mode strict est le défaut. Seul `AQR_SMOKE_STRICT=0`, explicite, saute le test avec la raison et un
résumé « NON EXÉCUTÉ » (`tests/e2e/conftest.py`) : un smoke sauté n'est pas un succès.
Lancer : `scripts/smoke_e2e.sh cli` ou `pytest -m slow tests/e2e -rs`.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from tests.support.corpus_check import assert_matches_corpus, load_repository
from tests.support.smoke_env import (
    ROOT,
    SURAH,
    clip_paths,
    corpus_dir,
    find_missing,
    unavailable,
)

pytestmark = pytest.mark.slow


@pytest.fixture(scope="module")
def resources() -> Path:
    """Vérifie toutes les ressources d'un coup ; renvoie le dossier des modèles."""
    missing = find_missing(os.environ)
    if missing:
        unavailable(missing)
    return Path(os.environ["AQR_MODELS_DIR"])


@pytest.fixture(scope="module")
def short_audio(resources: Path, tmp_path_factory: pytest.TempPathFactory) -> Path:
    clips = clip_paths(Path(os.environ["AQR_AUDIO_DIR"]))
    target = tmp_path_factory.mktemp("smoke") / f"sourate{SURAH}.wav"
    command = ["ffmpeg", "-loglevel", "error", "-y"]
    for clip in clips:
        command += ["-i", str(clip)]
    command += ["-filter_complex", f"concat=n={len(clips)}:v=0:a=1", "-ar", "16000", "-ac", "1"]
    subprocess.run([*command, str(target)], check=True, capture_output=True)
    return target


def test_recognize_short_audio_names_the_right_surah(
    short_audio: Path, resources: Path, tmp_path: Path
) -> None:
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
            str(resources),
            "--corpus-dir",
            str(corpus_dir(os.environ)),
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=1800,
        check=False,
    )
    assert done.returncode == 0, f"stderr:\n{done.stderr[-2000:]}"
    result = json.loads((out / f"sourate{SURAH}.recognition.json").read_text(encoding="utf-8"))
    assert result["source"]["duration_s"] > 5
    # I1 : le texte (entier ou plage de mots) vient du corpus ; I3 : tout verset nommé est de la
    # sourate récitée ; succès = au moins un verset RECOGNIZED (un INFERRED ne prouve rien).
    report = assert_matches_corpus(
        result, load_repository(corpus_dir(os.environ)), surah=SURAH, min_recognized=1
    )
    assert report.recognized, "aucun verset RECOGNIZED sur un audio propre de 4 versets"
