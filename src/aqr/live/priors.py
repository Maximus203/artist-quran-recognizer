"""PriorPolicy : l'a priori d'un départ de passage selon le contexte (ADR-0011 §2, Strategy).

Trois politiques, testables chacune seule :
- `UniformPrior`    : début de flux, après une perte ou un passage resté ambigu sans piste ;
- `ContextPrior`    : après un verset clos (ou des candidats) : SUITE fort, SAUT LOCAL moyen,
                      SAUT LOINTAIN faible ;
- `AfterBasmalaPrior` : après une basmala : premiers versets des sourates seulement.

Une politique donne, pour chaque position du flux, une masse de probabilité (hors masse réservée à
« ce n'est pas du Coran », `non_quran_prior`) et la classe d'hypothèse correspondante.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Protocol

from aqr.domain.models import VerseRef
from aqr.live.config import LiveConfig
from aqr.live.events import HypothesisClass
from aqr.live.prefix_index import PrefixIndex


class PriorPolicy(Protocol):
    def prior(self, position: int) -> tuple[float, HypothesisClass]:
        """(masse de probabilité, classe) d'un passage qui démarre à `position` ; 0 = exclu."""
        ...


def _quran_mass(config: LiveConfig) -> float:
    return 1.0 - config.non_quran_prior


class UniformPrior:
    """Aucun contexte : les débuts de verset pèsent pareil, les milieux de verset en réserve."""

    def __init__(self, index: PrefixIndex, config: LiveConfig) -> None:
        total = _quran_mass(config)
        starts = max(1, len(index.verse_starts))
        mids = max(1, index.mid_verse_count)
        self._index = index
        self._start_mass = total * (1.0 - config.mid_verse_share) / starts
        self._mid_mass = total * config.mid_verse_share / mids

    def prior(self, position: int) -> tuple[float, HypothesisClass]:
        if self._index.is_basmala_position(position):
            return 0.0, HypothesisClass.START
        if self._index.is_verse_start(position):
            return self._start_mass, HypothesisClass.START
        return self._mid_mass, HypothesisClass.START


class ContextPrior:
    """Après des versets clos (`context` : verset -> poids, somme 1) : la suite est attendue."""

    def __init__(
        self,
        index: PrefixIndex,
        config: LiveConfig,
        context: Mapping[VerseRef, float],
    ) -> None:
        self._index = index
        total = _quran_mass(config)
        weight_sum = sum(context.values()) or 1.0
        self._continue: dict[int, float] = {}
        for verse, weight in context.items():
            following = index.next_start(verse)
            if following is not None:
                self._continue[following] = (
                    self._continue.get(following, 0.0) + total * config.prior * weight / weight_sum
                )
        rest = total - sum(self._continue.values())
        self._repeat = {index.start_of(verse) for verse in context}
        self._local: set[int] = set()
        for surah in {verse.surah for verse in context}:
            self._local.update(index.starts_of_surah(surah))
        self._local -= set(self._continue)
        local_total = rest * config.local_share if self._local else 0.0
        self._local_mass = local_total / len(self._local) if self._local else 0.0
        far_total = rest - local_total
        far_starts = max(1, len(index.verse_starts) - len(self._continue) - len(self._local))
        mids = max(1, index.mid_verse_count)
        self._far_start_mass = far_total * (1.0 - config.mid_verse_share) / far_starts
        self._far_mid_mass = far_total * config.mid_verse_share / mids

    def prior(self, position: int) -> tuple[float, HypothesisClass]:
        index = self._index
        if index.is_basmala_position(position):
            return 0.0, HypothesisClass.FAR
        if position in self._continue:
            return self._continue[position], HypothesisClass.CONTINUE
        if position in self._local:
            kind = HypothesisClass.REPEAT if position in self._repeat else HypothesisClass.LOCAL
            return self._local_mass, kind
        if index.is_verse_start(position):
            return self._far_start_mass, HypothesisClass.FAR
        return self._far_mid_mass, HypothesisClass.FAR


class AfterBasmalaPrior:
    """Après une basmala : premiers versets des sourates ; la sourate suivante est favorisée si le
    contexte finit une sourate."""

    def __init__(
        self,
        index: PrefixIndex,
        config: LiveConfig,
        context: Mapping[VerseRef, float],
    ) -> None:
        total = _quran_mass(config)
        allowed = index.after_basmala_starts
        weight_sum = sum(context.values()) or 1.0
        self._favoured: dict[int, float] = {}
        for verse, weight in context.items():
            following = verse.next()
            if following is None or following.ayah != 1:
                continue
            start = index.next_start(verse)
            if start is not None and start in allowed:
                self._favoured[start] = (
                    self._favoured.get(start, 0.0) + total * config.prior * weight / weight_sum
                )
        rest = total - sum(self._favoured.values())
        others = max(1, len(allowed) - len(self._favoured))
        self._other_mass = rest / others
        self._allowed = set(allowed)

    def prior(self, position: int) -> tuple[float, HypothesisClass]:
        if position not in self._allowed:
            return 0.0, HypothesisClass.START
        if position in self._favoured:
            return self._favoured[position], HypothesisClass.CONTINUE
        return self._other_mass, HypothesisClass.START
