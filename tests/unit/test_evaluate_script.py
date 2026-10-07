"""scripts/evaluate.py de bout en bout : manifeste et prédictions synthétiques."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from aqr.data.manifest import (
    Annotation,
    AudioCase,
    ExpectedItem,
    Manifest,
    NonQuranItem,
    WordRange,
)
from aqr.domain.models import NonQuranKind, Status, VerseRef

ROOT = Path(__file__).resolve().parents[2]


def _script():
    spec = importlib.util.spec_from_file_location("evaluate", ROOT / "scripts" / "evaluate.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _case(cid: str, split: str, *, human: bool, sha: str | None = None) -> AudioCase:
    return AudioCase(
        id=cid,
        file=f"C01/{cid}.mp3",
        sha256=sha or cid[-1] * 64,
        categorie=("C01",),
        recitant=f"r_{cid}",
        riwaya="hafs",
        langues=("ar",),
        license="x",
        duree_s=100.0,
        statut="annote" if human else "a_annoter",
        split=split,
        expected=(
            (ExpectedItem((0.0, 6.0), VerseRef(67, 4), WordRange.all(), Status.RECOGNIZED),) * human
        ),
        non_quran=((NonQuranItem((6.0, 12.0), NonQuranKind.FRENCH),) if human else ()),
        annotation=Annotation("human", "rel-01") if human else None,
    )


def _prediction(case: AudioCase, intervals, sha: str | None = None) -> dict:
    return {
        "schema": "aqr.recognition/1",
        "source": {"file": f"{case.id}.mp3", "sha256": sha or case.sha256, "duration_s": 100.0},
        "engine": {"asr": "synthetic"},
        "decoder": {},
        "timing": {"total_s": 20.0},
        "intervals": intervals,
    }


VERSE_OK = {
    "kind": "verse",
    "ref": "67:4",
    "words": [1, 10],
    "status": "recognized",
    "t": [0.0, 6.0],
    "time_interpolated": False,
    "confidence": 1.0,
    "candidates": [],
}
VERSE_FALSE = {**VERSE_OK, "ref": "1:2", "t": [7.0, 10.0]}


@pytest.fixture()
def world(tmp_path: Path):
    cases = [
        _case("devA", "dev", human=True),
        _case("devB", "dev", human=False),  # non annoté : ignoré, jamais compté
        _case("tesA", "test", human=True),
    ]
    manifest = tmp_path / "manifest.yaml"
    Manifest(cases=cases).save(manifest)
    preds = tmp_path / "preds"
    preds.mkdir()
    (preds / "devA.json").write_text(
        json.dumps(_prediction(cases[0], [VERSE_OK, VERSE_FALSE])), encoding="utf-8"
    )
    (preds / "devB.json").write_text(json.dumps(_prediction(cases[1], [VERSE_OK])), "utf-8")
    (preds / "tesA.json").write_text(json.dumps(_prediction(cases[2], [VERSE_OK])), "utf-8")
    return tmp_path, manifest, preds


def _run(manifest, preds, out, *extra):
    script = _script()
    return script.main(
        [
            "--manifest", str(manifest),
            "--predictions", str(preds),
            "--out", str(out),
            "--min-reference-verses", "5",
            *extra,
        ]
    )  # fmt: skip


def test_dev_calcule_sur_les_seuls_cas_annotes_humainement(world, capsys):
    tmp, manifest, preds = world
    out = tmp / "report.json"
    assert _run(manifest, preds, out, "--split", "dev") == 0
    report = json.loads(out.read_text(encoding="utf-8"))
    overall = report["aggregate"]["overall"]
    assert overall["n_cases"] == 1 and overall["n_reference_verses"] == 1
    assert overall["n_false_verses"] == 1 and overall["n_recognized_predictions"] == 2
    assert overall["false_verse_rate"] == pytest.approx(0.5)
    assert overall["defensible"] is False  # 1 verset < 5 : échantillon trop petit
    assert report["split"] == "dev" and report["final"] is False
    assert report["policy"]["min_overlap"] == 0.5
    assert [s["id"] for s in report["skipped"]] == ["devB"]
    assert "pas évaluable" in report["skipped"][0]["reason"]
    printed = capsys.readouterr().out
    assert "1 cas" in printed and "1 verset" in printed and "non défendable" in printed


def test_le_jeu_test_est_refuse_sans_final(world, capsys):
    tmp, manifest, preds = world
    out = tmp / "report.json"
    assert _run(manifest, preds, out, "--split", "test") == 2
    assert not out.exists()
    assert "réservé" in capsys.readouterr().err
    assert _run(manifest, preds, out, "--split", "test", "--final") == 0
    assert json.loads(out.read_text(encoding="utf-8"))["final"] is True


def test_aucun_cas_annote_ne_donne_aucune_metrique_et_code_non_nul(tmp_path: Path, capsys):
    manifest = tmp_path / "m.yaml"
    Manifest(cases=[_case("devB", "dev", human=False)]).save(manifest)
    preds = tmp_path / "p"
    preds.mkdir()
    out = tmp_path / "r.json"
    assert _run(manifest, preds, out) != 0
    assert "aucun cas annoté par un humain : aucune métrique" in capsys.readouterr().err
    report = json.loads(out.read_text(encoding="utf-8"))
    assert report["aggregate"] is None and report["cases"] == []


def test_une_annotation_de_modele_n_ouvre_pas_la_porte(tmp_path: Path, capsys):
    from dataclasses import replace

    case = replace(
        _case("devA", "dev", human=True), annotation=Annotation("model_preannotation", None)
    )
    case = replace(case, statut="a_annoter")
    manifest = tmp_path / "m.yaml"
    Manifest(cases=[case]).save(manifest)
    preds = tmp_path / "p"
    preds.mkdir()
    (preds / "devA.json").write_text(json.dumps(_prediction(case, [VERSE_OK])), "utf-8")
    assert _run(manifest, preds, tmp_path / "r.json") != 0
    assert "aucune métrique" in capsys.readouterr().err


def test_prediction_manquante_et_mauvais_audio(world, capsys):
    tmp, manifest, preds = world
    (preds / "devA.json").unlink()
    out = tmp / "r.json"
    assert _run(manifest, preds, out) != 0  # rien d'évalué
    report = json.loads(out.read_text(encoding="utf-8"))
    assert report["missing_predictions"] == ["devA"] and report["aggregate"] is None
    case = _case("devA", "dev", human=True)
    (preds / "devA.json").write_text(
        json.dumps(_prediction(case, [VERSE_OK], sha="f" * 64)), encoding="utf-8"
    )
    assert _run(manifest, preds, out) == 1
    report = json.loads(out.read_text(encoding="utf-8"))
    assert report["refused"][0]["id"] == "devA" and "sha256" in report["refused"][0]["reason"]


def test_seuil_de_versets_obligatoire(world):
    _, manifest, preds = world
    with pytest.raises(SystemExit):
        _script().main(["--manifest", str(manifest), "--predictions", str(preds)])
