"""Candidat de vitesse (`aqr.pipeline.speed`) : débit observé, facteur choisi. Logique pure."""

from __future__ import annotations

import pytest

from aqr.domain.models import TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import Candidate
from aqr.eval.speed_curve import SPEED_RULE
from aqr.pipeline.speed import (
    SpeedConfig,
    aggregate_rate,
    observed_rate,
    plan_speed,
    snap_compensation,
)

GRID = SpeedConfig().compensations


def span(ref: str, first: int, last: int) -> WordSpan:
    return WordSpan(VerseRef.parse(ref), first, last)


def candidate(
    score: float, spans: list[WordSpan], times: list[tuple[float, float]] | None
) -> Candidate:
    return Candidate(
        span=spans[0],
        continuation=tuple(spans[1:]),
        score=score,
        times=tuple(TimeSpan(a, b) for a, b in times or []),
    )


def letters(s: WordSpan) -> int:
    return 5 * (s.last_word - s.first_word + 1)  # 5 lettres par mot : un corpus factice


def window(a: float = 0.0, b: float = 10.0) -> TimeSpan:
    return TimeSpan(a, b)


def test_la_configuration_par_defaut_est_celle_de_la_regle_mesuree() -> None:
    config = SpeedConfig()
    assert config.activation_ratio == SPEED_RULE.activation_ratio
    assert config.compensations == SPEED_RULE.compensations
    assert config.min_words == SPEED_RULE.min_words_per_interval
    assert config.enabled


def test_pas_de_compensation_pour_une_recitation_normale_ou_rapide() -> None:
    assert snap_compensation(1.0, 0.75, GRID) == 1.0
    assert snap_compensation(0.75, 0.75, GRID) == 1.0
    assert snap_compensation(3.0, 0.75, GRID) == 1.0


def test_le_facteur_suit_l_inverse_du_rapport_sur_une_echelle_logarithmique() -> None:
    assert snap_compensation(0.5, 0.75, GRID) == 2.0
    assert snap_compensation(0.4, 0.75, GRID) == 2.5
    assert snap_compensation(0.55, 0.75, GRID) == 2.0  # 1/0,55 = 1,82
    assert snap_compensation(0.7, 0.75, GRID) == 1.5  # 1/0,7 = 1,43


def test_le_facteur_est_borne_par_la_grille() -> None:
    assert snap_compensation(0.05, 0.75, GRID) == 4.0
    assert snap_compensation(0.0, 0.75, GRID) == 4.0
    assert snap_compensation(0.3, 0.75, (1.25, 1.5)) == 1.5


def test_debit_agrege() -> None:
    assert aggregate_rate([(10, 2.0), (20, 3.0)]) == pytest.approx(6.0)
    assert aggregate_rate([]) is None
    assert aggregate_rate([(5, 0.0)]) is None


def test_le_debit_observe_ne_compte_que_les_versets_nommes_et_places() -> None:
    kept = candidate(0.9, [span("67:1", 1, 5)], [(0.0, 5.0)])  # 25 lettres / 5 s
    observations = [
        (window(), [kept]),
        (window(), [candidate(0.4, [span("67:2", 1, 8)], [(0.0, 1.0)])]),  # sous le seuil
        (window(), [candidate(0.9, [span("67:3", 1, 8)], None)]),  # temps non mesuré
        (window(), [candidate(0.9, [span("67:4", 1, 2)], [(0.0, 1.0)])]),  # 2 mots : trop court
        (window(), []),
    ]
    assert observed_rate(observations, letters, floor=0.75, min_words=3) == pytest.approx(5.0)


def test_le_debit_observe_additionne_les_versets_d_une_suite() -> None:
    chain = candidate(
        0.9, [span("67:1", 1, 3), span("67:2", 1, 3)], [(0.0, 2.0), (2.0, 5.0)]
    )  # 30 lettres / 5 s
    assert observed_rate([(window(), [chain])], letters, 0.75, 3) == pytest.approx(6.0)


def test_le_debit_observe_prend_le_meilleur_candidat_de_la_fenetre() -> None:
    weak = candidate(0.5, [span("67:2", 1, 8)], [(0.0, 1.0)])
    strong = candidate(0.9, [span("67:1", 1, 5)], [(0.0, 5.0)])
    assert observed_rate([(window(), [weak, strong])], letters, 0.75, 3) == pytest.approx(5.0)


def test_sans_aucun_verset_place_le_debit_est_inconnu_et_rien_n_est_planifie() -> None:
    assert observed_rate([(window(), [])], letters, 0.75, 3) is None
    assert plan_speed(None, SpeedConfig()) is None


def test_le_plan_donne_rapport_et_facteur() -> None:
    plan = plan_speed(1.6, SpeedConfig(typical_letters_per_s=3.2))
    assert plan is not None
    assert plan.ratio == pytest.approx(0.5) and plan.factor == 2.0
    assert plan.rate_letters_per_s == 1.6


def test_le_plan_d_une_recitation_normale_ne_compense_pas() -> None:
    plan = plan_speed(3.3, SpeedConfig(typical_letters_per_s=3.2))
    assert plan is not None and plan.factor == 1.0
