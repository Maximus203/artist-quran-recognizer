"""Promotion par le voisin reconnu (ADR-0010) : quelles détections `uncertain` méritent qu'on
demande à l'audio de les soutenir.

Le décodeur marque `uncertain` une fenêtre dont deux candidats se valent à ses yeux : le début de
11:61 ressemble à celui de 7:73, 26:141-143… Mais la fenêtre voisine, contiguë, est un verset
`recognized` qui CONTINUE l'un des deux (11:61 [10-17] prolonge 11:61 [1-10], pas 7:73). Cette
preuve n'était jamais consultée : le score d'un candidat ne regarde que la couche qui le précède.

Ici, seule la PROPOSITION est pure : quel candidat de quelle fenêtre prolonge quel voisin reconnu.
Aucune promotion n'a lieu sans l'audio : le pipeline fait soutenir le texte du corpus de la plage
par l'alignement CTC (`AcousticVerifier.verify_alone`, même seuil que toute suite, I3).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from aqr.decoding.chains import Observation, recited_start
from aqr.domain.models import Detection, Status, TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import Candidate


class _Words(Protocol):
    def words(self, ref: VerseRef) -> tuple[str, ...]: ...


@dataclass(frozen=True)
class NeighborConfig:
    enabled: bool = True
    max_overlap_words: int = 2
    """Mots que deux plages contiguës du même verset peuvent avoir en commun : une fenêtre finit
    souvent sur le mot par lequel la suivante commence (11:61 [1-10] puis [10-17]). Au-delà, ce
    n'est plus un raccord mais une reprise (i'ada). Provisoire (étape A)."""
    max_gap_words: int = 1
    """Mots qu'une plage peut perdre au raccord (l'ASR tronque souvent le premier ou le dernier mot
    d'une fenêtre, même tolérance que `ChainConfig.word_slack`)."""


@dataclass(frozen=True)
class Promotion:
    """Une détection `uncertain` et le candidat de sa fenêtre qui prolonge un voisin reconnu."""

    index: int
    """Indice de la détection `uncertain`."""
    neighbor: int
    """Indice du voisin `recognized` qui le prolonge."""
    candidate: Candidate
    """Le candidat à soutenir par l'audio : une seule plage, du verset que le voisin prolonge."""
    window: TimeSpan
    """Fenêtre ASR de ce candidat (le passage où l'audio doit le soutenir)."""


def _joins(left: WordSpan, right: WordSpan, corpus: _Words, config: NeighborConfig) -> bool:
    """`right` prolonge `left` dans le Mushaf : même verset, `right` commence là où `left` finit
    (ou chevauche d'au plus `max_overlap_words`, ou perd au plus `max_gap_words`), ou verset
    suivant ouvert alors que `left` est fini."""
    if right.ref == left.ref:
        gap = right.first_word - left.last_word - 1
        return (
            left.first_word < right.first_word
            and left.last_word < right.last_word
            and -config.max_overlap_words <= gap <= config.max_gap_words
        )
    if right.ref != left.ref.next():
        return False
    finished = left.last_word >= len(corpus.words(left.ref)) - config.max_gap_words
    return finished and right.first_word <= recited_start(right.ref) + config.max_gap_words


def _window_of(time: TimeSpan, observations: Sequence[Observation]) -> int | None:
    """Observation dont la fenêtre recouvre le plus le temps d'une détection."""
    best, index = 0.0, None
    for i, (window, _candidates) in enumerate(observations):
        overlap = min(window.end_s, time.end_s) - max(window.start_s, time.start_s)
        if overlap > best:
            best, index = overlap, i
    return index


def _near(
    earlier: Detection, later: Detection, max_gap_s: float, barriers: Sequence[TimeSpan]
) -> bool:
    """Deux détections contiguës : peu de secondes entre elles et aucune fenêtre écartée au
    milieu (elle prouve que l'écart contient autre chose, comme pour la fusion du décodeur)."""
    assert earlier.time is not None and later.time is not None
    if later.time.start_s < earlier.time.start_s:
        return False
    if later.time.start_s - earlier.time.end_s > max_gap_s:
        return False
    return not any(
        b.start_s >= earlier.time.end_s - 1e-9 and b.end_s <= later.time.start_s + 1e-9
        for b in barriers
    )


def propose_promotions(
    detections: Sequence[Detection],
    observations: Sequence[Observation],
    corpus: _Words,
    config: NeighborConfig,
    *,
    floor: float,
    max_gap_s: float,
    barriers: Sequence[TimeSpan] = (),
) -> list[Promotion]:
    """Pour chaque détection `uncertain` à côté d'un verset `recognized` : le candidat viable (score
    ≥ `floor`, une seule plage) de sa fenêtre qui PROLONGE ce voisin, parmi les versets que le
    décodeur disait possibles. Deux plages qui prolongent aussi bien le voisin (même score) ne
    départagent rien : aucune proposition. `barriers` : fenêtres écartées par le décodeur."""
    if not config.enabled:
        return []
    out: list[Promotion] = []
    for i, det in enumerate(detections):
        if det.status is not Status.UNCERTAIN or det.time is None:
            continue
        window_index = _window_of(det.time, observations)
        if window_index is None:
            continue
        window, candidates = observations[window_index]
        possible = {det.span.ref, *det.candidates}
        viable = [
            c
            for c in candidates
            if c.score >= floor and not c.continuation and c.span.ref in possible
        ]
        found: list[tuple[Candidate, int]] = []
        for j, backward in ((i + 1, True), (i - 1, False)):
            if not 0 <= j < len(detections):
                continue
            neighbor = detections[j]
            if neighbor.status is not Status.RECOGNIZED or neighbor.time is None:
                continue
            earlier, later = (det, neighbor) if backward else (neighbor, det)
            if not _near(earlier, later, max_gap_s, barriers):
                continue
            for c in viable:
                left, right = (c.span, neighbor.span) if backward else (neighbor.span, c.span)
                if _joins(left, right, corpus, config):
                    found.append((c, j))
        if not found:
            continue
        top = max(c.score for c, _j in found)
        best = {(c.span, j): (c, j) for c, j in found if c.score == top}
        if len(best) == 1:
            ((candidate, neighbor_index),) = best.values()
            out.append(Promotion(i, neighbor_index, candidate, window))
    return out
