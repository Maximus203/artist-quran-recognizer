"""Fenêtres ASR : un segment trop long est coupé au creux d'énergie le plus proche, jamais au
milieu d'un mot choisi au hasard (la limite de Whisper est de 30 s par fenêtre)."""

from __future__ import annotations

from array import array
from itertools import pairwise

import pytest

from aqr.domain.models import TimeSpan
from aqr.pipeline.windows import split_long_spans

RATE = 16000


def _signal(seconds: float, quiet: list[tuple[float, float]]) -> array[float]:
    samples = array("f", [0.5] * round(seconds * RATE))
    for start, end in quiet:
        for i in range(round(start * RATE), round(end * RATE)):
            samples[i] = 0.0
    return samples


def test_segment_court_inchange():
    spans = [TimeSpan(0.0, 10.0), TimeSpan(12.0, 20.0)]
    assert split_long_spans(spans, _signal(30, []), RATE, max_len_s=25.0) == spans


def test_coupe_au_creux_d_energie_proche_de_la_coupe_ideale():
    # 50 s : coupe idéale à 25 s ; le creux est à 23,5–24,0 s -> la coupe y tombe.
    pieces = split_long_spans(
        [TimeSpan(0.0, 50.0)], _signal(50, [(23.5, 24.0)]), RATE, max_len_s=30.0, search_s=2.0
    )
    assert len(pieces) == 2
    assert 23.5 <= pieces[0].end_s <= 24.0
    assert pieces[0].end_s == pieces[1].start_s  # contigus : rien n'est perdu


def test_chaque_morceau_respecte_la_limite_et_couvre_le_segment():
    pieces = split_long_spans([TimeSpan(5.0, 95.0)], _signal(100, []), RATE, max_len_s=25.0)
    assert pieces[0].start_s == 5.0 and pieces[-1].end_s == 95.0
    assert all(p.duration_s <= 25.0 + 1e-6 for p in pieces)
    assert all(a.end_s == b.start_s for a, b in pairwise(pieces))
    assert len(pieces) == 4


def test_sans_creux_la_coupe_idealle_est_utilisee():
    pieces = split_long_spans([TimeSpan(0.0, 60.0)], _signal(60, []), RATE, max_len_s=40.0)
    assert [round(p.end_s, 3) for p in pieces] == [30.0, 60.0]


def test_limite_invalide():
    with pytest.raises(ValueError, match="max_len_s"):
        split_long_spans([TimeSpan(0.0, 10.0)], _signal(10, []), RATE, max_len_s=0.0)
