"""Ports de la parole libre : transcripteur arabe et traducteur arabe → français (ADR-0027)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from aqr.domain.models import TimeSpan
from aqr.domain.ports import AudioClip


@dataclass(frozen=True)
class SpeechTranscript:
    text: str
    language: str
    language_prob: float
    confidence: float
    """Confiance de la transcription, dans [0, 1]."""
    engine: str


@dataclass(frozen=True)
class FrenchText:
    text: str
    engine: str


class SpeechTranscriber(Protocol):
    def transcribe(self, clip: AudioClip, span: TimeSpan) -> SpeechTranscript: ...


class FrenchTranslator(Protocol):
    def translate(self, arabic: str) -> FrenchText: ...


class BackTranslator(Protocol):
    """Traduit le français obtenu vers l'arabe : sert à contrôler la traduction (aller-retour)."""

    def translate_back(self, french: str) -> str: ...
