"""Normalisation arabe pour la CORRESPONDANCE uniquement (B6).

Ne sert jamais au rendu : le texte rendu est le texte Mushaf brut du corpus (invariant I1).

Note : les différences d'orthographe Uthmani vs imla'i (ex. ٱلصَّلَوٰة / الصلاة) ne se
règlent pas caractère par caractère. Le matcher indexe donc le texte Tanzil
« simple-clean » (imla'i), tandis que le rendu utilise le texte Uthmani.
La correspondance entre les deux se fait par VerseRef et par index de mot.
"""

from __future__ import annotations

import re
import unicodedata

# Harakat, tanwin, shadda, sukun, madda de combinaison, etc.
_TASHKEEL = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭ]")
_TATWEEL = "ـ"
_CHAR_MAP = str.maketrans(
    {
        "أ": "ا",  # أ → ا
        "إ": "ا",  # إ → ا
        "آ": "ا",  # آ → ا
        "ٱ": "ا",  # ٱ (alef wasla) → ا
        "ى": "ي",  # ى → ي
        "ة": "ه",  # ة → ه
        "ؤ": "و",  # ؤ → و
        "ئ": "ي",  # ئ → ي
    }
)
# Tout ce qui n'est pas une lettre arabe de base ni un espace disparaît
# (ponctuation, chiffres, ۝, lettres latines…).
_NON_ARABIC = re.compile(r"[^ء-غف-ي\s]")
_SPACES = re.compile(r"\s+")


def normalize_arabic(text: str) -> str:
    """Renvoie une forme canonique comparable d'un texte arabe.

    Idempotente : normalize_arabic(normalize_arabic(x)) == normalize_arabic(x).
    """
    text = unicodedata.normalize("NFC", text)
    text = _TASHKEEL.sub("", text)
    text = text.replace(_TATWEEL, "")
    text = text.translate(_CHAR_MAP)
    text = _NON_ARABIC.sub(" ", text)
    return _SPACES.sub(" ", text).strip()


def tokenize(text: str) -> list[str]:
    normalized = normalize_arabic(text)
    return normalized.split(" ") if normalized else []
