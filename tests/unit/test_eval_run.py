"""Protocole de lot (`run.json`) : lecture stricte et écriture atomique."""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path
from typing import Any

import pytest

from aqr.eval.run import (
    LOCK_FILE,
    RUN_FILE,
    RUN_SCHEMA,
    DirectoryBusy,
    RunError,
    RunMissing,
    RunStatus,
    exclusive_directory,
    load_run,
    write_text_atomic,
)


def _document(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "schema": RUN_SCHEMA,
        "status": "partial",
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
    assert run.status is RunStatus.PARTIAL and run.asr == "fastconformer"
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


@pytest.mark.parametrize(
    ("umask", "mode"), [(0o022, 0o644), (0o077, 0o600), (0o002, 0o664), (0o000, 0o666)]
)
def test_le_fichier_ecrit_respecte_le_umask_au_lieu_d_etre_prive(
    tmp_path: Path, umask: int, mode: int
):
    # mkstemp crée en 0600 ; les sorties du lot suivent le umask de l'utilisateur, ni plus ni moins
    target = tmp_path / "x.json"
    previous = os.umask(umask)
    try:
        write_text_atomic(target, "un")
    finally:
        os.umask(previous)
    assert stat.S_IMODE(target.stat().st_mode) == mode


def test_un_lot_complete_a_tous_ses_cas_dans_done_et_aucun_dans_failed(tmp_path: Path):
    _write(tmp_path, _document(status="complete", done={"c1": "1" * 64, "c2": "2" * 64}, failed={}))
    assert load_run(tmp_path).status is RunStatus.COMPLETE


@pytest.mark.parametrize(
    ("over", "message"),
    [
        # complete avec un cas en échec
        ({"status": "complete", "done": {"c1": "1" * 64}, "failed": {"c2": "boum"}}, "failed"),
        # complete mais un cas planifié n'a jamais été écrit
        ({"status": "complete", "done": {"c1": "1" * 64}, "failed": {}}, "complete"),
        # done contient un cas qui n'a jamais été planifié (quel que soit le statut)
        ({"status": "partial", "done": {"intrus": "9" * 64}}, "planned"),
        ({"status": "interrupted", "done": {"intrus": "9" * 64}, "failed": {}}, "planned"),
        # failed contient un cas qui n'a jamais été planifié
        ({"status": "partial", "failed": {"intrus": "boum"}}, "planned"),
        # un cas à la fois réussi et en échec
        ({"status": "partial", "done": {"c1": "1" * 64}, "failed": {"c1": "boum"}}, "c1"),
    ],
    ids=["complete+failed", "complete-incomplet", "done-hors-plan", "done-hors-plan-interrompu",
         "failed-hors-plan", "done-et-failed"],
)  # fmt: skip
def test_un_run_json_incoherent_est_refuse(tmp_path: Path, over: dict[str, Any], message: str):
    _write(tmp_path, _document(**over))
    with pytest.raises(RunError, match="incohérent") as refused:
        load_run(tmp_path)
    assert message in str(refused.value)


def test_run_json_absent_est_une_erreur_distincte_d_un_run_json_invalide(tmp_path: Path):
    with pytest.raises(RunMissing):
        load_run(tmp_path)
    (tmp_path / RUN_FILE).write_text("pas du json {", encoding="utf-8")
    with pytest.raises(RunError) as refused:
        load_run(tmp_path)
    assert not isinstance(refused.value, RunMissing)  # existant mais invalide : jamais « absent »


def test_verrou_de_dossier_exclusif_et_libere(tmp_path: Path):
    with (
        exclusive_directory(tmp_path),
        pytest.raises(DirectoryBusy, match="déjà utilisé"),
        exclusive_directory(tmp_path),
    ):
        pass  # le second verrou, pris pendant que le premier est tenu, est refusé
    with exclusive_directory(tmp_path):  # libéré en sortie
        pass
    assert (tmp_path / LOCK_FILE).exists()  # le fichier de verrou reste (jamais supprimé : course)


def test_verrou_libere_meme_si_le_corps_leve(tmp_path: Path):
    with pytest.raises(RuntimeError, match="boum"), exclusive_directory(tmp_path):
        raise RuntimeError("boum")
    with exclusive_directory(tmp_path):
        pass
