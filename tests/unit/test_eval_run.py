"""Protocole de lot (`run.json`) : lecture stricte et écriture atomique."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

from aqr.eval.run import (
    RUN_FILE,
    RUN_SCHEMA,
    RunError,
    RunStatus,
    load_run,
    write_text_atomic,
)


def _document(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "schema": RUN_SCHEMA,
        "status": "complete",
        "asr": "fastconformer",
        "engine": {"asr": "x"},
        "options": {"split": "dev"},
        "git": {"sha": "a" * 40, "dirty": False},
        "manifest": {"name": "m.yaml", "sha256": "m" * 64},
        "planned": ["c1", "c2"],
        "done": {"c1": "1" * 64},
        "failed": {"c2": "RuntimeError: boum"},
        "timing": {"started_at": "2026-10-09T10:00:00+00:00", "finished_at": None},
        "error": None,
    }
    base.update(over)
    return base


def _write(directory: Path, document: Any) -> None:
    (directory / RUN_FILE).write_text(json.dumps(document), encoding="utf-8")


def test_lecture_d_un_run_valide(tmp_path: Path):
    _write(tmp_path, _document())
    run = load_run(tmp_path)
    assert run.status is RunStatus.COMPLETE and run.asr == "fastconformer"
    assert run.engine == {"asr": "x"} and run.planned == ("c1", "c2")
    assert run.done == {"c1": "1" * 64} and run.failed == {"c2": "RuntimeError: boum"}
    assert run.manifest_sha256 == "m" * 64 and run.git == {"sha": "a" * 40, "dirty": False}


def test_le_moteur_peut_etre_inconnu_tant_qu_aucun_cas_n_a_reussi(tmp_path: Path):
    _write(tmp_path, _document(engine=None, status="interrupted", done={}))
    run = load_run(tmp_path)
    assert run.engine is None and run.status is RunStatus.INTERRUPTED


def test_run_json_absent(tmp_path: Path):
    with pytest.raises(RunError, match=r"run\.json absent"):
        load_run(tmp_path)


@pytest.mark.parametrize(
    ("document", "message"),
    [
        ("pas du json {", "illisible"),
        (["liste"], "objet JSON"),
        (_document(schema="aqr.recognition-run/0"), "schéma"),
        (_document(status="termine"), "statut"),
        (_document(planned="c1"), "planned"),
        (_document(done=["c1"]), "done"),
        (_document(done={"c1": 12}), "done"),
        (_document(failed={"c2": None}), "failed"),
        (_document(engine="whisper"), "engine"),
    ],
    ids=[
        "json",
        "racine",
        "schema",
        "statut",
        "planned",
        "done-liste",
        "done-valeur",
        "failed",
        "moteur",
    ],
)
def test_run_json_invalide_est_refuse(tmp_path: Path, document: Any, message: str):
    if isinstance(document, str):
        (tmp_path / RUN_FILE).write_text(document, encoding="utf-8")
    else:
        _write(tmp_path, document)
    with pytest.raises(RunError, match=message):
        load_run(tmp_path)


def test_ecriture_atomique_remplace_le_fichier(tmp_path: Path):
    target = tmp_path / "x.json"
    write_text_atomic(target, "un")
    write_text_atomic(target, "deux")
    assert target.read_text(encoding="utf-8") == "deux"
    assert [p.name for p in tmp_path.iterdir()] == ["x.json"]


def test_ecriture_qui_echoue_laisse_l_ancien_contenu_et_aucun_tmp(tmp_path: Path, monkeypatch):
    target = tmp_path / "x.json"
    write_text_atomic(target, "ancien")

    def boom(src: Any, dst: Any) -> None:
        raise OSError("disque plein")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(OSError, match="disque plein"):
        write_text_atomic(target, "nouveau")
    assert target.read_text(encoding="utf-8") == "ancien"
    assert [p.name for p in tmp_path.iterdir()] == ["x.json"]
