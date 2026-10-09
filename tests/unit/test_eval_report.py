"""Provenance du rapport (machine, git, modèles, manifeste), vitesse et comparaison de bases."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

import aqr.eval.transcription as transcription
from aqr.eval.metrics import CaseResult
from aqr.eval.report import (
    BaselineRefused,
    compare_reports,
    git_state,
    machine_id,
    manifest_identity,
    models_state,
    speed_block,
)
from aqr.eval.transcription import normalization_fingerprint

ROOT = Path(__file__).resolve().parents[2]


def _result(cid: str, duration: float | None, total: float | None) -> CaseResult:
    return CaseResult(
        case_id=cid,
        categories=("C01",),
        boundaries_exact=True,
        n_reference_verses=1,
        n_reference_inferred_truth=0,
        n_found=1,
        n_recognized_predictions=1,
        n_unlocated_intervals=0,
        n_out_of_scope_intervals=0,
        false_verses=(),
        omissions=(),
        boundaries=(),
        reference_quran_s=5.0,
        abstained_s=0.0,
        duration_s=duration,
        total_s=total,
    )


def test_machine_id_donne_cpu_et_coeurs_sans_nom_d_hote():
    machine = machine_id()
    assert machine["cores"] == os.cpu_count() and machine["cores"] >= 1
    assert isinstance(machine["cpu_model"], str) and machine["cpu_model"]
    assert "hostname" not in machine and "node" not in machine


def test_git_state_sur_ce_depot_et_hors_depot(tmp_path: Path):
    state = git_state(ROOT)
    assert state["sha"] is not None and len(state["sha"]) == 40
    assert isinstance(state["dirty"], bool)
    outside = git_state(tmp_path)  # pas un dépôt : jamais d'invention
    assert outside == {"sha": None, "dirty": None}


def test_git_state_detecte_un_arbre_modifie(tmp_path: Path):
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.org",
        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.org",
    }  # fmt: skip
    for cmd in (["init", "-q"], ["commit", "-q", "--allow-empty", "-m", "x"]):
        subprocess.run(["git", *cmd], cwd=tmp_path, check=True, env=env)
    assert git_state(tmp_path)["dirty"] is False
    (tmp_path / "f.txt").write_text("x", encoding="utf-8")
    assert git_state(tmp_path)["dirty"] is True


def test_models_state_empreintes_de_lock(tmp_path: Path):
    lock = {
        "schema": 1,
        "models": {
            "asr-x": {
                "repo_id": "o/x",
                "revision": "r" * 40,
                "license": "mit",
                "files": {"w.bin": {"sha256": "ab" * 32, "size": 3}},
            }
        },
    }
    path = tmp_path / "LOCK.json"
    path.write_text(json.dumps(lock), encoding="utf-8")
    state = models_state(path)
    assert state["models"]["asr-x"] == {
        "repo_id": "o/x",
        "revision": "r" * 40,
        "files": {"w.bin": "ab" * 32},
    }
    assert len(state["lock_sha256"]) == 64
    assert models_state(tmp_path / "absent.json") == {"lock_sha256": None, "models": {}}


def test_models_state_du_depot_contient_les_modeles_epingles():
    state = models_state(ROOT / "models" / "LOCK.json")
    assert state["models"] and all(m["files"] for m in state["models"].values())


def test_manifest_identity_change_avec_le_fichier_et_avec_les_cas(tmp_path: Path):
    path = tmp_path / "m.yaml"
    path.write_text("version: 1\ncases: []\n", encoding="utf-8")
    one = manifest_identity(path, [("a", "1" * 64, "dev"), ("b", "2" * 64, "dev")])
    same = manifest_identity(path, [("b", "2" * 64, "dev"), ("a", "1" * 64, "dev")])
    assert one == same and one["name"] == "m.yaml" and len(one["sha256"]) == 64
    fewer = manifest_identity(path, [("a", "1" * 64, "dev")])
    assert fewer["cases_sha256"] != one["cases_sha256"] and fewer["sha256"] == one["sha256"]
    path.write_text("version: 1\ncases: []\n# modifié\n", encoding="utf-8")
    assert manifest_identity(path, [("a", "1" * 64, "dev")])["sha256"] != one["sha256"]


def test_speed_block_somme_des_temps_et_ram_non_mesuree():
    machine = {"cpu_model": "X", "cores": 4}
    block = speed_block(
        [_result("a", 10.0, 5.0), _result("b", 30.0, 25.0), _result("c", None, None)],
        peaks={},
        machine=machine,
    )
    assert block["wall_s"] == pytest.approx(30.0)
    assert block["audio_s"] == pytest.approx(40.0)
    assert block["realtime_factor"] == pytest.approx(0.75)  # somme / somme
    assert block["n_cases_with_timing"] == 2
    assert block["peak_ram_mb"] is None and "non mesuré" in block["peak_ram_note"]
    assert block["machine"] == machine


def test_speed_block_ram_maximale_des_cas_mesures():
    block = speed_block(
        [_result("a", 10.0, 5.0), _result("b", 10.0, 5.0)],
        peaks={"a": 900.0, "b": 1500.5},
        machine={},
    )
    assert block["peak_ram_mb"] == 1500.5 and block["peak_ram_note"] is None


def test_speed_block_sans_aucun_temps_ne_donne_pas_de_rtf():
    block = speed_block([_result("a", 10.0, None)], peaks={}, machine={})
    assert block["realtime_factor"] is None and block["wall_s"] == 0.0


# --- comparaison de deux rapports ------------------------------------------------------------


def _report(**over):
    base = {
        "schema": "aqr.evaluation/2",
        "split": "dev",
        "manifest": {"name": "m.yaml", "sha256": "m" * 64, "cases_sha256": "c" * 64},
        "normalization": {
            "version": "aqr.normalize/1",
            "strict_version": "aqr.normalize-strict/1",
            "fingerprint": "n" * 64,
        },
        "git": {"sha": "a" * 40, "dirty": False},
        "thresholds": {"match": {"min_overlap": 0.5}},
        "models": {"lock_sha256": "l" * 64, "models": {}},
        "vitesse": {"wall_s": 30.0, "realtime_factor": 0.75, "peak_ram_mb": None, "machine": {}},
        "exactitude": {
            "identification": {
                "verse_exact": {"hits": 8, "total": 10, "rate": 0.8, "ci95": [0.5, 0.9]}
            },
            "transcription": {
                "tolerante": {"wer": 0.2, "cer": 0.1},
                "strict-lettres": {"wer": 0.4},
            },
        },
    }
    base.update(over)
    return base


def test_comparaison_donne_les_deltas_des_valeurs_numeriques_communes():
    current = _report()
    baseline = _report(
        git={"sha": "b" * 40, "dirty": False},
        vitesse={"wall_s": 40.0, "realtime_factor": 1.0, "peak_ram_mb": 900.0, "machine": {}},
        exactitude={
            "identification": {
                "verse_exact": {"hits": 6, "total": 10, "rate": 0.6, "ci95": [0.3, 0.8]}
            },
            "transcription": {"tolerante": {"wer": 0.3, "cer": 0.1}},
        },
    )
    comparison = compare_reports(current, baseline)
    metrics = comparison["metrics"]
    rate = metrics["exactitude.identification.verse_exact.rate"]
    assert rate["baseline"] == 0.6 and rate["current"] == 0.8
    assert rate["delta"] == pytest.approx(0.2)
    assert metrics["exactitude.transcription.tolerante.wer"]["delta"] == pytest.approx(-0.1)
    assert metrics["vitesse.wall_s"]["delta"] == pytest.approx(-10.0)
    assert "exactitude.transcription.strict-lettres.wer" not in metrics  # absent de la base
    assert "vitesse.peak_ram_mb" not in metrics  # None d'un côté : pas de delta inventé
    assert comparison["baseline_git"] == {"sha": "b" * 40, "dirty": False}
    assert any("git" in change for change in comparison["context_changes"])


def test_comparaison_refusee_si_les_manifestes_different():
    other_file = _report(manifest={"name": "m.yaml", "sha256": "z" * 64, "cases_sha256": "c" * 64})
    with pytest.raises(BaselineRefused, match="manifeste"):
        compare_reports(_report(), other_file)
    other_cases = _report(manifest={"name": "m.yaml", "sha256": "m" * 64, "cases_sha256": "d" * 64})
    with pytest.raises(BaselineRefused, match="manifeste"):
        compare_reports(_report(), other_cases)


def test_comparaison_refusee_si_split_schema_ou_normalisation_different():
    with pytest.raises(BaselineRefused, match="split"):
        compare_reports(_report(), _report(split="test"))
    with pytest.raises(BaselineRefused, match="schéma"):
        compare_reports(_report(), _report(schema="aqr.evaluation/1"))
    changed = _report(
        normalization={
            "version": "aqr.normalize/2",
            "strict_version": "aqr.normalize-strict/1",
            "fingerprint": "n" * 64,
        }
    )
    with pytest.raises(BaselineRefused, match="normalisation"):
        compare_reports(_report(), changed)


def test_comparaison_refusee_si_seule_la_normalisation_stricte_change():
    # Une base écrite avant le correctif strict-lettres n'a pas de `strict_version` (et l'ancienne
    # « stricte » n'était que la tolérante sans dictionnaire) : ses scores ne sont pas comparables.
    before = _report(normalization={"version": "aqr.normalize/1", "fingerprint": "n" * 64})
    with pytest.raises(BaselineRefused, match="strict"):
        compare_reports(_report(), before)
    bumped = _report(
        normalization={
            "version": "aqr.normalize/1",
            "strict_version": "aqr.normalize-strict/2",
            "fingerprint": "n" * 64,
        }
    )
    with pytest.raises(BaselineRefused, match="strict"):
        compare_reports(_report(), bumped)
    assert compare_reports(_report(), _report())["metrics"]  # identique : comparable


def test_empreinte_de_normalisation_change_avec_la_version_stricte(monkeypatch):
    corrections = {"ملك": "مالك"}
    before = normalization_fingerprint(corrections)
    assert normalization_fingerprint(corrections) == before  # stable à version égale
    monkeypatch.setattr(transcription, "STRICT_NORMALIZATION_VERSION", "aqr.normalize-strict/999")
    assert normalization_fingerprint(corrections) != before


def test_empreinte_de_normalisation_change_avec_la_version_tolerante(monkeypatch):
    before = normalization_fingerprint({})
    monkeypatch.setattr(transcription, "NORMALIZATION_VERSION", "aqr.normalize/999")
    assert normalization_fingerprint({}) != before


def test_comparaison_ne_suppose_rien_quand_le_rapport_est_incomplet():
    with pytest.raises(BaselineRefused, match="manifeste"):
        compare_reports(_report(), {"schema": "aqr.evaluation/2", "split": "dev"})
