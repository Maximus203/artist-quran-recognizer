"""Mots normalisés pour l'ALIGNEMENT uniquement (jamais pour le rendu : I1, I2).

Côté arabe : radical léger (conjonction, article, pronom suffixe) pour que les formes d'un même
mot partagent leurs statistiques. Côté français : minuscules, sans accents, tronqué. Ces clés ne
servent qu'à estimer quelle proposition française correspond à quels mots arabes.
"""

from __future__ import annotations

import re
import unicodedata

from aqr.corpus.normalize import normalize_arabic
from aqr.translation_align.config import TranslationAlignmentConfig

_PRONOUN_SUFFIXES = ("هما", "كما", "هم", "هن", "ها", "كم", "كن", "نا", "ني", "ه", "ك", "ي")
_PLURAL_SUFFIXES = ("ون", "ين", "ان", "ات", "وا", "تم")
_ALLAH = "الله"

_BRACKET = re.compile(r"\[[^\[\]]*\]")  # marques de note [1] et ajouts du traducteur [en songe]
_PAREN = re.compile(r"\([^()]*\)")
_WORD = re.compile(r"[a-z]+")

# Signes de pause du Mushaf (U+06D6..U+06DC). U+06D9 « لا » : ne pas s'arrêter ici.
_WAQF_STOP = frozenset("ۖۗۘۚۛۜ")
_WAQF_DONT_STOP = "ۙ"


def arabic_stem(word: str, stemming: bool = True) -> str:
    """Radical léger d'un mot arabe : sans signes, conjonction و/ف, article ال, pronom suffixe.
    `stemming=False` : le mot normalisé seulement."""
    stem = normalize_arabic(word)
    if not stemming or stem == _ALLAH:
        return stem
    if len(stem) >= 5 and stem[0] in "وف":
        stem = stem[1:]
    if len(stem) >= 5 and stem.startswith("ال"):
        stem = stem[2:]
    elif len(stem) >= 6 and stem[0] in "بل":
        stem = stem[1:]
    if stem == _ALLAH:
        return stem
    for suffix in _PRONOUN_SUFFIXES:
        if stem.endswith(suffix) and len(stem) - len(suffix) >= 2:
            return stem[: -len(suffix)]
    for suffix in _PLURAL_SUFFIXES:
        if stem.endswith(suffix) and len(stem) - len(suffix) >= 3:
            return stem[: -len(suffix)]
    return stem


def _fold(text: str) -> str:
    text = text.lower().replace("œ", "oe").replace("æ", "ae")
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def _scored_text(text: str, config: TranslationAlignmentConfig) -> str:
    """Le texte qui compte pour l'alignement : sans marques de note `[1]`, et sans les ajouts du
    traducteur entre parenthèses ou crochets (ils n'ont pas de mot arabe) quand la configuration
    le demande."""
    text = _BRACKET.sub(" ", text) if config.skip_parenthetical else re.sub(r"\[\d+\]", " ", text)
    if config.skip_parenthetical:
        previous = None
        while previous != text:  # parenthèses imbriquées : de l'intérieur vers l'extérieur
            previous = text
            text = _PAREN.sub(" ", text)
    return text


def french_letter_count(text: str, config: TranslationAlignmentConfig) -> int:
    """Nombre de lettres du texte qui compte (mesure de longueur d'une proposition)."""
    return sum(len(w) for w in _WORD.findall(_fold(_scored_text(text, config))))


def arabic_letter_count(word: str) -> int:
    """Nombre de lettres (sans signes) d'un mot arabe."""
    return len(normalize_arabic(word).replace(" ", ""))


def french_tokens(text: str, config: TranslationAlignmentConfig) -> list[str]:
    """Mots porteurs de sens d'une proposition française, normalisés pour l'alignement."""
    tokens: list[str] = []
    for raw in _WORD.findall(_fold(_scored_text(text, config))):
        if len(raw) < config.min_token_len:
            continue
        if len(raw) > 4 and raw[-1] in "sx":
            raw = raw[:-1]
        tokens.append(raw[: config.fr_stem_len])
    return tokens


def waqf_flags(verse_text: str) -> list[int]:
    """Pour chaque mot du verset (même définition que `CorpusRepository.words`), +1 si un signe de
    pause qui autorise l'arrêt le suit, -1 s'il porte « لا » (ne pas s'arrêter), 0 sinon."""
    flags: list[int] = []
    for token in verse_text.split():
        sign = 0
        if any(c in _WAQF_STOP for c in token):
            sign = 1
        elif _WAQF_DONT_STOP in token:
            sign = -1
        if normalize_arabic(token):
            flags.append(sign)  # un mot, avec éventuellement le signe collé à lui
        elif sign and flags:
            flags[-1] = sign  # signe isolé : il suit le mot précédent
    return flags
