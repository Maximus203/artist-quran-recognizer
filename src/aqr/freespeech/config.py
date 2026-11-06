"""Seuils de la parole libre, calibrés sur le banc (`scripts/bench_free_speech.py`).

Les défauts sont prudents : dans le doute on retient le passage, on ne l'affiche pas (I3).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FreeSpeechConfig:
    min_duration_s: float = 1.0
    """Passage plus court : ni transcrit ni traduit."""
    min_language_prob: float = 0.8
    """Probabilité minimale de la langue arabe annoncée par le transcripteur."""
    min_arabic_letters: float = 0.9
    """Part minimale de lettres arabes parmi les lettres de la transcription."""
    min_confidence: float = 0.55
    """Confiance minimale de la transcription, dans [0, 1]."""
    min_words: int = 2
    """Moins de mots : pas assez pour juger ni traduire."""
    guard_match_score: float = 0.4
    """Score du reconnaisseur de versets au-delà duquel la transcription ressemble à un verset."""
    guard_ngram_overlap: float = 0.3
    """Part des triplets de mots de la transcription déjà présents dans le Coran."""
    guard_run_words: int = 4
    """Suite de mots consécutifs identique à une suite du Coran : retenue dès cette longueur."""
    max_repeat_share: float = 0.5
    """Part maximale du mot le plus répété (une boucle d'hallucination du transcripteur)."""
    ratio_low: float = 0.25
    ratio_high: float = 3.0
    """Bornes du rapport (lettres françaises / lettres arabes) d'une traduction plausible."""
