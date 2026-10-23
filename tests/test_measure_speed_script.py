"""`scripts/measure_speed.py` : grille de tâches, chemins, audios dérivés (sans modèle)."""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "measure_speed.py"


@pytest.fixture(scope="module")
def script():  # type: ignore[no-untyped-def]
    spec = importlib.util.spec_from_file_location("measure_speed_under_test", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def args(kind: str, **extra: object) -> argparse.Namespace:
    base = {
        "set": kind,
        "cells": None,
        "files": None,
        "deg_derived": Path("deg"),
        "derived_dir": Path("derived"),
    }
    return argparse.Namespace(**{**base, **extra})


def test_les_temoins_couvrent_42_cellules_sur_9_fichiers(script) -> None:  # type: ignore[no-untyped-def]
    jobs = script.jobs_for(args("temoins"))
    assert len(jobs) == 42 * 9
    assert len({(j.cell, j.file) for j in jobs}) == len(jobs)
    assert {j.kind for j in jobs} == {"temoins"}


def test_le_facteur_un_reutilise_le_temoin_etire_de_la_campagne_de_degradation(script) -> None:  # type: ignore[no-untyped-def]
    deg, derived = Path("deg"), Path("derived")
    assert script.temoin_audio(deg, derived, 1.0, 1.0, "X-001") == deg / "propre" / "X-001.wav"
    assert script.temoin_audio(deg, derived, 0.4, 1.0, "X-001") == deg / "lent_x0.4" / "X-001.wav"
    assert (
        script.temoin_audio(deg, derived, 0.4, 2.5, "X-001")
        == derived / "temoins" / "s0.4_c2.5" / "X-001.wav"
    )


def test_les_vrais_fichiers_ont_cinq_facteurs_et_trois_controles(script) -> None:  # type: ignore[no-untyped-def]
    jobs = script.jobs_for(args("reel"))
    assert len(jobs) == 5 * len(script.REAL_FILES)
    roles = [role for _rel, role in script.REAL_FILES.values()]
    assert roles.count("controle") == 3 and roles.count("lent") == 8
    assert {j.cell for j in jobs} == {"c1", "c1.25", "c1.5", "c2", "c2.5"}


def test_les_filtres_de_cellules_et_de_fichiers_se_combinent(script) -> None:  # type: ignore[no-untyped-def]
    jobs = script.jobs_for(args("reel", cells=["c2"], files=["lot3-04", "lot1-05"]))
    assert sorted(j.file for j in jobs) == ["lot1-05", "lot3-04"]
    assert all(j.cell == "c2" and j.comp == 2.0 for j in jobs)


def test_les_sorties_d_une_tache_sont_rangees_par_jeu_et_cellule(script) -> None:  # type: ignore[no-untyped-def]
    (job,) = script.jobs_for(args("temoins", cells=["s0.3_c4"], files=["Husary-001"]))
    recognition, meta = script.out_paths(Path("out"), job)
    assert recognition == Path("out") / "temoins" / "s0.3_c4" / "Husary-001.recognition.json"
    assert meta.name == "Husary-001.meta.json"
    assert job.stretch == 0.3 and job.comp == 4.0
