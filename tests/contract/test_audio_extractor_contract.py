"""Contrat du port B1 `AudioExtractor`, rejoué contre le fake ET l'adapter ffmpeg réel."""

from __future__ import annotations

from pathlib import Path

import pytest
from tests.support.audio import FFMPEG, write_sine_wav, zero_crossing_frequency
from tests.support.fakes import SAMPLE_RATE, FakeAudioExtractor

from aqr.adapters.ffmpeg_extractor import FfmpegAudioExtractor
from aqr.domain.ports import AudioClip, AudioExtractor

IMPLEMENTATIONS = [
    pytest.param(FakeAudioExtractor, id="fake"),
    pytest.param(
        FfmpegAudioExtractor,
        id="ffmpeg",
        marks=pytest.mark.skipif(FFMPEG is None, reason="ffmpeg requis"),
    ),
]


@pytest.fixture(params=IMPLEMENTATIONS)
def extractor(request: pytest.FixtureRequest) -> AudioExtractor:
    return request.param()  # type: ignore[no-any-return]


@pytest.fixture()
def sine(tmp_path: Path) -> Path:
    return write_sine_wav(tmp_path / "sine.wav", 1.5, freq=440.0)


def test_renvoie_un_clip_16khz_dont_la_source_est_le_chemin(extractor, sine):
    clip = extractor.extract(sine)
    assert isinstance(clip, AudioClip)
    assert clip.sample_rate == SAMPLE_RATE
    assert clip.source == str(sine)


def test_echantillons_normalises_et_duree_conservee(extractor, sine):
    clip = extractor.extract(sine)
    assert min(clip.samples) >= -1.0 and max(clip.samples) <= 1.0
    assert len(clip.samples) == pytest.approx(1.5 * SAMPLE_RATE, abs=SAMPLE_RATE * 0.05)


def test_le_signal_est_conserve(extractor, sine):
    clip = extractor.extract(sine)
    assert zero_crossing_frequency(clip.samples, SAMPLE_RATE) == pytest.approx(440.0, rel=0.03)


def test_deterministe(extractor, sine):
    first, second = extractor.extract(sine), extractor.extract(sine)
    assert list(first.samples) == list(second.samples)


def test_fichier_absent_leve_file_not_found(extractor, tmp_path):
    with pytest.raises(FileNotFoundError):
        extractor.extract(tmp_path / "absent.wav")
