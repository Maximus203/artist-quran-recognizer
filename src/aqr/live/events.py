"""Événements de domaine du suivi en direct (ADR-0011 §3, §6).

Le tracker les publie (Observer) ; l'adaptateur WebSocket de l'étape 3 les traduira en messages
`aqr.live/1`. Aucun texte ici : seulement des références, des rangs de mots et des temps. Le texte
affiché vient toujours du corpus (I1, I2).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from aqr.domain.models import Status, VerseRef


class HypothesisClass(StrEnum):
    """D'où vient l'a priori d'une hypothèse (ADR-0011 §2)."""

    START = "start"  # début de passage, sans contexte
    CONTINUE = "continue"  # la suite du verset verrouillé
    REPEAT = "repeat"  # le verset verrouillé, redit
    LOCAL = "local"  # un autre début de verset de la même sourate
    FAR = "far"  # n'importe quel autre endroit


@dataclass(frozen=True)
class CandidateItem:
    ref: VerseRef
    posterior: float
    hypothesis_class: HypothesisClass
    matched: int
    """Mots entendus qui correspondent à ce verset."""
    next_word: int | None
    """Rang (à partir de 1) du mot attendu ensuite ; None si le verset est entièrement dit."""


@dataclass(frozen=True)
class Candidates:
    """Niveau 1 : plusieurs versets restent plausibles, on écoute encore (transitoire)."""

    t: float
    start_s: float
    """Début (temps du flux) du premier mot du passage en cours."""
    words_heard: int
    count: int
    """Versets plausibles (posterior d'au moins `candidate_floor` fois celui du meilleur)."""
    items: tuple[CandidateItem, ...]
    leader: VerseRef | None
    leader_posterior: float
    shared_words: int
    """Mots entendus que tous les candidats plausibles expliquent par le même texte : le « passage
    entendu » affichable sans nommer de verset."""
    non_quran_posterior: float


@dataclass(frozen=True)
class Locked:
    """Niveau 3 : un verset est nommé. `identity_basis` dit si ce sont les mots ou la position."""

    t: float
    ref: VerseRef
    status: Status
    identity_basis: str  # "words" | "context"
    words_heard: int
    first_word: int
    posterior: float
    start_s: float
    repetition: bool


@dataclass(frozen=True)
class Continue:
    """Niveau 4 : le verset verrouillé est clos, la suite est attendue."""

    t: float
    ref: VerseRef
    status: Status
    identity_basis: str
    first_word: int
    last_word: int
    start_s: float
    end_s: float
    complete: bool
    """False si le passage s'arrête avant la fin du verset (cassure, fin du flux)."""
    expected: tuple[VerseRef, ...]


@dataclass(frozen=True)
class Unresolved:
    """Niveau 4 sans verrou : le passage est clos et reste ambigu (`UNCERTAIN` à la clôture)."""

    t: float
    candidates: tuple[VerseRef, ...]
    words_heard: int
    start_s: float
    end_s: float


@dataclass(frozen=True)
class Jump:
    """Le début casse l'attente de la suite."""

    t: float
    from_ref: VerseRef
    kind: str  # repeat | back | skip | other_surah


@dataclass(frozen=True)
class Lost:
    t: float
    reason: str  # silence | non_quran | no_candidate


@dataclass(frozen=True)
class BasmalaHeard:
    """Une basmala en tête de passage : début de sourate, ni verset ni identifiant."""

    t: float


@dataclass(frozen=True)
class Revision:
    """Un verrou déjà émis est retiré : il n'est jamais caché."""

    t: float
    ref: VerseRef
    reason: str  # contradicted


LiveEvent = Candidates | Locked | Continue | Unresolved | Jump | Lost | BasmalaHeard | Revision
