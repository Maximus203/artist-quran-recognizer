"""Temps au mot estimés (ADR-0010) : proportionnels à la longueur des mots, bornés à t"""

from __future__ import annotations

from itertools import pairwise

import pytest

from aqr.domain.models import TimeSpan
from aqr.pipeline.word_times import interpolate


def test_le_premier_mot_commence_et_le_dernier_finit_aux_bornes_exactes():
    times = interpolate([2, 3, 5], TimeSpan(10.0, 20.0))
    assert times[0].start_s == 10.0 and times[-1].end_s == 20.0


def test_contigus_sans_trou_ni_chevauchement():
    times = interpolate([4, 1, 7, 3], TimeSpan(0.7, 9.1))
    assert all(a.end_s == b.start_s for a, b in pairwise(times))


def test_proportionnel_a_la_longueur_des_mots():
    times = interpolate([2, 3, 5], TimeSpan(10.0, 20.0))
    assert [round(t.duration_s, 6) for t in times] == [2.0, 3.0, 5.0]


def test_un_seul_mot_prend_tout_l_intervalle():
    assert interpolate([4], TimeSpan(1.0, 2.0)) == [TimeSpan(1.0, 2.0)]


@pytest.mark.parametrize("weights", [[], [3, 0, 2], [-1]])
def test_pas_de_mot_sans_lettre(weights):
    with pytest.raises(ValueError, match="au moins une lettre"):
        interpolate(weights, TimeSpan(0.0, 1.0))
