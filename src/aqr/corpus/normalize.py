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

`normalize_strict_letters` est la variante `strict-lettres` de la notation (WER/CER,
docs/evaluation/normalisation.md §3) : mêmes étapes que `normalize_arabic` (NFC, signes,
tatweel, caractères non arabes, espaces) mais AUCUN repli de lettres, sauf `ٱ -> ا` (l'alef wasla
est un signe de liaison, pas une lettre distincte). C'est une fonction distincte, jamais un
drapeau de `normalize_arabic`, dont le contrat reste inchangé.
"""

from __future__ import annotations

import re
import unicodedata

# Version de la normalisation : à incrémenter dès que `normalize_arabic` change de comportement
# (elle est écrite dans les rapports d'évaluation pour refuser de comparer deux versions).
NORMALIZATION_VERSION = "aqr.normalize/1"
# Idem pour `normalize_strict_letters` (et la façon dont elle est notée) : écrite dans les rapports
# et dans l'empreinte de normalisation, de sorte qu'une base d'avant ce changement soit refusée.
STRICT_NORMALIZATION_VERSION = "aqr.normalize-strict/1"

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
# Seul repli permis en `strict-lettres` : l'alef wasla (U+0671, hors des plages conservées) devient
# un alef. Appliqué avant le filtre des caractères non arabes, comme dans `_CHAR_MAP`.
_STRICT_CHAR_MAP = str.maketrans({"ٱ": "ا"})  # ٱ → ا
# Tout ce qui n'est pas une lettre arabe de base ni un espace disparaît
# (ponctuation, chiffres, ۝, lettres latines…).
_NON_ARABIC = re.compile(r"[^ء-غف-ي\s]")
_SPACES = re.compile(r"\s+")


def _normalize(text: str, char_map: dict[int, str]) -> str:
    """NFC, signes, tatweel, repli de lettres par `char_map`, non arabe -> espace, espaces.

    NFC AVANT la suppression des signes : `ا` + U+0654 (hamza combinant) se compose en `أ`, qui est
    alors une lettre (repliée ou non selon `char_map`), et non un `ا` nu.
    """
    text = unicodedata.normalize("NFC", text)
    text = _TASHKEEL.sub("", text)
    text = text.replace(_TATWEEL, "")
    text = text.translate(char_map)
    text = _NON_ARABIC.sub(" ", text)
    return _SPACES.sub(" ", text).strip()


def _tokens(normalized: str) -> list[str]:
    return normalized.split(" ") if normalized else []


def normalize_arabic(text: str) -> str:
    """Renvoie une forme canonique comparable d'un texte arabe.

    Idempotente : normalize_arabic(normalize_arabic(x)) == normalize_arabic(x).
    """
    return _normalize(text, _CHAR_MAP)


def tokenize(text: str) -> list[str]:
    return _tokens(normalize_arabic(text))


def normalize_strict_letters(text: str) -> str:
    """Variante `strict-lettres` : `normalize_arabic` sans aucun repli de lettres, sauf `ٱ -> ا`.

    `أ إ آ ة ى ؤ ئ ء` sont conservés tels quels (après NFC) ; aucune correction imla'i.
    Idempotente. N'alimente jamais le rendu ni la correspondance : sert à mesurer ce que la
    tolérance de `normalize_arabic` cache.
    """
    return _normalize(text, _STRICT_CHAR_MAP)


def tokenize_strict_letters(text: str) -> list[str]:
    return _tokens(normalize_strict_letters(text))
