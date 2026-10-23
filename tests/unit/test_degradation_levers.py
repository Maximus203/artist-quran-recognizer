"""Leviers peu coûteux (exploratoires) : une dégradation puis un traitement avant l'ASR."""

from __future__ import annotations

import math
import shutil
from array import array
from pathlib import Path

import pytest

from aqr.data.degrade import read_samples, write_samples
from aqr.data.degrade_extra import apply_condition
from aqr.eval.degradation_curve import (
    all_conditions,
    build_lever_conditions,
    conditions_by_id,
    resolve_step,
)

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg requis")
RATE = 16000


def tone(seconds: float, freq: float = 440.0, amp: int = 8000) -> array[int]:
    n = round(seconds * RATE)
    return array("h", (round(amp * math.sin(2 * math.pi * freq * i / RATE)) for i in range(n)))


def test_les_leviers_sont_exploratoires_et_enchainent_des_etapes_connues() -> None:
    levers = build_lever_conditions()
    assert levers and all(c.exploratory and c.family == "levier" for c in levers)
    assert all(c.kind == "chain" for c in levers)
    assert {c.id for c in levers} <= {c.id for c in all_conditions()}
    for cond in levers:
        steps = str(cond.params["steps"]).split(">")
        assert len(steps) >= 2
        for step in steps:
            resolve_step(step)  # lève KeyError si une étape n'existe pas


def test_la_vitesse_nette_est_le_produit_des_etapes() -> None:
    by_id = {c.id: c for c in build_lever_conditions()}
    assert by_id["levier_x0.4_puis_x2"].tempo == pytest.approx(0.8)
    assert by_id["levier_x0.3_puis_x2"].tempo == pytest.approx(0.6)
    assert by_id["levier_x0.3_puis_x3"].tempo == pytest.approx(0.9)
    assert by_id["levier_bruit_blanc_m5db_puis_debruitage"].tempo == 1.0


def test_etape_inconnue() -> None:
    with pytest.raises(KeyError):
        resolve_step("n_importe_quoi")


@needs_ffmpeg
def test_ralentir_puis_accelerer_donne_la_duree_nette(tmp_path: Path) -> None:
    src = tmp_path / "in.wav"
    write_samples(src, tone(3.0), RATE)
    dest = tmp_path / "out.wav"
    log = apply_condition(conditions_by_id(["levier_x0.4_puis_x2"])[0], src, dest)
    assert len(read_samples(dest)[0]) / RATE == pytest.approx(3.0 / 0.8, rel=0.04)
    assert sum("atempo" in " ".join(cmd) for cmd in log) == 2


@needs_ffmpeg
def test_debruitage_s_enchaine_apres_le_bruit(tmp_path: Path) -> None:
    src = tmp_path / "in.wav"
    write_samples(src, tone(3.0), RATE)
    dest = tmp_path / "out.wav"
    log = apply_condition(
        conditions_by_id(["levier_bruit_blanc_m5db_puis_debruitage"])[0], src, dest
    )
    joined = " ".join(" ".join(cmd) for cmd in log)
    assert "amix" in joined and "afftdn" in joined
    assert abs(len(read_samples(dest)[0]) - 3 * RATE) < RATE // 20
