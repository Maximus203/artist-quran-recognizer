"""Résultat de la reconnaissance : intervalles ordonnés dans le temps, chacun explicite sur ce qu'il
affirme. Un verset reconnu, un verset supposé (INFERRED), un verset ambigu (UNCERTAIN), une parole
non coranique étiquetée, ou une **abstention** (aucune décision : jamais un verset)."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from aqr.domain.models import Detection, NonQuranSpan, TimeSpan


class AbstentionReason(StrEnum):
    SILENCE = "silence"  # aucune énergie dans la fenêtre
    EMPTY_TRANSCRIPT = "empty_transcript"  # l'ASR n'a rendu aucun mot arabe
    NO_CANDIDATE = "no_candidate"  # aucun verset ne ressemble à la transcription
    BELOW_THRESHOLD = "below_threshold"  # ressemblance trop faible pour nommer un verset (I3)


@dataclass(frozen=True)
class AbstentionSpan:
    time: TimeSpan
    reason: AbstentionReason
    best_score: float | None = None
    """Meilleur score du matcher, pour diagnostic : ce n'est PAS un verset reconnu."""


Interval = Detection | NonQuranSpan | AbstentionSpan


@dataclass(frozen=True)
class EngineInfo:
    asr: str
    segmenter: str
    matcher: str
    decoder: str
    constrained: bool = False
    corpus: str = ""


@dataclass(frozen=True)
class RecognitionResult:
    source_file: str
    duration_s: float
    intervals: tuple[Interval, ...]
    engine: EngineInfo
    timing: dict[str, float]
    decoder_config: dict[str, float]
    windows: int
    warnings: tuple[str, ...] = field(default_factory=tuple)

    def detections(self) -> tuple[Detection, ...]:
        return tuple(i for i in self.intervals if isinstance(i, Detection))
