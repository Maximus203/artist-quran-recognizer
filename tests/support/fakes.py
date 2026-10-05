"""Fakes des ports audio : même contrat que les adapters réels, sans modèle ni ffmpeg."""

from __future__ import annotations

import wave
from array import array
from pathlib import Path

from aqr.domain.models import Riwaya, TimeSpan
from aqr.domain.ports import AudioClip, TranscribedWord, Transcript

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


class FakeQuranASR:
    """B4 factice : répartit un texte scénarisé uniformément sur le segment."""

    riwaya = Riwaya.HAFS

    def __init__(self, text: str = "قُلْ هُوَ اللَّهُ أَحَدٌ") -> None:
        self._words = text.split()

    def transcribe(self, clip: AudioClip, span: TimeSpan) -> Transcript:
        duration = len(clip.samples) / clip.sample_rate
        if span.end_s > duration + 1e-6:
            raise ValueError("segment hors du clip")
        if (
            max(
                (
                    abs(x)
                    for x in clip.samples[
                        round(span.start_s * clip.sample_rate) : round(
                            span.end_s * clip.sample_rate
                        )
                    ]
                ),
                default=0.0,
            )
            < 1e-3
        ):
            return Transcript(words=(), engine="fake-quran-asr")
        step = (span.end_s - span.start_s) / len(self._words)
        words = tuple(
            TranscribedWord(
                text=w,
                time=TimeSpan(span.start_s + i * step, span.start_s + (i + 1) * step),
                confidence=0.9,
            )
            for i, w in enumerate(self._words)
        )
        return Transcript(words=words, engine="fake-quran-asr")


class EnergySegmenter:
    """B2 factice : trames de 20 ms au-dessus d'un seuil d'énergie, pauses courtes comblées."""

    def __init__(self, threshold: float = 0.01, min_gap_s: float = 0.5) -> None:
        self._threshold, self._min_gap = threshold, min_gap_s

    def segment(self, clip: AudioClip) -> list[TimeSpan]:
        frame = round(0.02 * clip.sample_rate)
        spans: list[list[float]] = []
        for index in range(0, len(clip.samples) - frame + 1, frame):
            chunk = clip.samples[index : index + frame]
            if max(abs(x) for x in chunk) < self._threshold:
                continue
            start, end = index / clip.sample_rate, (index + frame) / clip.sample_rate
            if spans and start - spans[-1][1] < self._min_gap:
                spans[-1][1] = end
            else:
                spans.append([start, end])
        return [TimeSpan(a, b) for a, b in spans]
