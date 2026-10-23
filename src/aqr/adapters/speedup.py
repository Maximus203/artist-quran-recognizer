"""Oreille accélérée de la cascade (ADR-0013) : le moteur principal écoute l'audio d'une fenêtre
ACCÉLÉRÉ, les temps de ses mots reviennent à l'échelle de l'audio d'origine.

Deux pièces :

- `FfmpegTimeStretcher` (port `TimeStretcher`) : accélération sans changement de hauteur, `atempo`
  de ffmpeg en pipe (aucun fichier temporaire) ;
- `SpeedUpASR` (port `QuranASR`) : accélère les fenêtres demandées, les écoute d'un seul tenant
  avec le moteur principal, rend des transcriptions aux temps d'origine. Elle ne décide de rien :
  ce qu'elle entend rejoint les candidats de la cascade, que l'arbitre acoustique juge sur l'audio
  d'ORIGINE (I3).
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from array import array
from collections.abc import Sequence
from typing import Any

from aqr.domain.models import Riwaya, TimeSpan
from aqr.domain.ports import AudioClip, TimeStretcher, TranscribedWord, Transcript

MIN_WORD_S = 0.001
"""Durée minimale d'un mot ramené dans sa fenêtre (un intervalle ne peut pas être vide)."""


class FfmpegTimeStretcher:
    """`atempo` de ffmpeg : l'audio de `samples` va `factor` fois plus vite, hauteur conservée."""

    def __init__(self, ffmpeg_path: str | None = None, timeout_s: float | None = 120.0) -> None:
        self._ffmpeg, self._timeout = ffmpeg_path or "ffmpeg", timeout_s

    def stretch(self, samples: Sequence[float], sample_rate: int, factor: float) -> Sequence[float]:
        if factor <= 0:
            raise ValueError(f"facteur invalide : {factor}")
        executable = shutil.which(self._ffmpeg)
        if executable is None:
            raise RuntimeError(f"ffmpeg introuvable ({self._ffmpeg!r}) : accélération impossible")
        raw = array("f", samples)
        if sys.byteorder == "big":
            raw.byteswap()
        command = [
            executable, "-nostdin", "-v", "error",
            "-f", "f32le", "-ar", str(sample_rate), "-ac", "1", "-i", "pipe:0",
            "-af", f"atempo={factor:g}",
            "-f", "f32le", "-ar", str(sample_rate), "-ac", "1", "pipe:1",
        ]  # fmt: skip
        done = subprocess.run(
            command, input=raw.tobytes(), capture_output=True, check=False, timeout=self._timeout
        )
        if done.returncode != 0:
            detail = done.stderr.decode("utf-8", errors="replace").strip().splitlines()
            raise RuntimeError(
                f"ffmpeg atempo a échoué ({detail[-1] if detail else 'erreur inconnue'})"
            )
        out = array("f")
        out.frombytes(done.stdout[: len(done.stdout) - len(done.stdout) % 4])
        if sys.byteorder == "big":
            out.byteswap()
        return out


class SpeedUpASR:
    """`QuranASR` qui écoute l'audio accéléré de `factor` : un ASR et son accélérateur."""

    def __init__(
        self,
        inner: Any,
        stretcher: TimeStretcher,
        factor: float,
        min_span_s: float = 0.3,
    ) -> None:
        if factor <= 1.0:
            raise ValueError(f"une oreille accélérée exige un facteur > 1 (reçu {factor})")
        self._inner, self._stretcher = inner, stretcher
        self.factor = factor
        self._min_span_s = min_span_s
        self.riwaya: Riwaya = inner.riwaya

    @property
    def engine(self) -> str:
        return f"{getattr(self._inner, 'engine', 'asr')}+vitesse x{self.factor:g}"

    def transcribe(self, clip: AudioClip, span: TimeSpan) -> Transcript:
        return self.transcribe_batch(clip, [span])[0]

    def transcribe_batch(self, clip: AudioClip, spans: Sequence[TimeSpan]) -> list[Transcript]:
        rate = clip.sample_rate
        joined: array[float] = array("f")
        placed: list[
            tuple[int, TimeSpan, float]
        ] = []  # (indice, fenêtre d'origine, début accéléré)
        for index, span in enumerate(spans):
            if span.duration_s < self._min_span_s:
                continue
            piece = self._stretcher.stretch(
                clip.samples[round(span.start_s * rate) : round(span.end_s * rate)],
                rate,
                self.factor,
            )
            placed.append((index, span, len(joined) / rate))
            joined.extend(piece)
        results: dict[int, Transcript] = {}
        if placed:
            ends = [start for _i, _s, start in placed[1:]] + [len(joined) / rate]
            fast_spans = [
                TimeSpan(start, end) for (_i, _s, start), end in zip(placed, ends, strict=True)
            ]
            heard = self._listen(
                AudioClip(joined, rate, f"{clip.source}#x{self.factor:g}"), fast_spans
            )
            for (index, span, start), transcript in zip(placed, heard, strict=True):
                results[index] = self._restored(transcript, span, start)
        empty = Transcript(words=(), engine=self.engine)
        return [results.get(i, empty) for i in range(len(spans))]

    def _listen(self, clip: AudioClip, spans: Sequence[TimeSpan]) -> list[Transcript]:
        batch = getattr(self._inner, "transcribe_batch", None)
        if batch is not None:
            heard: list[Transcript] = batch(clip, spans)
            return heard
        return [self._inner.transcribe(clip, span) for span in spans]

    def _restored(self, transcript: Transcript, span: TimeSpan, start: float) -> Transcript:
        """Temps accélérés -> temps d'origine, bornés à la fenêtre d'origine."""
        words: list[TranscribedWord] = []
        for word in transcript.words:
            begin = span.start_s + (word.time.start_s - start) * self.factor
            end = span.start_s + (word.time.end_s - start) * self.factor
            begin = min(max(begin, span.start_s), span.end_s - MIN_WORD_S)
            end = min(max(end, begin + MIN_WORD_S), span.end_s)
            words.append(TranscribedWord(word.text, TimeSpan(begin, end), word.confidence))
        return Transcript(words=tuple(words), engine=self.engine)
