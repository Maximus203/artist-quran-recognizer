"""Formules de la prière et basmala : étiquetées `NON_QURAN` (I4), jamais rendues comme versets.

Ce lexique sert à RECONNAÎTRE (comparaison de mots normalisés), il n'est jamais affiché : aucun
texte rendu ne vient d'ici (I1). La basmala vient du corpus (1:1). Le verset 16:98 (« فإذا قرأت
القرآن فاستعذ… ») n'est pas l'isti'adha : il contient d'autres mots et reste un verset.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from aqr.domain.models import NonQuranKind
from aqr.matching.similarity import word_similarity

# Formes normalisées (`normalize_arabic`) : hamzas et alef unifiés.
_FORMULAE: tuple[tuple[NonQuranKind, tuple[str, ...]], ...] = (
    (NonQuranKind.ISTIADHA, ("اعوذ", "بالله", "من", "الشيطان", "الرجيم")),
    (NonQuranKind.TAKBIR, ("الله", "اكبر")),
    (NonQuranKind.AMIN, ("امين",)),
)


@dataclass(frozen=True)
class FormulaConfig:
    word_threshold: float = 0.7
    """Similarité minimale de chaque mot de la formule (une lettre d'écart sur un mot long)."""
    extra_words_allowed: int = 0
    """Mots en plus tolérés autour de la formule ; 0 = le segment est la formule, rien d'autre."""


def _matches(tokens: Sequence[str], formula: Sequence[str], config: FormulaConfig) -> bool:
    """Mots de la formule dans l'ordre, avec au plus `extra_words_allowed` mots en plus."""
    if not tokens or not len(formula) <= len(tokens) <= len(formula) + config.extra_words_allowed:
        return False
    skipped = position = 0
    for word in formula:
        while position < len(tokens) and not word_similarity(
            tokens[position], word, config.word_threshold
        ):
            position += 1
            skipped += 1
        if position == len(tokens) or skipped > config.extra_words_allowed:
            return False
        position += 1
    return skipped + len(tokens) - position <= config.extra_words_allowed


def classify_formula(
    tokens: Sequence[str], basmala: Sequence[str], config: FormulaConfig
) -> NonQuranKind | None:
    """La formule dont le segment est (à peu près) la totalité, sinon None."""
    for kind, formula in (*_FORMULAE, (NonQuranKind.BASMALA, tuple(basmala))):
        if _matches(tokens, formula, config):
            return kind
    return None
