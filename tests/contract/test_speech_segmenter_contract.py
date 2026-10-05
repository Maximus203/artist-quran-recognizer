"""Contrat du port B2 `SpeechSegmenter` : fake, Silero VAD et recitation-segmenter-v2 (`slow`)."""

from __future__ import annotations

from itertools import pairwise

import pytest
from tests.support.fakes import EnergySegmenter
from tests.support.real import (
    LOCK_PATH,
    everyayah_clip,
    iou,
    models_dir,
    silence,
    tone_clip,
    with_gaps,
)

from aqr.domain.ports import SpeechSegmenter


def _silero() -> SpeechSegmenter:
    pytest.importorskip("silero_vad")
    from aqr.adapters.segmenters import SileroVadSegmenter

    return SileroVadSegmenter()


def _obadx() -> SpeechSegmenter:
    from aqr.adapters.segmenters import RecitationSegmenterConfig, RecitationSegmenterV2

    return RecitationSegmenterV2(
        RecitationSegmenterConfig(models_dir=models_dir(), lock_path=LOCK_PATH)
    )


@pytest.fixture(
    params=[
        pytest.param(lambda: EnergySegmenter(), id="fake"),
        pytest.param(_silero, id="silero"),
        pytest.param(_obadx, id="recitation-segmenter-v2", marks=pytest.mark.slow),
    ],
    scope="module",
)
def segmenter(request: pytest.FixtureRequest) -> SpeechSegmenter:
    return request.param()  # type: ignore[no-any-return]


@pytest.fixture(scope="module")
def recitation(segmenter):  # type: ignore[no-untyped-def]
    """Trois versets séparés par 1,5 s de silence : la vérité terrain est connue au centième."""
    if isinstance(segmenter, EnergySegmenter):  # le fake ne regarde que l'énergie
        parts = [tone_clip(2.0, f) for f in (300.0, 400.0, 500.0)]
    else:
        parts = [everyayah_clip("Alafasy_128kbps", f"112{n:03d}.mp3") for n in (1, 3, 4)]
    return with_gaps(parts, gap_s=1.5)


def test_un_segment_par_enonce_aux_bons_endroits(segmenter, recitation):
    clip, truth = recitation
    spans = segmenter.segment(clip)
    assert len(spans) == len(truth), f"attendu {len(truth)} segments, obtenu {spans}"
    for found, expected in zip(spans, truth, strict=True):
        assert iou(found, expected) >= 0.8, (found, expected)


def test_segments_ordonnes_disjoints_et_dans_le_clip(segmenter, recitation):
    clip, _truth = recitation
    duration = len(clip.samples) / clip.sample_rate
    spans = segmenter.segment(clip)
    assert spans == sorted(spans, key=lambda s: s.start_s)
    assert all(a.end_s <= b.start_s + 1e-9 for a, b in pairwise(spans))
    assert all(0.0 <= s.start_s < s.end_s <= duration + 1e-6 for s in spans)


def test_silence_ne_donne_aucun_segment(segmenter):
    assert segmenter.segment(silence(5.0)) == []


def test_deterministe(segmenter, recitation):
    clip, _truth = recitation
    assert segmenter.segment(clip) == segmenter.segment(clip)
