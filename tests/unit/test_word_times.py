"""Temps au mot estimés (ADR-0010) : proportionnels à la longueur des mots, bornés à t"""

from __future__ import annotations

from itertools import pairwise

import pytest

from aqr.domain.models import TimeSpan
from aqr.pipeline.word_times import interpolate, without_overlap


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


# --- Temps sans chevauchement : un fichier que le moteur écrit doit toujours être lisible ---------
# Cas réel (campagne de dégradation, vitesse ×0,3, Alafasy 67:26) : deux moitiés de verset
# fusionnées dont les fenêtres se recouvrent de 50 ms ; le mot 5 finit à 1212,575 s, le suivant
# commence à 1212,525 s.
def _times(*pairs: tuple[float, float]) -> list[TimeSpan]:
    return [TimeSpan(a, b) for a, b in pairs]


def test_des_temps_deja_ordonnes_sont_rendus_tels_quels():
    times = _times((1.0, 2.0), (2.0, 3.5), (4.0, 5.0))  # une pause n'est pas un chevauchement
    assert without_overlap(times) == tuple(times)


def test_un_leger_chevauchement_est_recoupe_au_milieu():  # cas réel ×0,3
    cut = without_overlap(_times((1205.135, 1212.575), (1212.525, 1220.285)))
    assert cut is not None
    assert cut[0].start_s == 1205.135 and cut[1].end_s == 1220.285
    assert cut[0].end_s == cut[1].start_s == pytest.approx(1212.55)


def test_le_recoupage_ne_touche_que_les_bords_qui_se_chevauchent():
    times = _times((0.0, 1.0), (1.0, 2.02), (2.0, 3.0), (3.5, 4.0))
    cut = without_overlap(times)
    assert cut is not None and all(a.end_s <= b.start_s for a, b in pairwise(cut))
    assert cut[0] == times[0] and cut[-1] == times[-1]
    assert cut[0].start_s == times[0].start_s and cut[-1].end_s == times[-1].end_s


def test_un_chevauchement_grossier_n_est_pas_repare():  # honnêteté : pas de temps plutôt qu'un faux
    assert without_overlap(_times((0.0, 3.0), (1.0, 4.0))) is None


def test_un_mot_englobe_par_son_voisin_n_est_pas_repare():
    assert without_overlap(_times((0.0, 5.0), (1.0, 2.0), (5.0, 6.0))) is None


def test_la_tolerance_est_reglable():
    times = _times((0.0, 1.0), (0.8, 2.0))
    assert without_overlap(times) is None  # 0,2 s > tolérance par défaut
    cut = without_overlap(times, max_overlap_s=0.5)
    assert cut is not None and cut[0].end_s == cut[1].start_s == pytest.approx(0.9)
