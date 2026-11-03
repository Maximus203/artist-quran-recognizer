"""Modèle lexical IBM-1 (avec mot nul), appris sur les paires (verset arabe, verset français).

Déterministe (EM sans aléa, initialisation uniforme), non génératif : il ne produit aucun texte,
il estime seulement P(mot cible | mot source). Entraîné dans les deux sens (arabe -> français,
français -> arabe) sur les 6 236 versets : les deux lectures indépendantes d'un même alignement.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass

NULL: int = -1
"""Identifiant du mot nul côté source (mots de liaison sans équivalent)."""


@dataclass(frozen=True)
class LexicalModel:
    table: dict[int, dict[int, float]]
    """source -> {cible: P(cible | source)} ; la source `NULL` est le mot nul."""
    floor: float

    def prob(self, source: int, target: int) -> float:
        row = self.table.get(source)
        if row is None:
            return self.floor
        return max(row.get(target, 0.0), self.floor)


@dataclass(frozen=True)
class BoundaryPrior:
    """Où une proposition s'arrête ou commence, côté arabe : un mot de liaison (في، من، و…) ne
    termine presque jamais une proposition, « قال » ou « و » en ouvrent souvent une. Appris des
    fins de verset et des signes de pause du Coran (de vraies fins de proposition arabe)."""

    end: dict[int, float]
    """radical -> log(P(frontière après lui) / taux moyen), borné."""
    start: dict[int, float]
    """radical -> log(P(frontière avant lui) / taux moyen), borné."""

    def score(self, stems: Sequence[int], boundary: int) -> float:
        """Prior de la frontière après le mot `boundary` (1..N-1)."""
        return self.end.get(stems[boundary - 1], 0.0) + self.start.get(stems[boundary], 0.0)


def fit_boundary_prior(
    verses: Sequence[tuple[Sequence[int], Sequence[int]]],
    smoothing: float,
    cap: float,
    verse_ends: bool = True,
) -> BoundaryPrior:
    """`verses` : (radicaux, drapeaux de pause). Frontières observées : après un signe de pause qui
    autorise l'arrêt (+1) et, si `verse_ends`, aux fins et débuts de verset."""
    total: dict[int, int] = defaultdict(int)
    before: dict[int, int] = defaultdict(int)
    after: dict[int, int] = defaultdict(int)
    words = ends = 0
    for stems, flags in verses:
        for i, stem in enumerate(stems):
            total[stem] += 1
            words += 1
            if (verse_ends and i == len(stems) - 1) or flags[i] > 0:
                before[stem] += 1  # une frontière suit ce mot
                ends += 1
                if i + 1 < len(stems):
                    after[stems[i + 1]] += 1
        if verse_ends:
            after[stems[0]] += 1  # le verset commence
    if not ends:  # aucun signe de pause appris : pas de prior
        return BoundaryPrior(end={}, start={})
    rate = ends / words

    def table(counts: dict[int, int]) -> dict[int, float]:
        out: dict[int, float] = {}
        for stem, n in total.items():
            share = (counts.get(stem, 0) + smoothing * rate) / (n + smoothing)
            out[stem] = max(-cap, min(cap, math.log(share / rate)))
        return out

    return BoundaryPrior(end=table(before), start=table(after))


@dataclass(frozen=True)
class AlignmentModels:
    """Ce que l'on apprend sur le Coran entier pour placer les frontières."""

    forward: LexicalModel
    """P(mot français | mot arabe)."""
    reverse: LexicalModel
    """P(mot arabe | mot français)."""
    length_ratio: float
    """Lettres françaises par lettre arabe (Gale et Church)."""
    length_variance: float
    """Variance de l'écart de longueur, par lettre arabe."""
    prior: BoundaryPrior


def fit_length(pairs: Sequence[tuple[int, int]], variance_floor: float) -> tuple[float, float]:
    """(rapport, variance par lettre arabe) depuis des paires (lettres arabes, lettres françaises).
    La variance ne descend pas sous `variance_floor` (corpus trop régulier ou trop petit)."""
    arabic = sum(a for a, _f in pairs)
    ratio = sum(f for _a, f in pairs) / arabic
    variance = sum((f - ratio * a) ** 2 for a, f in pairs) / arabic
    return ratio, max(variance, variance_floor)


class Vocabulary:
    """Identifiants entiers stables (ordre de première apparition)."""

    def __init__(self) -> None:
        self._ids: dict[str, int] = {}

    def id(self, token: str) -> int:
        return self._ids.setdefault(token, len(self._ids))

    def __len__(self) -> int:
        return len(self._ids)


def train_ibm1(
    pairs: Sequence[tuple[Sequence[int], Sequence[int]]], iterations: int, floor: float
) -> LexicalModel:
    """EM de l'IBM-1 : `pairs` = [(mots source, mots cible)] ; le mot nul s'ajoute aux sources."""
    table: dict[int, dict[int, float]] = {}
    for iteration in range(iterations):
        counts: dict[int, dict[int, float]] = defaultdict(lambda: defaultdict(float))
        totals: dict[int, float] = defaultdict(float)
        for source, target in pairs:
            sources = [NULL, *source]
            for t in target:
                if iteration == 0:
                    weights = [1.0] * len(sources)
                else:
                    weights = [table[s].get(t, 0.0) for s in sources]
                norm = sum(weights)
                if norm <= 0.0:
                    continue
                for s, w in zip(sources, weights, strict=True):
                    share = w / norm
                    counts[s][t] += share
                    totals[s] += share
        table = {
            s: {t: c / totals[s] for t, c in row.items()} for s, row in counts.items() if totals[s]
        }
    return LexicalModel(table=table, floor=floor)
