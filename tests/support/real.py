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


def _voiced_bounds(
    part: AudioClip, rms: float = 0.01, frame_s: float = 0.02
) -> tuple[float, float]:
    """(début, fin) de la parole d'un clip : les queues de silence des MP3 n'en font pas partie."""
    import numpy as np

    data = np.asarray(part.samples, dtype=np.float32)
    step = round(frame_s * part.sample_rate)
    frames = len(data) // step
    energy = np.sqrt(np.square(data[: frames * step]).reshape(frames, step).mean(axis=1))
    voiced = np.flatnonzero(energy >= rms)
    if not len(voiced):
        return 0.0, len(data) / part.sample_rate
    return voiced[0] * frame_s, min((voiced[-1] + 1) * frame_s, len(data) / part.sample_rate)


def with_gaps(parts: list[AudioClip], gap_s: float, lead_s: float = 0.5, seed: int = 1):  # type: ignore[no-untyped-def]
    """Assemble `parts` séparés par `gap_s` de très faible bruit ; renvoie (clip, spans vrais).

    Les spans vrais bornent la parole (énergie), pas la durée du fichier source."""
    import random
    from array import array

    from aqr.domain.models import TimeSpan

    rate = parts[0].sample_rate
    rng = random.Random(seed)

    def quiet(seconds: float) -> array:  # type: ignore[type-arg]
        return array("f", (rng.uniform(-1e-3, 1e-3) for _ in range(round(seconds * rate))))

    samples = array("f", quiet(lead_s))
    truth: list[TimeSpan] = []
    for index, part in enumerate(parts):
        start = len(samples) / rate
        samples.extend(part.samples)
        voiced_start, voiced_end = _voiced_bounds(part)
        truth.append(TimeSpan(start + voiced_start, start + voiced_end))
        samples.extend(quiet(gap_s if index < len(parts) - 1 else lead_s))
    return AudioClip(samples=samples, sample_rate=rate, source="with-gaps"), truth


def iou(a, b) -> float:  # type: ignore[no-untyped-def]
    inter = max(0.0, min(a.end_s, b.end_s) - max(a.start_s, b.start_s))
    union = (a.end_s - a.start_s) + (b.end_s - b.start_s) - inter
    return inter / union if union > 0 else 0.0
