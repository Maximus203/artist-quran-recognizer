"""Lecteur de la sortie JSON `aqr.recognition/1` (indépendant du moteur qui l'écrit).

Schéma lu (voir docs/EVALUATION-METRICS.md) : `source`, `engine`, `decoder`, `timing`,
`intervals` (chronologiques) de trois sortes :
- `verse` : ref, words [a, b], status recognized|inferred|uncertain, t [début, fin] ou null,
  time_interpolated, confidence, candidates ;
- `non_quran` : label, t ;
- `abstention` : reason, t, best_score (absence de décision, jamais un verset).

Le lecteur ne juge rien : il valide la forme et renvoie des objets typés. Un verset `recognized`
sans horodatage est une sortie invalide (il serait invérifiable) et lève `RecognitionError`.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from aqr.domain.models import Status, VerseRef

SCHEMA = "aqr.recognition/1"


class RecognitionError(ValueError):
    """Sortie de reconnaissance illisible ou hors schéma."""


@dataclass(frozen=True)
class VerseInterval:
    ref: VerseRef
    first_word: int
    last_word: int
    status: Status
    t: tuple[float, float] | None
    time_interpolated: bool = False
    confidence: float = 0.0
    candidates: tuple[VerseRef, ...] = ()


@dataclass(frozen=True)
class NonQuranInterval:
    label: str
    t: tuple[float, float]


@dataclass(frozen=True)
class AbstentionInterval:
    reason: str
    t: tuple[float, float]
    best_score: float | None = None


Interval = VerseInterval | NonQuranInterval | AbstentionInterval


@dataclass(frozen=True)
class Recognition:
    intervals: tuple[Interval, ...]
    source: Mapping[str, Any] = field(default_factory=dict)
    engine: Mapping[str, Any] = field(default_factory=dict)
    decoder: Mapping[str, Any] = field(default_factory=dict)
    timing: Mapping[str, Any] = field(default_factory=dict)


def _span(raw: object, where: str) -> tuple[float, float]:
    if not (isinstance(raw, Sequence) and not isinstance(raw, str) and len(raw) == 2):
        raise RecognitionError(f"{where} : t doit être [début, fin]")
    try:
        start, end = float(raw[0]), float(raw[1])
    except (TypeError, ValueError) as exc:
        raise RecognitionError(f"{where} : t illisible {raw!r}") from exc
    if start < 0 or end <= start:
        raise RecognitionError(f"{where} : intervalle invalide {start} -> {end}")
    return start, end


def _parse_one(raw: object, index: int) -> Interval:
    where = f"intervals[{index}]"
    if not isinstance(raw, Mapping):
        raise RecognitionError(f"{where} : objet attendu")
    kind = raw.get("kind")
    try:
        if kind == "verse":
            status = Status(raw["status"])
            t = _span(raw["t"], where) if raw.get("t") is not None else None
            if status is Status.RECOGNIZED and t is None:
                raise RecognitionError(f"{where} : un verset recognized doit avoir t")
            words = raw.get("words") or [1, 1]
            first, last = int(words[0]), int(words[1])
            if first < 1 or last < first:
                raise RecognitionError(f"{where} : words invalide {words!r}")
            return VerseInterval(
                ref=VerseRef.parse(str(raw["ref"])),
                first_word=first,
                last_word=last,
                status=status,
                t=t,
                time_interpolated=bool(raw.get("time_interpolated", False)),
                confidence=float(raw.get("confidence", 0.0)),
                candidates=tuple(VerseRef.parse(str(c)) for c in raw.get("candidates") or ()),
            )
        if kind == "non_quran":
            return NonQuranInterval(
                str(raw.get("label", "unclassified")), _span(raw.get("t"), where)
            )
        if kind == "abstention":
            score = raw.get("best_score")
            return AbstentionInterval(
                str(raw.get("reason", "")),
                _span(raw.get("t"), where),
                float(score) if score is not None else None,
            )
    except RecognitionError:
        raise
    except (KeyError, ValueError, TypeError, IndexError) as exc:
        raise RecognitionError(f"{where} : {exc}") from exc
    raise RecognitionError(f"{where} : kind inconnu {kind!r} (verse, non_quran, abstention)")


def parse_intervals(raw: Sequence[object]) -> tuple[Interval, ...]:
    return tuple(_parse_one(item, i) for i, item in enumerate(raw))


def parse_recognition(data: Mapping[str, Any]) -> Recognition:
    if data.get("schema") != SCHEMA:
        raise RecognitionError(f"schema {data.get('schema')!r} non géré (attendu {SCHEMA})")
    intervals = data.get("intervals")
    if not isinstance(intervals, list):
        raise RecognitionError("intervals : liste attendue")
    return Recognition(
        intervals=parse_intervals(intervals),
        source=dict(data.get("source") or {}),
        engine=dict(data.get("engine") or {}),
        decoder=dict(data.get("decoder") or {}),
        timing=dict(data.get("timing") or {}),
    )


def load_recognition(path: Path) -> Recognition:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RecognitionError(f"{path} : {exc}") from exc
    if not isinstance(data, dict):
        raise RecognitionError(f"{path} : objet JSON attendu")
    return parse_recognition(data)
