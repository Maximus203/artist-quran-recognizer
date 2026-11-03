"""Dégradations ffmpeg : propriétés mesurées (SNR, bande, décalage), jamais supposées."""

from __future__ import annotations

import math
import random
import shutil
import wave
from array import array
from pathlib import Path

import pytest

from aqr.data.degrade import degrade as run_degradation
from aqr.data.degrade import (
    gaussian_noise,
    make_silence,
    read_samples,
    rms,
    snr_db,
    write_samples,
)
from aqr.data.refcorpus import Degradation

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg requis")

RATE = 16000


def band_noise(seconds: float, seed: int = 0) -> array[int]:
    rng = random.Random(seed)
    return array("h", (round(rng.gauss(0, 4000)) for _ in range(round(seconds * RATE))))


def tone(freq: float, seconds: float, amp: int = 8000) -> array[int]:
    n = round(seconds * RATE)
    return array("h", (round(amp * math.sin(2 * math.pi * freq * i / RATE)) for i in range(n)))


def make(tmp: Path, samples: array[int]) -> Path:
    path = tmp / "in.wav"
    write_samples(path, samples, RATE)
    return path


def test_bruit_au_snr_demande(tmp_path: Path) -> None:
    src = make(tmp_path, tone(440, 3.0))
    for target in (0, 10, 20):
        out = tmp_path / f"n{target}.wav"
        run_degradation(Degradation("noise", {"snr_db": target, "seed": 1}), src, out)
        clean, _ = read_samples(src)
        noisy, rate = read_samples(out)
        assert rate == RATE and len(noisy) == len(clean)
        assert snr_db(clean, noisy) == pytest.approx(target, abs=0.5)


def test_bruit_reproductible_selon_la_graine(tmp_path: Path) -> None:
    src = make(tmp_path, tone(300, 1.0))
    a, b, c = (tmp_path / f"{n}.wav" for n in "abc")
    run_degradation(Degradation("noise", {"snr_db": 10, "seed": 1}), src, a)
    run_degradation(Degradation("noise", {"snr_db": 10, "seed": 1}), src, b)
    run_degradation(Degradation("noise", {"snr_db": 10, "seed": 2}), src, c)
    assert a.read_bytes() == b.read_bytes() != c.read_bytes()
    assert gaussian_noise(100, 500.0, 1) == gaussian_noise(100, 500.0, 1)
    assert rms(gaussian_noise(20000, 500.0, 1)) == pytest.approx(500.0, rel=0.05)


def test_telephone_coupe_hors_bande(tmp_path: Path) -> None:
    out = tmp_path / "tel.wav"
    levels = {}
    for freq in (100, 1000, 6000):
        src = make(tmp_path, tone(freq, 1.0))
        run_degradation(Degradation("telephone"), src, out)
        samples, rate = read_samples(out)
        assert rate == RATE
        levels[freq] = rms(samples[RATE // 4 :]) / rms(tone(freq, 1.0))
    assert levels[1000] > 0.8
    assert levels[100] < 0.3
    assert levels[6000] < 0.1


def test_reverb_allonge_la_queue(tmp_path: Path) -> None:
    burst = tone(500, 0.3)
    burst.extend(array("h", [0]) * RATE)
    src = make(tmp_path, burst)
    out = tmp_path / "rev.wav"
    run_degradation(Degradation("reverb", {"decay": 0.5, "delay_ms": 80}), src, out)
    clean, _ = read_samples(src)
    wet, _ = read_samples(out)
    tail = slice(round(0.34 * RATE), round(0.6 * RATE))
    assert rms(clean[tail]) == 0
    assert rms(wet[tail]) > 100


def test_mp3_basse_qualite_reste_pres_du_signal(tmp_path: Path) -> None:
    src = make(tmp_path, tone(440, 2.0))
    out = tmp_path / "mp3.wav"
    run_degradation(Degradation("mp3_low", {"kbps": 32}), src, out)
    clean, _ = read_samples(src)
    coded, rate = read_samples(out)
    assert rate == RATE
    assert abs(len(coded) - len(clean)) < RATE * 0.1  # délai du codec, pas de troncature
    assert rms(coded) == pytest.approx(rms(clean), rel=0.2)
    assert coded.tobytes() != clean.tobytes()


def test_silence_pad_decale_exactement(tmp_path: Path) -> None:
    src = make(tmp_path, tone(440, 1.0))
    out = tmp_path / "pad.wav"
    run_degradation(Degradation("silence_pad", {"pad_s": 1.5}, shift_s=1.5), src, out)
    clean, _ = read_samples(src)
    padded, _ = read_samples(out)
    pad = round(1.5 * RATE)
    assert len(padded) == len(clean) + pad
    assert rms(padded[:pad]) == 0
    assert padded[pad:] == clean


def test_silence_pur(tmp_path: Path) -> None:
    out = tmp_path / "sil.wav"
    make_silence(out, 2.0)
    samples, rate = read_samples(out)
    assert rate == RATE and len(samples) == 2 * RATE and rms(samples) == 0
    with wave.open(str(out), "rb") as handle:
        assert (handle.getnchannels(), handle.getsampwidth()) == (1, 2)


def test_parametre_manquant(tmp_path: Path) -> None:
    src = make(tmp_path, tone(440, 0.5))
    with pytest.raises(ValueError, match="snr_db"):
        run_degradation(Degradation("noise", {"seed": 1}), src, tmp_path / "x.wav")
