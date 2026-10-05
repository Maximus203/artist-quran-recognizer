"""B1 FfmpegAudioExtractor : tout format -> PCM 16 kHz mono, sur des fichiers générés."""

from __future__ import annotations

from pathlib import Path

import pytest
from tests.support.audio import (
    FFMPEG,
    make_mp3,
    make_video_with_audio,
    make_video_without_audio,
    write_silence_wav,
    write_sine_wav,
    zero_crossing_frequency,
)

from aqr.adapters.ffmpeg_extractor import (
    AudioExtractionError,
    ExtractorConfig,
    FfmpegAudioExtractor,
)

pytestmark = pytest.mark.skipif(FFMPEG is None, reason="ffmpeg requis")
RATE = 16000


def test_sinus_44k_stereo_devient_mono_16k(tmp_path: Path):
    src = write_sine_wav(tmp_path / "a.wav", 1.0, freq=300.0, rate=44100, channels=2)
    clip = FfmpegAudioExtractor().extract(src)
    assert clip.sample_rate == RATE
    assert len(clip.samples) == pytest.approx(RATE, abs=RATE * 0.03)
    assert zero_crossing_frequency(clip.samples, RATE) == pytest.approx(300.0, rel=0.03)


def test_silence_reste_du_silence(tmp_path: Path):
    clip = FfmpegAudioExtractor().extract(write_silence_wav(tmp_path / "s.wav", 1.0))
    assert max(abs(x) for x in clip.samples) < 1e-4


def test_amplitude_preservee(tmp_path: Path):
    src = write_sine_wav(tmp_path / "a.wav", 0.5, amplitude=0.5)
    clip = FfmpegAudioExtractor().extract(src)
    assert max(clip.samples) == pytest.approx(0.5, abs=0.02)


def test_mp3(tmp_path: Path):
    clip = FfmpegAudioExtractor().extract(make_mp3(tmp_path / "a.mp3", 1.0, freq=500.0))
    assert len(clip.samples) == pytest.approx(RATE, abs=RATE * 0.1)
    assert zero_crossing_frequency(clip.samples, RATE) == pytest.approx(500.0, rel=0.05)


def test_video_courte_avec_piste_audio(tmp_path: Path):
    clip = FfmpegAudioExtractor().extract(make_video_with_audio(tmp_path / "v.mp4", 1.0, 600.0))
    assert len(clip.samples) == pytest.approx(RATE, abs=RATE * 0.15)
    assert zero_crossing_frequency(clip.samples, RATE) == pytest.approx(600.0, rel=0.05)


def test_video_sans_piste_audio_est_une_erreur_explicite(tmp_path: Path):
    src = make_video_without_audio(tmp_path / "muet.mp4", 1.0)
    with pytest.raises(AudioExtractionError, match="piste audio"):
        FfmpegAudioExtractor().extract(src)


def test_fichier_qui_n_est_pas_un_media(tmp_path: Path):
    bogus = tmp_path / "x.mp3"
    bogus.write_bytes(b"ceci n'est pas de l'audio" * 10)
    with pytest.raises(AudioExtractionError) as exc:
        FfmpegAudioExtractor().extract(bogus)
    assert "x.mp3" in str(exc.value)


def test_frequence_configurable(tmp_path: Path):
    src = write_sine_wav(tmp_path / "a.wav", 1.0, rate=16000)
    clip = FfmpegAudioExtractor(ExtractorConfig(sample_rate=8000)).extract(src)
    assert clip.sample_rate == 8000
    assert len(clip.samples) == pytest.approx(8000, abs=300)


def test_ffmpeg_introuvable_message_clair(tmp_path: Path):
    src = write_sine_wav(tmp_path / "a.wav", 0.2)
    with pytest.raises(AudioExtractionError, match="ffmpeg"):
        FfmpegAudioExtractor(ExtractorConfig(ffmpeg_path="ffmpeg-qui-n-existe-pas")).extract(src)


def test_nom_de_fichier_avec_espaces_et_accents(tmp_path: Path):
    src = write_sine_wav(tmp_path / "récitation — sourate 67 (essai).wav", 0.5)
    assert len(FfmpegAudioExtractor().extract(src).samples) > 0


def test_ecretage_des_depassements_de_pleine_echelle():
    from array import array

    from aqr.adapters.ffmpeg_extractor import clamp_full_scale

    samples = array("f", [0.2, 1.4, -1.39, 0.99, -0.5])
    clamped = clamp_full_scale(samples)
    assert list(clamped) == pytest.approx([0.2, 1.0, -1.0, 0.99, -0.5])
    assert list(samples)[1] == pytest.approx(1.4)  # l'entrée n'est pas modifiée


def test_pas_de_copie_inutile_sans_depassement():
    from array import array

    from aqr.adapters.ffmpeg_extractor import clamp_full_scale

    samples = array("f", [0.2, -0.3])
    assert clamp_full_scale(samples) is samples


def test_mp3_pleine_echelle_respecte_le_contrat_apres_extraction(tmp_path: Path):
    from tests.support.audio import ffmpeg

    mp3 = tmp_path / "fort.mp3"
    ffmpeg("-f", "lavfi", "-i", "aevalsrc=sin(2*PI*440*t):d=2:s=44100", str(mp3))
    clip = FfmpegAudioExtractor().extract(mp3)
    assert max(clip.samples) <= 1.0 and min(clip.samples) >= -1.0
