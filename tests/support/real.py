"""Accès aux ressources réelles (modèles, audios EveryAyah) pour les tests `slow`.

Tout est lu dans l'environnement (`AQR_MODELS_DIR`, `AQR_AUDIO_DIR`) : jamais de chemin en dur.
Une ressource absente fait SAUTER le test (raison explicite), jamais échouer.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from aqr.adapters.ffmpeg_extractor import FfmpegAudioExtractor
from aqr.domain.ports import AudioClip

ROOT = Path(__file__).resolve().parents[2]
LOCK_PATH = ROOT / "models" / "LOCK.json"


def models_dir() -> Path:
    value = os.environ.get("AQR_MODELS_DIR")
    if not value or not (Path(value) / "fastconformer-quran").is_dir():
        pytest.skip("AQR_MODELS_DIR absent ou sans modèle (lancer scripts/fetch_models.py)")
    return Path(value)


def everyayah_clip(reciter: str, filename: str) -> AudioClip:
    audio_dir = os.environ.get("AQR_AUDIO_DIR")
    path = Path(audio_dir or "") / "everyayah" / reciter / filename
    if not audio_dir or not path.exists():
        pytest.skip(f"clip EveryAyah absent : {path} (lancer scripts/fetch_everyayah.py)")
    return FfmpegAudioExtractor().extract(path)


def concat(*clips: AudioClip) -> AudioClip:
    from array import array

    samples = array("f")
    for clip in clips:
        samples.extend(clip.samples)
    return AudioClip(samples=samples, sample_rate=clips[0].sample_rate, source="concat")


def silence(seconds: float, rate: int = 16000) -> AudioClip:
    from array import array

    return AudioClip(
        samples=array("f", [0.0] * round(seconds * rate)), sample_rate=rate, source="silence"
    )


def tone_clip(seconds: float, freq: float = 440.0, rate: int = 16000) -> AudioClip:
    import math
    from array import array

    return AudioClip(
        samples=array(
            "f",
            (0.3 * math.sin(2 * math.pi * freq * i / rate) for i in range(round(seconds * rate))),
        ),
        sample_rate=rate,
        source="tone",
    )
