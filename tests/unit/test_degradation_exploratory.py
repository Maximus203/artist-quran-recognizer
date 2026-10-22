"""Conditions exploratoires (au-delà du cahier, ajoutées APRÈS le résultat principal)."""

from __future__ import annotations

import math
import shutil
from array import array
from pathlib import Path

import pytest

from aqr.data.degrade import read_samples, rms, snr_db, write_samples
from aqr.data.degrade_extra import apply_condition, tempo_filters
from aqr.eval.degradation_curve import (
    all_conditions,
    build_conditions,
    build_exploratory_conditions,
    build_lever_conditions,
    conditions_by_id,
)

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg requis")
RATE = 16000


def tone(freq: float, seconds: float, amp: int = 8000) -> array[int]:
    n = round(seconds * RATE)
    return array("h", (round(amp * math.sin(2 * math.pi * freq * i / RATE)) for i in range(n)))


def source(tmp: Path, samples: array[int], name: str = "in.wav") -> Path:
    path = tmp / name
    write_samples(path, samples, RATE)
    return path


def test_les_conditions_exploratoires_sont_a_part_et_plus_severes() -> None:
    main = {c.id: c for c in build_conditions()}
    extra = build_exploratory_conditions()
    assert extra and all(c.exploratory for c in extra)
    assert not any(c.exploratory for c in main.values())
    assert not set(main) & {c.id for c in extra}
    levers = [c.id for c in build_lever_conditions()]
    assert [c.id for c in all_conditions()] == [*main, *(c.id for c in extra), *levers]
    for cond in extra:
        assert not cond.anchor and not cond.required and not cond.cascade
        same_family = [c.severity for c in main.values() if c.family == cond.family]
        if same_family:
            assert cond.severity > max(same_family), cond.id


def test_les_exploratoires_se_retrouvent_par_identifiant() -> None:
    assert conditions_by_id(["lent_x0.3"])[0].tempo == 0.3
    assert conditions_by_id(["bruit_blanc_m5db"])[0].params["snr_db"] == -5


def test_atempo_n_accepte_pas_moins_de_0_5_par_filtre() -> None:
    assert tempo_filters(0.6) == ["atempo=0.6"]
    assert tempo_filters(0.5) == ["atempo=0.5"]
    chained = tempo_filters(0.3)
    assert all(float(f.split("=")[1]) >= 0.5 for f in chained)
    product = math.prod(float(f.split("=")[1]) for f in chained)
    assert product == pytest.approx(0.3, rel=1e-6)
    with pytest.raises(ValueError):
        tempo_filters(0.0)


@needs_ffmpeg
def test_ralentissement_chaine_au_dela_de_0_5(tmp_path: Path) -> None:
    src = source(tmp_path, tone(440, 3.0))
    dest = tmp_path / "out.wav"
    apply_condition(conditions_by_id(["lent_x0.3"])[0], src, dest)
    assert len(read_samples(dest)[0]) / RATE == pytest.approx(3.0 / 0.3, rel=0.03)


@needs_ffmpeg
def test_bruit_a_snr_negatif(tmp_path: Path) -> None:
    src = source(tmp_path, tone(440, 4.0))
    dest = tmp_path / "out.wav"
    apply_condition(conditions_by_id(["bruit_blanc_m5db"])[0], src, dest)
    assert snr_db(read_samples(src)[0], read_samples(dest)[0]) == pytest.approx(-5.0, abs=0.5)


@needs_ffmpeg
@pytest.mark.parametrize("identifier,hz", [("passe_bas_4000", 4000), ("passe_bas_5500", 5500)])
def test_passe_bas_coupe_au_dessus_de_la_frequence(
    tmp_path: Path, identifier: str, hz: int
) -> None:
    gains = {}
    for freq in (1000.0, hz + 1500.0):
        src = source(tmp_path, tone(freq, 2.0), f"t{int(freq)}.wav")
        dest = tmp_path / f"{identifier}_{int(freq)}.wav"
        apply_condition(conditions_by_id([identifier])[0], src, dest)
        out = read_samples(dest)[0][RATE // 2 : -RATE // 2]
        gains[freq] = 20 * math.log10(max(rms(out), 1e-9) / rms(tone(freq, 1.0)))
    assert gains[1000.0] > -3
    assert gains[hz + 1500.0] < -25


@needs_ffmpeg
def test_mp3_a_debit_tres_bas(tmp_path: Path) -> None:
    src = source(tmp_path, tone(440, 2.0))
    dest = tmp_path / "out.wav"
    apply_condition(conditions_by_id(["mp3_8k"])[0], src, dest)
    assert abs(len(read_samples(dest)[0]) - 2 * RATE) < RATE // 10
