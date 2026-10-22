"""Dégradations de la campagne de robustesse : propriétés MESURÉES (SNR, bande, durée, énergie)."""

from __future__ import annotations

import math
import random
import shutil
import sys
from array import array
from itertools import pairwise
from pathlib import Path

import pytest

from aqr.data.degrade import gaussian_noise, read_samples, rms, snr_db, write_samples
from aqr.data.degrade_extra import (
    apply_condition,
    format_command,
    pink_noise,
    room_impulse_response,
)
from aqr.eval.degradation_curve import Condition, build_conditions, conditions_by_id

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg requis")
RATE = 16000


def tone(freq: float, seconds: float, amp: int = 8000) -> array[int]:
    n = round(seconds * RATE)
    return array("h", (round(amp * math.sin(2 * math.pi * freq * i / RATE)) for i in range(n)))


def source(tmp: Path, samples: array[int], name: str = "in.wav") -> Path:
    path = tmp / name
    write_samples(path, samples, RATE)
    return path


def condition(identifier: str) -> Condition:
    return conditions_by_id([identifier])[0]


def level_db(samples: array[int]) -> float:
    return 20 * math.log10(max(rms(samples), 1e-9))


def band_gain_db(tmp: Path, identifier: str, freq: float) -> float:
    src = source(tmp, tone(freq, 2.0), f"tone{int(freq)}.wav")
    dest = tmp / f"out_{identifier}_{int(freq)}.wav"
    apply_condition(condition(identifier), src, dest)
    out, _rate = read_samples(dest)
    middle = out[RATE // 2 : -RATE // 2]  # sans les bords (latence des codecs)
    return level_db(middle) - level_db(tone(freq, 1.0))


# --- réponse impulsionnelle (pure) ---------------------------------------------------------------


def test_reponse_impulsionnelle_a_energie_unitaire_et_rapport_direct_reverbere() -> None:
    for rt60, drr in ((0.4, 6), (0.9, 0), (2.0, -4)):
        ir = room_impulse_response(rt60, drr, RATE, seed=3)
        energy = sum(x * x for x in ir)
        assert energy == pytest.approx(1.0, rel=1e-3)
        direct = ir[0] ** 2
        tail = energy - direct
        assert 10 * math.log10(direct / tail) == pytest.approx(drr, abs=0.05)


def test_reponse_impulsionnelle_decroit_de_60_db_en_rt60() -> None:
    rt60 = 1.0
    ir = room_impulse_response(rt60, 0, RATE, seed=1)
    first, last = ir[1 : RATE // 10], ir[RATE - RATE // 10 : RATE]
    early = sum(x * x for x in first) / len(first)
    late = sum(x * x for x in last) / len(last)
    assert 10 * math.log10(early / late) > 45  # ~60 dB moins l'écart de position, bruité


def test_reponse_impulsionnelle_est_reproductible_par_graine() -> None:
    a = room_impulse_response(0.4, 0, RATE, seed=5)
    assert a == room_impulse_response(0.4, 0, RATE, seed=5)
    assert a != room_impulse_response(0.4, 0, RATE, seed=6)


# --- ffmpeg ---------------------------------------------------------------------------------------


@needs_ffmpeg
def test_condition_propre_copie_sans_commande(tmp_path: Path) -> None:
    src = source(tmp_path, tone(440, 1.0))
    log = apply_condition(condition("propre"), src, tmp_path / "out.wav")
    assert log == []
    assert read_samples(tmp_path / "out.wav")[0] == read_samples(src)[0]


@needs_ffmpeg
@pytest.mark.parametrize("identifier", ["bruit_blanc_20db", "bruit_blanc_5db", "bruit_rose_10db"])
def test_bruits_au_rapport_signal_bruit_demande(tmp_path: Path, identifier: str) -> None:
    src = source(tmp_path, tone(440, 4.0))
    dest = tmp_path / "out.wav"
    apply_condition(condition(identifier), src, dest)
    clean, noisy = read_samples(src)[0], read_samples(dest)[0]
    assert snr_db(clean, noisy) == pytest.approx(condition(identifier).params["snr_db"], abs=0.5)


@needs_ffmpeg
def test_bruit_reproductible_et_different_selon_le_fichier(tmp_path: Path) -> None:
    src = source(tmp_path, tone(440, 2.0))
    a, b, c = (tmp_path / f"{n}.wav" for n in "abc")
    apply_condition(condition("bruit_rose_10db"), src, a)
    apply_condition(condition("bruit_rose_10db"), src, b)
    apply_condition(condition("bruit_rose_10db"), src, c, seed_offset=101)
    assert a.read_bytes() == b.read_bytes()
    assert a.read_bytes() != c.read_bytes()


@needs_ffmpeg
def test_le_bruit_rose_est_plus_grave_que_le_blanc() -> None:
    pink = pink_noise(4.0, RATE, seed=1)
    white = gaussian_noise(len(pink), rms(pink), seed=1)

    def roughness(samples: array[int]) -> float:
        diff = array("h", (samples[i + 1] - samples[i] for i in range(len(samples) - 1)))
        return rms(diff) / rms(samples)

    assert len(pink) == 4 * RATE
    assert roughness(pink) < 0.6 * roughness(white)


@needs_ffmpeg
def test_reverberation_conserve_le_niveau_et_la_duree(tmp_path: Path) -> None:
    rng = random.Random(1)
    speechlike = array("h", (round(rng.gauss(0, 3000)) for _ in range(RATE * 3)))
    src = source(tmp_path, speechlike)
    for identifier in ("reverberation_faible", "reverberation_forte"):
        dest = tmp_path / f"{identifier}.wav"
        apply_condition(condition(identifier), src, dest)
        out = read_samples(dest)[0]
        assert abs(len(out) - len(speechlike)) < RATE // 50
        assert level_db(out) == pytest.approx(level_db(speechlike), abs=2.0)


@needs_ffmpeg
def test_la_queue_de_reverberation_croit_avec_le_rt60(tmp_path: Path) -> None:
    burst = tone(500, 0.3)
    src = source(tmp_path, burst + array("h", [0] * (RATE * 2)))
    tails = {}
    for identifier in ("reverberation_faible", "reverberation_moyenne", "reverberation_forte"):
        dest = tmp_path / f"{identifier}.wav"
        apply_condition(condition(identifier), src, dest)
        out = read_samples(dest)[0]
        tails[identifier] = sum(x * x for x in out[round(0.8 * RATE) : round(1.8 * RATE)])
    assert tails["reverberation_faible"] < tails["reverberation_moyenne"]
    assert tails["reverberation_moyenne"] < tails["reverberation_forte"]


@needs_ffmpeg
def test_la_reverberation_ne_decale_pas_le_signal(tmp_path: Path) -> None:
    click = array("h", [0] * (RATE * 2))
    click[RATE] = 20000
    src = source(tmp_path, click)
    dest = tmp_path / "out.wav"
    apply_condition(condition("reverberation_moyenne"), src, dest)
    out = read_samples(dest)[0]
    peak = max(range(len(out)), key=lambda i: abs(out[i]))
    assert abs(peak - RATE) <= 2  # le direct reste à sa place : la vérité terrain ne bouge pas


@needs_ffmpeg
@pytest.mark.parametrize("tempo", [0.8, 0.6, 0.5])
def test_ralentissement_allonge_la_duree_sans_changer_la_hauteur(
    tmp_path: Path, tempo: float
) -> None:
    src = source(tmp_path, tone(440, 4.0))
    dest = tmp_path / "out.wav"
    apply_condition(condition(f"lent_x{tempo:g}"), src, dest)
    out = read_samples(dest)[0]
    assert len(out) / RATE == pytest.approx(4.0 / tempo, rel=0.03)
    middle = out[RATE:-RATE]
    crossings = sum(1 for a, b in pairwise(middle) if a < 0 <= b)
    assert crossings / (len(middle) / RATE) == pytest.approx(440, rel=0.03)


@needs_ffmpeg
@pytest.mark.parametrize("identifier", ["telephone_g711", "telephone_amr122", "telephone_amr475"])
def test_telephone_coupe_les_aigus_et_garde_la_voix(tmp_path: Path, identifier: str) -> None:
    assert band_gain_db(tmp_path, identifier, 6000.0) < -30
    assert band_gain_db(tmp_path, identifier, 1000.0) > -6


@needs_ffmpeg
@pytest.mark.parametrize("identifier", ["mp3_128k", "mp3_48k", "mp3_24k"])
def test_mp3_donne_un_wav_de_meme_duree(tmp_path: Path, identifier: str) -> None:
    src = source(tmp_path, tone(440, 2.0))
    dest = tmp_path / "out.wav"
    log = apply_condition(condition(identifier), src, dest)
    assert abs(len(read_samples(dest)[0]) - 2 * RATE) < RATE // 10
    assert any("libmp3lame" in " ".join(cmd) for cmd in log)


@needs_ffmpeg
def test_combinaison_reverberation_puis_bruit(tmp_path: Path) -> None:
    rng = random.Random(2)
    src = source(tmp_path, array("h", (round(rng.gauss(0, 3000)) for _ in range(RATE * 2))))
    dest = tmp_path / "out.wav"
    log = apply_condition(condition("combinaison"), src, dest)
    joined = " ".join(" ".join(cmd) for cmd in log)
    assert "afir" in joined and "amix" in joined
    assert abs(len(read_samples(dest)[0]) - 2 * RATE) < RATE // 50


@needs_ffmpeg
def test_chaque_condition_declare_ses_commandes_exactes(tmp_path: Path) -> None:
    src = source(tmp_path, tone(440, 1.0))
    for cond in build_conditions():
        dest = tmp_path / f"{cond.id}.wav"
        log = apply_condition(cond, src, dest)
        lines = [format_command(cmd, src, dest) for cmd in log]
        assert (not lines) == (cond.kind == "clean"), cond.id
        for line in lines:
            assert line.startswith("ffmpeg ") and str(tmp_path) not in line, line


def test_format_command_remplace_les_chemins_locaux(tmp_path: Path) -> None:
    src, dest = tmp_path / "x" / "in.wav", tmp_path / "y" / "out.wav"
    line = format_command(["-i", str(src), "-af", "atempo=0.6", str(dest)], src, dest)
    assert line == "ffmpeg -nostdin -y -v error -i IN.wav -af atempo=0.6 OUT.wav"


@pytest.mark.skipif(sys.byteorder != "little", reason="réponse impulsionnelle f32le")
def test_machine_little_endian() -> None:
    assert room_impulse_response(0.4, 0, RATE, seed=1).itemsize == 4
