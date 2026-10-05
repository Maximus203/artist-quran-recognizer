"""Contrat du port B4 `QuranASR` : fake (rapide) ET FastConformer réel (`slow`, GPU)."""

from __future__ import annotations

import pytest
from tests.support.fakes import FakeQuranASR
from tests.support.real import concat, everyayah_clip, models_dir, silence, tone_clip

from aqr.domain.models import Riwaya, TimeSpan
from aqr.domain.ports import QuranASR, Transcript


def _fastconformer() -> QuranASR:
    from tests.support.real import LOCK_PATH

    from aqr.adapters.fastconformer import FastConformerConfig, FastConformerQuranASR

    return FastConformerQuranASR(FastConformerConfig(models_dir=models_dir(), lock_path=LOCK_PATH))


@pytest.fixture(
    params=[
        pytest.param(lambda: FakeQuranASR(), id="fake"),
        pytest.param(_fastconformer, id="fastconformer", marks=pytest.mark.slow),
    ],
    scope="module",
)
def asr(request: pytest.FixtureRequest) -> QuranASR:
    return request.param()  # type: ignore[no-any-return]


@pytest.fixture(scope="module")
def verse(asr):  # type: ignore[no-untyped-def]
    if isinstance(asr, FakeQuranASR):  # le fake ne regarde que l'énergie : un ton suffit
        return tone_clip(3.0)
    return everyayah_clip("Alafasy_128kbps", "112001.mp3")


def _span_of(clip) -> TimeSpan:  # type: ignore[no-untyped-def]
    return TimeSpan(0.0, len(clip.samples) / clip.sample_rate)


def test_riwaya_declaree(asr):
    assert asr.riwaya is Riwaya.HAFS


def test_transcript_bien_forme(asr, verse):
    span = _span_of(verse)
    transcript = asr.transcribe(verse, span)
    assert isinstance(transcript, Transcript) and transcript.engine
    assert transcript.words, "un verset récité doit produire des mots"
    for word in transcript.words:
        assert word.text.strip()
        assert span.start_s - 1e-6 <= word.time.start_s < word.time.end_s <= span.end_s + 1e-6
        assert 0.0 <= word.confidence <= 1.0


def test_mots_ordonnes_dans_le_temps(asr, verse):
    words = asr.transcribe(verse, _span_of(verse)).words
    starts = [w.time.start_s for w in words]
    assert starts == sorted(starts)


def test_le_decalage_du_segment_decale_les_temps(asr, verse):
    pad = silence(2.0)
    clip = concat(pad, verse)
    duration = len(verse.samples) / verse.sample_rate
    shifted = asr.transcribe(clip, TimeSpan(2.0, 2.0 + duration))
    plain = asr.transcribe(verse, _span_of(verse))
    assert len(shifted.words) == len(plain.words)
    assert shifted.words[0].time.start_s >= 2.0
    assert shifted.words[0].time.start_s - 2.0 == pytest.approx(
        plain.words[0].time.start_s, abs=0.2
    )


def test_silence_ne_produit_aucun_mot(asr):
    quiet = silence(3.0)
    assert asr.transcribe(quiet, _span_of(quiet)).words == ()


def test_segment_hors_du_clip_est_refuse(asr, verse):
    duration = len(verse.samples) / verse.sample_rate
    with pytest.raises(ValueError):
        asr.transcribe(verse, TimeSpan(0.0, duration + 5.0))
