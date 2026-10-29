"""Confirmation par le moteur du lot (ADR-0016) : le direct est rapide, le lot est fiable.

Le suivi du direct (ADR-0011) lit le flux avec un modèle léger, par fenêtres d'environ une
seconde ; il ne nomme un verset que sur preuve, donc il en rate. Le moteur du lot, lui, voit un
passage entier, le segmente, le réécoute avec d'autres modèles et vérifie l'audio. Ce module les
met en série : le flux est découpé aux pauses de la récitation (`PauseCutter`), chaque passage
clos est confié au moteur du lot sur un fil unique (`SegmentConfirmer`), et ses versets reconnus
reviennent après quelques secondes comme des « confirmations » datées dans le temps du flux.

L'audio d'un passage n'est gardé en mémoire que le temps de sa confirmation : jamais écrit sur
disque (ADR-0011 §4). Une confirmation qui échoue ou qui arrive trop tard n'abîme rien : le
direct a déjà dit ce qu'il savait, et l'incident est consigné (`confirm.*`).
"""

from __future__ import annotations

import math
import threading
import time
from array import array
from collections.abc import Sequence
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, replace
from typing import Protocol

from aqr.domain.models import Detection, Status, TimeSpan, WordSpan
from aqr.domain.ports import AudioClip
from aqr.live.journal import journal
from aqr.pipeline.result import RecognitionResult

RATE = 16000
CONFIRMED_STATUSES = (Status.RECOGNIZED, Status.INFERRED)
"""Un passage resté ambigu n'est jamais présenté comme confirmé (I3, I5)."""


class Recognize(Protocol):
    """Le moteur du lot sur un passage ; `relisten=False` saute la réécoute (mode rapide)."""

    def __call__(
        self, clip: AudioClip, source_file: str, *, relisten: bool = True
    ) -> RecognitionResult: ...


@dataclass(frozen=True)
class ConfirmationConfig:
    pause_s: float = 0.8
    """Silence qui clôt un passage."""
    min_segment_s: float = 6.0
    """Un passage plus court attend la pause suivante (le lot décide mal sur deux mots)."""
    max_segment_s: float = 25.0
    """Coupe forcée d'une récitation sans pause."""
    min_voiced_s: float = 1.0
    """Moins de voix que cela : du bruit, pas un passage."""
    frame_s: float = 0.05
    silence_floor: float = 0.003
    """Niveau RMS absolu sous lequel une trame est un silence."""
    silence_ratio: float = 0.1
    """Une trame est un silence si elle est sous cette part du niveau de voix récent."""
    fast_when_pending: int = 2
    """Passages déjà en file à partir desquels le suivant est traité sans réécoute (plus rapide)."""
    max_pending: int = 4
    """Passages en attente par flux ; au-delà, le suivant n'est pas confirmé."""
    wait_end_s: float = 45.0
    """Attente maximale, à la fin du flux, des confirmations en cours."""

    def __post_init__(self) -> None:
        if not (0 < self.frame_s < self.pause_s <= self.min_segment_s <= self.max_segment_s):
            raise ValueError("frame_s < pause_s <= min_segment_s <= max_segment_s requis")
        if self.max_pending < 1 or self.wait_end_s < 0 or self.min_voiced_s < 0:
            raise ValueError("max_pending >= 1, wait_end_s >= 0 et min_voiced_s >= 0 requis")
        if not 1 <= self.fast_when_pending <= self.max_pending:
            raise ValueError("1 <= fast_when_pending <= max_pending requis")


@dataclass(frozen=True)
class Segment:
    start_s: float
    end_s: float
    samples: array[float]


@dataclass(frozen=True)
class Confirmation:
    """Les versets reconnus ou déduits d'un passage clos, dans le temps du flux."""

    start_s: float
    end_s: float
    detections: tuple[Detection, ...]


class PauseCutter:
    """Découpe un flux PCM en passages aux pauses (fonction pure du son, sans modèle)."""

    def __init__(self, config: ConfirmationConfig | None = None) -> None:
        self._config = config or ConfirmationConfig()
        self._frame = max(1, round(self._config.frame_s * RATE))
        self._buffer: array[float] = array("f")
        self._origin = 0.0
        self._scanned = 0
        self._voice_level = 0.0
        self._silent_frames = 0
        self._voiced_frames = 0

    def feed(self, samples: Sequence[float]) -> list[Segment]:
        self._buffer.extend(samples)
        out: list[Segment] = []
        config = self._config
        while len(self._buffer) - self._scanned >= self._frame:
            frame = self._buffer[self._scanned : self._scanned + self._frame]
            self._scanned += self._frame
            level = math.sqrt(sum(v * v for v in frame) / self._frame)
            self._voice_level = max(level, self._voice_level * 0.999)
            if level < max(config.silence_floor, config.silence_ratio * self._voice_level):
                self._silent_frames += 1
            else:
                self._silent_frames = 0
                self._voiced_frames += 1
            length_s = self._scanned / RATE
            paused = self._silent_frames * self._frame / RATE >= config.pause_s
            if (paused and length_s >= config.min_segment_s) or length_s >= config.max_segment_s:
                segment = self._cut()
                if segment is not None:
                    out.append(segment)
        return out

    def flush(self) -> Segment | None:
        """Fin du flux : le passage en cours, s'il porte assez de voix."""
        self._scanned = len(self._buffer)
        return self._cut()

    def _cut(self) -> Segment | None:
        end = self._scanned
        voiced_s = self._voiced_frames * self._frame / RATE
        segment = Segment(self._origin, self._origin + end / RATE, self._buffer[:end])
        self._buffer = self._buffer[end:]
        self._origin += end / RATE
        self._scanned = 0
        self._silent_frames = 0
        self._voiced_frames = 0
        return segment if voiced_s >= self._config.min_voiced_s else None


def merge_parts(detections: Sequence[Detection]) -> tuple[Detection, ...]:
    """Réunit les morceaux d'un même verset que le lot a coupé en deux (fenêtres voisines) : même
    verset, même statut, mots qui se suivent. Le texte affiché sera celui du corpus pour la plage
    entière (I1) ; une plage qui ne se touche pas reste une ligne à part (reprise, i'ada)."""
    out: list[Detection] = []
    for current in detections:
        previous = out[-1] if out else None
        if (
            previous is not None
            and previous.span.ref == current.span.ref
            and previous.status == current.status
            and previous.time is not None
            and current.time is not None
            and not current.is_repetition
            and previous.span.first_word <= current.span.first_word <= previous.span.last_word + 1
            and current.span.last_word >= previous.span.last_word
        ):
            out[-1] = replace(
                previous,
                span=WordSpan(previous.span.ref, previous.span.first_word, current.span.last_word),
                time=TimeSpan(previous.time.start_s, max(previous.time.end_s, current.time.end_s)),
                confidence=min(previous.confidence, current.confidence),
                word_times=(*previous.word_times, *current.word_times)
                if previous.word_times and current.word_times
                else (),
            )
        else:
            out.append(current)
    return tuple(out)


def warm_clip(seconds: float = 6.0) -> AudioClip:
    """Un son voisin de la voix (harmoniques modulées à 4 Hz) pour préchauffer les modèles."""
    n = round(seconds * RATE)
    samples = array(
        "f",
        (
            0.15
            * (0.5 + 0.5 * math.sin(2 * math.pi * 4 * i / RATE))
            * sum(
                math.sin(2 * math.pi * f * i / RATE) / k for k, f in enumerate((140, 280, 420), 1)
            )
            for i in range(n)
        ),
    )
    return AudioClip(samples=samples, sample_rate=RATE, source="warm-up")


def _shifted(detection: Detection, offset: float) -> Detection:
    time = detection.time
    return replace(
        detection,
        time=None if time is None else TimeSpan(time.start_s + offset, time.end_s + offset),
        word_times=tuple(
            TimeSpan(w.start_s + offset, w.end_s + offset) for w in detection.word_times
        ),
    )


class ConfirmationWorker:
    """Un seul fil pour tout le service : le moteur du lot ne tourne jamais en double."""

    def __init__(self, recognize: Recognize) -> None:
        self.recognize = recognize
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="aqr-confirm")

    def submit(
        self, segment: Segment, name: str, *, fast: bool = False
    ) -> Future[RecognitionResult]:
        clip = AudioClip(samples=segment.samples, sample_rate=RATE, source=name)
        return self._pool.submit(self._run, clip, name, segment.start_s, fast)

    def _run(self, clip: AudioClip, name: str, start_s: float, fast: bool) -> RecognitionResult:
        started = time.perf_counter()
        result = self.recognize(clip, name, relisten=not fast)
        journal.info(
            "confirm.done",
            start_s=round(start_s, 1),
            audio_s=round(len(clip.samples) / RATE, 1),
            seconds=round(time.perf_counter() - started, 1),
            fast=fast,
        )
        return result

    def close(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)


class SegmentConfirmer:
    """Le côté d'UN flux : coupe aux pauses, confie les passages au fil commun, rend le résultat."""

    def __init__(
        self, worker: ConfirmationWorker, name: str, config: ConfirmationConfig | None = None
    ) -> None:
        self._config = config or ConfirmationConfig()
        self._worker = worker
        self._name = name
        self._cutter = PauseCutter(self._config)
        self._pending: list[tuple[Segment, Future[RecognitionResult]]] = []
        self._lock = threading.Lock()
        self.skipped = 0

    def feed(self, samples: Sequence[float]) -> None:
        for segment in self._cutter.feed(samples):
            self._submit(segment)

    def ready(self) -> list[Confirmation]:
        """Les confirmations terminées, dans l'ordre des passages (une lenteur ne double pas)."""
        out: list[Confirmation] = []
        with self._lock:
            while self._pending and self._pending[0][1].done():
                segment, future = self._pending.pop(0)
                out.extend(self._collect(segment, future))
        return out

    def finish(self) -> list[Confirmation]:
        """Fin du flux : clôt le dernier passage et attend les confirmations en cours (borné)."""
        last = self._cutter.flush()
        if last is not None:
            self._submit(last)
        out: list[Confirmation] = []
        with self._lock:
            pending, self._pending = self._pending, []
        for segment, future in pending:
            try:
                future.result(timeout=self._config.wait_end_s)
            except Exception:
                future.cancel()
            out.extend(self._collect(segment, future))
        return out

    def _submit(self, segment: Segment) -> None:
        with self._lock:
            if len(self._pending) >= self._config.max_pending:
                self.skipped += 1
                journal.warning(
                    "confirm.skipped", start_s=round(segment.start_s, 1), pending=len(self._pending)
                )
                return
            fast = len(self._pending) >= self._config.fast_when_pending
            self._pending.append((segment, self._worker.submit(segment, self._name, fast=fast)))

    def _collect(self, segment: Segment, future: Future[RecognitionResult]) -> list[Confirmation]:
        if not future.done() or future.cancelled():
            journal.warning("confirm.timeout", start_s=round(segment.start_s, 1))
            return []
        error = future.exception()
        if error is not None:
            journal.warning(
                "confirm.failed", start_s=round(segment.start_s, 1), error=type(error).__name__
            )
            return []
        result = future.result()
        detections = merge_parts(
            [
                _shifted(i, segment.start_s)
                for i in result.intervals
                if isinstance(i, Detection)
                and i.status in CONFIRMED_STATUSES
                and i.time is not None
            ]
        )
        return [Confirmation(segment.start_s, segment.end_s, detections)] if detections else []
