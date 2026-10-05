"""Fakes des ports audio : même contrat que les adapters réels, sans modèle ni ffmpeg."""

from __future__ import annotations

import wave
from array import array
from pathlib import Path

from aqr.domain.ports import AudioClip

SAMPLE_RATE = 16000


class FakeAudioExtractor:
    """Lit un WAV mono 16 kHz (celui que fabrique `tests.support.audio`)."""

    def extract(self, path: Path) -> AudioClip:
        if not path.exists():
            raise FileNotFoundError(path)
        with wave.open(str(path), "rb") as handle:
            raw = handle.readframes(handle.getnframes())
            rate = handle.getframerate()
        ints = array("h")
        ints.frombytes(raw)
        return AudioClip(
            samples=array("f", (x / 32768.0 for x in ints)), sample_rate=rate, source=str(path)
        )
