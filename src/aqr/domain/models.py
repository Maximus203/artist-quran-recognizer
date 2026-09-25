"""Modèles du domaine. Aucune dépendance externe (cf. docs/ARCHITECTURE.md §5)."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from aqr.domain.quran_structure import SURAH_COUNT, ayah_count


class Riwaya(StrEnum):
    HAFS = "hafs"
    WARSH = "warsh"  # V1.1


class Status(StrEnum):
    """Statut de preuve d'une détection (invariant I5)."""

    RECOGNIZED = "recognized"  # entendu et aligné
    INFERRED = "inferred"  # déduit d'un trou entre deux versets reconnus
    UNCERTAIN = "uncertain"  # ambigu : plusieurs candidats plausibles


class NonQuranKind(StrEnum):
    """Tout ce qui n'est pas un verset (invariant I4)."""

    SILENCE = "silence"
    NOISE = "noise"
    FRENCH = "french"
    OTHER_LANGUAGE = "other_language"
    ARABIC_SPEECH = "arabic_speech"  # hadith, dou'a, khutba, arabe courant
    ISTIADHA = "istiadha"
    BASMALA = "basmala"  # hors Al-Fatiha 1:1
    TAKBIR = "takbir"
    AMIN = "amin"


@dataclass(frozen=True, order=True)
class VerseRef:
    surah: int
    ayah: int

    def __post_init__(self) -> None:
        if not 1 <= self.surah <= SURAH_COUNT:
            raise ValueError(f"sourate invalide : {self.surah}")
        if not 1 <= self.ayah <= ayah_count(self.surah):
            raise ValueError(f"verset invalide : {self.surah}:{self.ayah}")

    @classmethod
    def parse(cls, s: str) -> VerseRef:
        surah, ayah = s.split(":")
        return cls(int(surah), int(ayah))

    def next(self) -> VerseRef | None:
        """Verset suivant dans l'ordre du Mushaf, None après 114:6."""
        if self.ayah < ayah_count(self.surah):
            return VerseRef(self.surah, self.ayah + 1)
        if self.surah < SURAH_COUNT:
            return VerseRef(self.surah + 1, 1)
        return None

    def __str__(self) -> str:
        return f"{self.surah}:{self.ayah}"


@dataclass(frozen=True)
class TimeSpan:
    start_s: float
    end_s: float

    def __post_init__(self) -> None:
        if self.start_s < 0:
            raise ValueError("start_s négatif")
        if self.end_s <= self.start_s:
            raise ValueError(f"intervalle vide ou inversé : {self.start_s} → {self.end_s}")

    @property
    def duration_s(self) -> float:
        return self.end_s - self.start_s


@dataclass(frozen=True)
class WordSpan:
    """Plage de mots (index à partir de 1, bornes incluses) dans un verset.

    Le nombre total de mots est vérifié par le CorpusRepository, pas ici.
    """

    ref: VerseRef
    first_word: int
    last_word: int

    def __post_init__(self) -> None:
        if self.first_word < 1 or self.last_word < self.first_word:
            raise ValueError(f"plage de mots invalide : {self.first_word}..{self.last_word}")


@dataclass(frozen=True)
class Detection:
    span: WordSpan
    time: TimeSpan | None
    status: Status
    confidence: float
    time_interpolated: bool = False
    candidates: tuple[VerseRef, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("confidence doit être dans [0, 1]")
        if self.status is Status.RECOGNIZED and self.time is None:
            raise ValueError("une détection RECOGNIZED doit avoir un horodatage mesuré")
        if self.status is Status.RECOGNIZED and self.time_interpolated:
            raise ValueError("une détection RECOGNIZED ne peut pas avoir un temps interpolé")
        if self.status is Status.UNCERTAIN and len(self.candidates) < 2:
            raise ValueError("une détection UNCERTAIN doit lister au moins 2 candidats")


@dataclass(frozen=True)
class NonQuranSpan:
    time: TimeSpan
    kind: NonQuranKind


TimelineItem = Detection | NonQuranSpan


@dataclass(frozen=True)
class Timeline:
    items: tuple[TimelineItem, ...]
    riwaya: Riwaya
    engine_version: str

    def detections(self) -> tuple[Detection, ...]:
        return tuple(i for i in self.items if isinstance(i, Detection))

    def verses(self, *statuses: Status) -> tuple[VerseRef, ...]:
        wanted = set(statuses) or set(Status)
        return tuple(d.span.ref for d in self.detections() if d.status in wanted)
