"""Temps au mot d'un verset de la sortie `aqr.recognition/1` (ADR-0010).

Deux provenances, jamais mélangées, et déclarées dans la sortie :
- `ctc-alignment` : chaque mot a été placé par l'alignement forcé du texte du corpus sur le treillis
  CTC (ADR-0006, ADR-0008) ; le premier mot commence où commence l'intervalle, le dernier finit
  où il finit ;
- `interpolated` : seul le temps de l'intervalle est mesuré ; le temps de chaque mot en est une
  estimation proportionnelle à la longueur des mots du corpus, bornée à l'intervalle.
Dans les deux cas les mots sont ordonnés et ne se chevauchent pas (`without_overlap`) ; des temps
mesurés qui se chevauchent trop ne sont pas publiés comme mesurés.
Ni l'un ni l'autre n'est publié pour un verset `uncertain` (il n'est pas nommé) ou `inferred` (il
n'a jamais été entendu) : un faux temps vaut moins que pas de temps.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final

from aqr.domain.models import TimeSpan
from aqr.domain.word_timing import MAX_REPAIRED_OVERLAP_S, without_overlap

__all__ = [
    "CTC_ALIGNMENT",
    "INTERPOLATED",
    "MAX_REPAIRED_OVERLAP_S",
    "SOURCES",
    "interpolate",
    "without_overlap",
]

CTC_ALIGNMENT: Final = "ctc-alignment"
INTERPOLATED: Final = "interpolated"
SOURCES: Final = (CTC_ALIGNMENT, INTERPOLATED)


def interpolate(weights: Sequence[int], span: TimeSpan) -> list[TimeSpan]:
    """Découpe `span` en autant de mots contigus que de poids, au prorata de ces poids (la longueur
    de chaque mot en lettres). Le premier mot commence à `span.start_s`, le dernier finit à
    `span.end_s` exactement, sans trou ni chevauchement."""
    if not weights or any(w < 1 for w in weights):
        raise ValueError("chaque mot pèse au moins une lettre")
    total = sum(weights)
    out: list[TimeSpan] = []
    cursor, passed = span.start_s, 0
    for index, weight in enumerate(weights):
        passed += weight
        end = (
            span.end_s
            if index == len(weights) - 1
            else span.start_s + span.duration_s * passed / total
        )
        out.append(TimeSpan(cursor, end))
        cursor = end
    return out
