"""Candidat de vitesse de la cascade (ADR-0013) : estimer le débit, choisir le facteur (pur).

Une récitation nettement plus lente que la normale est mal entendue par le moteur principal
(`docs/evaluation/courbe-vitesse-2026-10-23.md`). Quand la première passe montre un débit bas,
les fenêtres douteuses sont réécoutées par le MÊME moteur sur l'audio accéléré d'un facteur choisi
dans une grille ; le candidat n'est jamais nommé que si l'audio d'ORIGINE soutient le texte du
corpus (arbitre de la cascade, I3).

Le débit est mesuré en lettres du corpus par seconde sur les versets que la première passe a
placés par alignement (jamais sur du texte d'ASR), puis divisé par le débit typique d'une
récitation normale (`SpeedConfig.typical_letters_per_s`, médiane de neuf sourates EveryAyah).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from aqr.domain.models import TimeSpan, WordSpan
from aqr.domain.ports import Candidate


@dataclass(frozen=True)
class SpeedConfig:
    enabled: bool = True
    activation_ratio: float = 0.75
    """Sous ce rapport (débit estimé / débit typique), la réécoute accélérée s'active."""
    compensations: tuple[float, ...] = (1.25, 1.5, 2.0, 2.5, 3.0, 4.0)
    """Facteurs d'accélération possibles ; le choisi est le plus proche de l'inverse du rapport."""
    typical_letters_per_s: float = 3.2
    """Débit d'une récitation normale (lettres du corpus par seconde de verset aligné) : médiane
    des 9 sourates propres de la campagne `courbe-vitesse-2026-10-23.md`. À recalibrer si le
    moteur d'alignement change."""
    min_words: int = 3
    """Un verset aligné de moins de mots ne compte pas dans l'estimation."""


def snap_compensation(ratio: float, activation_ratio: float, grid: Sequence[float]) -> float:
    """×1,0 si la récitation n'est pas nettement plus lente que la normale ; sinon la valeur de la
    grille la plus proche de 1/ratio (échelle logarithmique), bornée par la plus grande."""
    if ratio >= activation_ratio:
        return 1.0
    if ratio <= 0:
        return max(grid)
    target = 1.0 / ratio
    return min(grid, key=lambda g: (abs(math.log(target / g)), g))


def aggregate_rate(pairs: Sequence[tuple[float, float]]) -> float | None:
    """Débit = somme des poids / somme des durées (None sans intervalle)."""
    duration = sum(d for _w, d in pairs)
    return sum(w for w, _d in pairs) / duration if duration > 0 else None


def observed_rate(
    observations: Sequence[tuple[TimeSpan, list[Candidate]]],
    letters: Callable[[WordSpan], int],
    floor: float,
    min_words: int,
) -> float | None:
    """Lettres par seconde des versets que la première passe a nommés ET placés par alignement
    (`Candidate.times`). Un candidat sans temps mesuré ne compte pas : ses bords seraient ceux de
    la fenêtre, pas ceux de la voix."""
    pairs: list[tuple[float, float]] = []
    for _window, candidates in observations:
        if not candidates:
            continue
        best = max(candidates, key=lambda c: c.score)
        if best.score < floor or len(best.times) != len(best.spans):
            continue
        if sum(s.last_word - s.first_word + 1 for s in best.spans) < min_words:
            continue
        pairs.append((sum(letters(s) for s in best.spans), sum(t.duration_s for t in best.times)))
    return aggregate_rate(pairs)


@dataclass(frozen=True)
class SpeedPlan:
    """Ce que l'estimation a décidé : sert aux statistiques de la sortie."""

    rate_letters_per_s: float
    ratio: float
    factor: float
    """1,0 = pas de réécoute accélérée."""


def plan_speed(rate: float | None, config: SpeedConfig) -> SpeedPlan | None:
    """None si le débit est inconnu (aucun verset placé) : sans estimation, pas de compensation."""
    if rate is None or config.typical_letters_per_s <= 0:
        return None
    ratio = rate / config.typical_letters_per_s
    factor = snap_compensation(ratio, config.activation_ratio, config.compensations)
    return SpeedPlan(rate_letters_per_s=rate, ratio=ratio, factor=factor)
