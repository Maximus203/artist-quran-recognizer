"""Ports (interfaces) de chaque brique. Implémentations dans aqr.adapters.

Chaque port a un test de contrat dans tests/contract/ que toute implémentation doit passer.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from aqr.domain.models import Riwaya, Timeline, TimeSpan, VerseRef, WordSpan


@dataclass(frozen=True)
class AudioClip:
    samples: Sequence[float]  # PCM mono normalisé [-1, 1]
    sample_rate: int  # 16000 attendu
    source: str


@dataclass(frozen=True)
class TranscribedWord:
    text: str
    time: TimeSpan
    confidence: float


@dataclass(frozen=True)
class Transcript:
    words: tuple[TranscribedWord, ...]
    engine: str  # nom + version du modèle


@dataclass(frozen=True)
class Candidate:
    span: WordSpan
    score: float  # [0, 1]


# --- B1 -----------------------------------------------------------------
class AudioExtractor(Protocol):
    def extract(self, path: Path) -> AudioClip: ...


# --- B2 -----------------------------------------------------------------
class SpeechSegmenter(Protocol):
    def segment(self, clip: AudioClip) -> list[TimeSpan]: ...


# --- B3 -----------------------------------------------------------------
class LanguageGate(Protocol):
    def detect(self, clip: AudioClip, span: TimeSpan) -> tuple[str, float]: ...


# --- B4 -----------------------------------------------------------------
class QuranASR(Protocol):
    riwaya: Riwaya

    def transcribe(self, clip: AudioClip, span: TimeSpan) -> Transcript: ...


class GeneralASR(Protocol):
    """ASR généraliste (Whisper large-v3) utilisé par le QuranicityGate (ADR-0002)."""

    def transcribe(self, clip: AudioClip, span: TimeSpan) -> Transcript: ...


# --- B5 -----------------------------------------------------------------
class QuranicityGate(Protocol):
    def score(
        self, quran_transcript: Transcript, general_transcript: Transcript | None
    ) -> float: ...


# --- B6 -----------------------------------------------------------------
class VerseMatcher(Protocol):
    def match(self, normalized_text: str, top_k: int = 5) -> list[Candidate]: ...


# --- B7 -----------------------------------------------------------------
class SequenceDecoder(Protocol):
    def decode(self, observations: Sequence[tuple[TimeSpan, list[Candidate]]]) -> Timeline: ...


# --- Données de référence ------------------------------------------------
class CorpusRepository(Protocol):
    riwaya: Riwaya
    version: str

    def text(self, ref: VerseRef) -> str: ...  # texte Mushaf exact (I1)
    def words(self, ref: VerseRef) -> tuple[str, ...]: ...
    def all_refs(self) -> Sequence[VerseRef]: ...


@dataclass(frozen=True)
class Translation:
    ref: VerseRef
    text: str
    translation_id: str  # ex. "french_hameedullah"
    version: str
    attribution: str  # ex. "QuranEnc.com — Muhammad Hamidullah (rév. Complexe du Roi Fahd)"


class TranslationRepository(Protocol):
    def get(self, ref: VerseRef, translation_id: str) -> Translation: ...
