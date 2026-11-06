"""Contrôles purs d'une transcription : écriture, répétition, plausibilité de la traduction."""

from __future__ import annotations

from collections import Counter
from difflib import SequenceMatcher

from aqr.corpus.normalize import normalize_arabic, tokenize

_ARABIC_LETTER = range(0x0621, 0x064B)
_ARABIC_EXTRA = frozenset("ٱپچژڤگکی")


def _is_arabic_letter(ch: str) -> bool:
    return ord(ch) in _ARABIC_LETTER or ch in _ARABIC_EXTRA


def arabic_letter_share(text: str) -> float:
    """Part des lettres arabes parmi toutes les lettres ; 0 sans lettre."""
    letters = [ch for ch in text if ch.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for ch in letters if _is_arabic_letter(ch)) / len(letters)


def words_of(text: str) -> list[str]:
    return tokenize(text)


def repeat_share(words: list[str]) -> float:
    """Part du mot le plus fréquent (boucle d'hallucination : un mot répété sans fin)."""
    if len(words) < 4:
        return 0.0
    return Counter(words).most_common(1)[0][1] / len(words)


def roundtrip_similarity(original: str, back: str) -> float:
    """Ressemblance, dans [0, 1], de l'arabe d'origine et de l'arabe obtenu par aller-retour.

    Rapport de séquence sur les lettres de l'arabe normalisé (`normalize_arabic`) : tolère un
    synonyme ou une particule, pas un passage qui a changé de sens."""
    a = "".join(words_of(normalize_arabic(original)))
    b = "".join(words_of(normalize_arabic(back)))
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def letter_count(text: str) -> int:
    return sum(1 for ch in text if ch.isalpha())


def plausible_length(arabic: str, french: str, low: float, high: float) -> bool:
    """Une traduction vide, ou sans rapport de taille avec l'arabe, est rejetée."""
    a, f = letter_count(arabic), letter_count(french)
    if a == 0 or f == 0:
        return False
    return low <= f / a <= high
