"""Mesures de segmentation (scripts/measure_segmenters.py) : partie pure, sans modèle."""

from __future__ import annotations

import pytest
from scripts.measure_segmenters import summarize_spans

from aqr.domain.models import TimeSpan


def test_aucun_segment_donne_des_zeros_sans_division():
    stats = summarize_spans([], excerpt_s=180.0)
    assert stats.count == 0
    assert stats.median_s == stats.min_s == stats.max_s == 0.0
    assert stats.short_share == 0.0 and stats.speech_coverage == 0.0


def test_statistiques_de_duree_part_courte_et_couverture():
    spans = [TimeSpan(0.0, 0.5), TimeSpan(1.0, 3.0), TimeSpan(10.0, 14.0), TimeSpan(20.0, 20.9)]
    stats = summarize_spans(spans, excerpt_s=40.0)
    assert stats.count == 4
    assert stats.min_s == pytest.approx(0.5) and stats.max_s == pytest.approx(4.0)
    assert stats.median_s == pytest.approx((0.9 + 2.0) / 2)
    assert stats.short_share == pytest.approx(0.5)  # 0,5 s et 0,9 s < 1 s
    assert stats.speech_coverage == pytest.approx((0.5 + 2.0 + 4.0 + 0.9) / 40.0)


def test_seuil_court_est_strict():
    assert summarize_spans([TimeSpan(0.0, 1.0)], excerpt_s=10.0).short_share == 0.0


def test_duree_d_extrait_invalide_refusee():
    with pytest.raises(ValueError, match="extrait"):
        summarize_spans([TimeSpan(0.0, 1.0)], excerpt_s=0.0)
