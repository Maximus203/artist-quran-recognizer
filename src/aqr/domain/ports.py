"""Ports (interfaces) de chaque brique. Implémentations dans aqr.adapters.

Chaque port a un test de contrat dans tests/contract/ que toute implémentation doit passer.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from aqr.domain.models import Detection, Riwaya, Timeline, TimeSpan, VerseRef, WordSpan


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
    """Position du Coran qui explique une requête (ADR-0004).

    `span` est le premier verset touché ; `continuation` porte les versets suivants
    quand la requête traverse plusieurs versets (ex. 112:1-2 d'un souffle). Seul le
    premier et le dernier span peuvent être partiels : ceux du milieu sont entiers.
    """

    span: WordSpan
    score: float  # [0, 1]
    continuation: tuple[WordSpan, ...] = ()
    query_counts: tuple[int, ...] = ()
    """Mots de la requête expliqués par chaque span (même ordre que `spans`), pour
    répartir le temps d'un segment entre les versets qu'il traverse."""
    coverage: float = 1.0
    """Part de la requête expliquée par l'alignement, avant pondération par la preuve."""
    quality: float | None = None
    """Ressemblance de la correspondance, AVANT le plafond de preuve (`score` = qualité ×
    min(1, mots expliqués / evidence_words)). None = inconnue : jamais promue par la suite."""
    explained: float = 0.0
    """Mots de la requête expliqués (similarités cumulées) : la preuve qu'apporte ce candidat."""
    times: tuple[TimeSpan, ...] = ()
    """Temps MESURÉS de chaque span (même ordre que `spans`) par alignement forcé du texte du
    corpus (ADR-0008) ; vide = inconnus, le décodeur prend les bords de la fenêtre."""

    @property
    def spans(self) -> tuple[WordSpan, ...]:
        return (self.span, *self.continuation)

    @property
    def refs(self) -> tuple[VerseRef, ...]:
        return tuple(s.ref for s in self.spans)


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


@dataclass(frozen=True)
class CtcLattice:
    """Treillis CTC d'un passage : log-probabilités normalisées par trame (ADR-0005, ADR-0006)."""

    log_probs: Sequence[Sequence[float]]
    """[trame][symbole] ; chaque ligne est une distribution (log-softmax)."""
    blank: int
    start_s: float
    """Temps absolu (dans le clip) du début de la première trame."""
    frame_s: float
    """Durée d'une trame (80 ms pour le FastConformer)."""
    frame_rms: Sequence[float] | None = None
    """Énergie (RMS) du signal sur chaque trame, si l'adapter la fournit : un CTC émet ses
    symboles tôt et laisse un son tenu aux blancs, que seule l'énergie distingue du silence."""

    @property
    def frames(self) -> int:
        return len(self.log_probs)

    def time_of(self, frame: int) -> float:
        """Temps absolu du début de la trame `frame` (`frames` = fin du passage)."""
        return self.start_s + frame * self.frame_s


class CtcAcousticModel(Protocol):
    """Modèle acoustique CTC : treillis d'un passage et encodeur de texte dans ses symboles.

    Sert à l'alignement forcé du texte du CORPUS (jamais d'un texte d'ASR) sur l'audio."""

    @property
    def engine(self) -> str: ...

    def lattice(self, clip: AudioClip, span: TimeSpan) -> CtcLattice: ...

    def encode(self, text: str) -> tuple[int, ...]: ...

    @property
    def unknown_symbol(self) -> int | None:
        """Symbole que rend `encode` pour une lettre inconnue du modèle, qui ne l'émet jamais ;
        None s'il n'en a pas. L'aligneur ne l'exige pas (`emittable_encoder`)."""
        ...


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


# --- B9 -------------------------------------------------------------------
@dataclass(frozen=True)
class BatchOptions:
    batch_size: int | None = None
    """Nombre de versets par lot (F8 : `--batch-size N`). None = un seul lot."""


@dataclass(frozen=True)
class RenderedBatch:
    index: int
    detections: tuple[Detection, ...]
    json: dict[str, object]
    srt: str
    vtt: str


class Renderer(Protocol):
    def render(
        self, timeline: Timeline, translation_id: str, options: BatchOptions
    ) -> list[RenderedBatch]: ...
