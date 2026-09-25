"""Normalisation arabe pour la CORRESPONDANCE uniquement (B6).

Ne sert jamais au rendu : le texte rendu est le texte Mushaf brut du corpus (invariant I1).

`normalize_arabic` seul ne suffit pas à faire coïncider Uthmani et imla'i (le format
produit par un ASR) : mesuré le 2026-09-25 sur le corpus épinglé, 61,6 % des versets
ont au moins un mot dont la forme imla'i normalisée est absente du vocabulaire
Uthmani (~9,3 % des mots). Une règle de caractères générique (ex. « alef supérieur ->
alef plein ») a été essayée et rejetée : elle casse des mots à graphie courte
retenue aussi en imla'i (« الرحمن », jamais « الرحمان », y compris dans la
basmala). La correction se fait donc par dictionnaire, appris depuis le corpus
lui-même (`aqr.corpus.imlai_corrections`, ADR-0003) — jamais par règle générique.
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
