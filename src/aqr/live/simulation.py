"""Banc de simulation du suivi en direct : rejeu, vérité terrain, mesures (ADR-0011, étape 1).

`run_stream` rejoue des mots déjà datés (voir `replay`) dans un `HypothesisTracker`, en faisant
avancer le silence entre les mots. `evaluate` confronte les événements à la vérité terrain d'un
scénario (versets avec leur intervalle, zones non coraniques) et mesure : temps jusqu'au premier
`CANDIDATES`, à la liste courte contenant le bon verset, au `LOCKED` ; mots entendus au verrou ;
**faux verrous** (cible : 0, I3) ; sauts attendus, détectés, à tort ; pertes. `summarize` agrège.

Toutes les durées sont des temps du flux, comptés depuis le début du verset de vérité.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from itertools import pairwise
from typing import Any

from aqr.domain.models import VerseRef
from aqr.domain.ports import HeardWord
from aqr.live.config import LiveConfig
from aqr.live.events import (
    Candidates,
    Continue,
    Jump,
    LiveEvent,
    Locked,
    Lost,
    Revision,
    Unresolved,
)
from aqr.live.prefix_index import PrefixIndex
from aqr.live.tracker import HypothesisTracker

DEFAULT_TOLERANCE_S = 0.5
"""Écart toléré entre le temps d'un mot de l'ASR et les bornes de la vérité terrain."""
DEFAULT_GRACE_S = 2.5
"""Un événement lié à un verset peut arriver après sa fin (blocs de l'ASR, mot de fin)."""
ADJACENCY_S = 5.0
"""Deux versets de vérité séparés de moins que cela, sans zone entre eux, se suivent."""


# --------------------------------------------------------------------------- rejeu
def run_stream(
    index: PrefixIndex,
    config: LiveConfig,
    words: Sequence[HeardWord],
    duration_s: float,
) -> list[LiveEvent]:
    """Rejoue `words` (déjà datés d'une arrivée) puis clôt le flux à `duration_s`."""
    tracker = HypothesisTracker(index, config)
    events: list[LiveEvent] = []
    for word in words:
        events.extend(tracker.tick(word.arrival_s))
        events.extend(tracker.feed(word))
    end = max(duration_s, words[-1].arrival_s) if words else duration_s
    events.extend(tracker.tick(end))
    events.extend(tracker.finish(end))
    return events


# --------------------------------------------------------------------------- vérité terrain
@dataclass(frozen=True)
class TruthVerse:
    ref: VerseRef
    start_s: float
    end_s: float


@dataclass(frozen=True)
class TruthZone:
    """Parole qui n'est pas du Coran : aucun verset ne doit y être nommé (I4)."""

    start_s: float
    end_s: float
    kind: str


@dataclass(frozen=True)
class Scenario:
    id: str
    source: str
    words: tuple[HeardWord, ...]
    duration_s: float
    verses: tuple[TruthVerse, ...]
    zones: tuple[TruthZone, ...] = ()


# --------------------------------------------------------------------------- résultats
@dataclass(frozen=True)
class VerseResult:
    ref: VerseRef
    start_s: float
    end_s: float
    t_first_candidates: float | None
    t_short_list: float | None
    t_locked: float | None
    words_at_lock: int | None
    status: str | None
    identity_basis: str | None
    unique_prefix_words: int | None
    locked_correct: bool
    closed_unresolved: bool
    with_context: bool

    @property
    def duration_s(self) -> float:
        return self.end_s - self.start_s


@dataclass(frozen=True)
class FalseLock:
    kind: str  # wrong_verse | non_quran | unattributed
    locked: VerseRef
    truth: VerseRef | None
    t: float
    status: str


@dataclass(frozen=True)
class ZoneResult:
    kind: str
    start_s: float
    end_s: float
    candidates: int
    locks: int
    lost: int


@dataclass(frozen=True)
class ScenarioResult:
    scenario_id: str
    verses: list[VerseResult]
    zones: list[ZoneResult]
    false_locks: list[FalseLock]
    revisions: int
    jumps_expected: int
    jumps_detected: int
    jumps_spurious: int
    lost_in_recitation: int
    events: dict[str, int] = field(default_factory=dict)


# --------------------------------------------------------------------------- évaluation
def _verse_at(
    scenario: Scenario, t: float, tolerance_s: float, upper_s: float = 0.0
) -> TruthVerse | None:
    """Verset de vérité qui contient `t` (à la tolérance près, `upper_s` de plus après sa fin) ;
    en cas de recouvrement, celui dont le début est le plus proche de `t`."""
    found = [
        v
        for v in scenario.verses
        if v.start_s - tolerance_s <= t <= v.end_s + tolerance_s + upper_s
    ]
    if not found:
        return None
    return min(found, key=lambda v: abs(v.start_s - t) if t >= v.start_s else v.start_s - t + 1e-3)


def _zone_at(
    scenario: Scenario, t: float, tolerance_s: float, upper_s: float = 0.0
) -> TruthZone | None:
    for zone in scenario.zones:
        if zone.start_s - tolerance_s <= t <= zone.end_s + tolerance_s + upper_s:
            return zone
    return None


def evaluate(
    scenario: Scenario,
    events: Sequence[LiveEvent],
    index: PrefixIndex,
    *,
    tolerance_s: float = DEFAULT_TOLERANCE_S,
    grace_s: float = DEFAULT_GRACE_S,
    short_list: int = 5,
) -> ScenarioResult:
    locks = [e for e in events if isinstance(e, Locked)]
    candidates = [e for e in events if isinstance(e, Candidates)]
    jumps = [e for e in events if isinstance(e, Jump)]
    losts = [e for e in events if isinstance(e, Lost)]
    unresolved = [e for e in events if isinstance(e, Unresolved)]

    verses = sorted(scenario.verses, key=lambda v: v.start_s)
    ordered = Scenario(
        scenario.id, scenario.source, scenario.words, scenario.duration_s, tuple(verses),
        scenario.zones,
    )  # fmt: skip

    false_locks: list[FalseLock] = []
    correct_locks: dict[int, Locked] = {}
    for emitted in locks:
        truth = _verse_at(ordered, emitted.start_s, tolerance_s)
        if truth is None:
            zone = _zone_at(ordered, emitted.start_s, tolerance_s)
            kind = "non_quran" if zone is not None else "unattributed"
            false_locks.append(FalseLock(kind, emitted.ref, None, emitted.t, emitted.status.value))
        elif truth.ref != emitted.ref:
            false_locks.append(
                FalseLock("wrong_verse", emitted.ref, truth.ref, emitted.t, emitted.status.value)
            )
        else:
            slot = verses.index(truth)
            correct_locks.setdefault(slot, emitted)

    results: list[VerseResult] = []
    for slot, verse in enumerate(verses):
        mine = [
            c
            for c in candidates
            if verse.start_s - tolerance_s <= c.start_s <= verse.end_s
            and c.t <= verse.end_s + tolerance_s + grace_s
        ]
        first = min((c.t for c in mine), default=None)
        short = min(
            (c.t for c in mine if c.count <= short_list and verse.ref in {i.ref for i in c.items}),
            default=None,
        )
        lock = correct_locks.get(slot)
        previous = verses[slot - 1] if slot else None
        with_context = (
            previous is not None
            and previous.ref.next() == verse.ref
            and 0 <= verse.start_s - previous.end_s < ADJACENCY_S
            and _zone_between(ordered, previous.end_s, verse.start_s) is None
        )
        results.append(
            VerseResult(
                ref=verse.ref,
                start_s=verse.start_s,
                end_s=verse.end_s,
                t_first_candidates=None if first is None else first - verse.start_s,
                t_short_list=None if short is None else short - verse.start_s,
                t_locked=None if lock is None else lock.t - verse.start_s,
                words_at_lock=None if lock is None else lock.words_heard,
                status=None if lock is None else lock.status.value,
                identity_basis=None if lock is None else lock.identity_basis,
                unique_prefix_words=index.unique_prefix_words(verse.ref),
                locked_correct=lock is not None,
                closed_unresolved=any(
                    verse.start_s - tolerance_s <= u.start_s <= verse.end_s
                    and verse.ref in u.candidates
                    for u in unresolved
                ),
                with_context=bool(with_context),
            )
        )

    expected = 0
    detected = 0
    spurious = 0
    transitions = [
        (a, b)
        for a, b in pairwise(verses)
        if b.start_s - a.end_s < ADJACENCY_S and _zone_between(ordered, a.end_s, b.start_s) is None
    ]
    breaking = [(a, b) for a, b in transitions if a.ref.next() != b.ref]
    expected = len(breaking)
    matched_jumps: set[int] = set()
    for _a, b in breaking:
        for number, jump in enumerate(jumps):
            if number not in matched_jumps and (
                b.start_s - tolerance_s <= jump.t <= b.end_s + tolerance_s + grace_s
            ):
                matched_jumps.add(number)
                detected += 1
                break
    spurious = len(jumps) - len(matched_jumps)

    lost_in_recitation = 0
    zone_results: list[ZoneResult] = []
    for zone in scenario.zones:
        zone_results.append(
            ZoneResult(
                kind=zone.kind,
                start_s=zone.start_s,
                end_s=zone.end_s,
                candidates=sum(
                    1
                    for c in candidates
                    if zone.start_s - tolerance_s <= c.start_s <= zone.end_s
                    and c.t <= zone.end_s + tolerance_s + grace_s
                ),
                locks=sum(
                    1
                    for f in false_locks
                    if f.kind == "non_quran" and _in_zone(zone, f, tolerance_s)
                ),
                lost=sum(
                    1
                    for lost in losts
                    if zone.start_s - tolerance_s <= lost.t <= zone.end_s + tolerance_s + grace_s
                ),
            )
        )
    for lost in losts:
        if (
            _verse_at(ordered, lost.t, tolerance_s) is not None
            and _zone_at(ordered, lost.t, tolerance_s, grace_s) is None
        ):
            lost_in_recitation += 1

    counts: dict[str, int] = {}
    for event in events:
        counts[type(event).__name__] = counts.get(type(event).__name__, 0) + 1
    return ScenarioResult(
        scenario_id=scenario.id,
        verses=results,
        zones=zone_results,
        false_locks=false_locks,
        revisions=sum(1 for e in events if isinstance(e, Revision)),
        jumps_expected=expected,
        jumps_detected=detected,
        jumps_spurious=spurious,
        lost_in_recitation=lost_in_recitation,
        events=counts,
    )


def _zone_between(scenario: Scenario, start_s: float, end_s: float) -> TruthZone | None:
    for zone in scenario.zones:
        if zone.start_s < end_s and zone.end_s > start_s:
            return zone
    return None


def _in_zone(zone: TruthZone, false_lock: FalseLock, tolerance_s: float) -> bool:
    # le verrou est daté à son arrivée ; il appartient à la zone qui précède ou contient ce temps
    return zone.start_s - tolerance_s <= false_lock.t <= zone.end_s + tolerance_s + DEFAULT_GRACE_S


# --------------------------------------------------------------------------- synthèse
def _percentile(sorted_values: Sequence[float], q: float) -> float:
    return sorted_values[min(len(sorted_values) - 1, math.ceil(q * len(sorted_values)) - 1)]


def distribution(values: Sequence[float]) -> dict[str, Any]:
    """Effectif, médiane, p90 et maximum (None si vide)."""
    if not values:
        return {"count": 0, "median": None, "p90": None, "max": None}
    ordered = sorted(values)
    n = len(ordered)
    median = ordered[n // 2] if n % 2 else (ordered[n // 2 - 1] + ordered[n // 2]) / 2
    return {
        "count": n,
        "median": round(median, 3),
        "p90": round(_percentile(ordered, 0.9), 3),
        "max": round(ordered[-1], 3),
    }


def summarize(results: Sequence[ScenarioResult]) -> dict[str, Any]:
    verses = [v for r in results for v in r.verses]
    locked = [v for v in verses if v.locked_correct]
    shares = [v.t_locked / v.duration_s for v in locked if v.t_locked is not None and v.duration_s]
    with_context = [v for v in locked if v.with_context]
    without_context = [v for v in locked if not v.with_context]
    false_locks = [f for r in results for f in r.false_locks]
    return {
        "scenarios": len(results),
        "verses": len(verses),
        "locked_correct": len(locked),
        "never_locked": len(verses) - len(locked),
        "unresolved_closed": sum(1 for v in verses if v.closed_unresolved and not v.locked_correct),
        "false_locks": len(false_locks),
        "false_lock_detail": [
            {
                "kind": f.kind,
                "locked": str(f.locked),
                "truth": None if f.truth is None else str(f.truth),
            }
            for f in false_locks
        ],
        "revisions": sum(r.revisions for r in results),
        "inferred_locks": sum(1 for v in locked if v.status == "inferred"),
        "t_first_candidates_s": distribution(
            [v.t_first_candidates for v in verses if v.t_first_candidates is not None]
        ),
        "t_short_list_s": distribution(
            [v.t_short_list for v in verses if v.t_short_list is not None]
        ),
        "t_locked_s": distribution([v.t_locked for v in locked if v.t_locked is not None]),
        "t_locked_with_context_s": distribution(
            [v.t_locked for v in with_context if v.t_locked is not None]
        ),
        "t_locked_without_context_s": distribution(
            [v.t_locked for v in without_context if v.t_locked is not None]
        ),
        "t_locked_share_of_verse": distribution(shares),
        "words_at_lock": distribution([float(v.words_at_lock) for v in locked if v.words_at_lock]),
        "jumps": {
            "expected": sum(r.jumps_expected for r in results),
            "detected": sum(r.jumps_detected for r in results),
            "spurious": sum(r.jumps_spurious for r in results),
        },
        "lost_in_recitation": sum(r.lost_in_recitation for r in results),
        "zones": {
            "count": sum(len(r.zones) for r in results),
            "with_lock": sum(1 for r in results for z in r.zones if z.locks),
            "with_candidates": sum(1 for r in results for z in r.zones if z.candidates),
            "with_lost": sum(1 for r in results for z in r.zones if z.lost),
        },
    }


__all__ = [
    "Continue",
    "FalseLock",
    "Scenario",
    "ScenarioResult",
    "TruthVerse",
    "TruthZone",
    "VerseResult",
    "ZoneResult",
    "distribution",
    "evaluate",
    "run_stream",
    "summarize",
]
