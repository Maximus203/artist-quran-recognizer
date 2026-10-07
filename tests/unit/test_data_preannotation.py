"""Préannotation modèle -> étiquettes Audacity + provenance (jamais présentée comme vérité)."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from aqr.data.config import DataConfig
from aqr.data.labels import LabelError, import_labels, labels_path, parse_labels
from aqr.data.manifest import AudioCase, Manifest, has_trusted_truth
from aqr.data.preannotation import (
    PreannotationRefused,
    build_preannotation,
    provenance_path,
    write_preannotation,
)
from aqr.domain.models import NonQuranKind, Status, VerseRef
from aqr.eval.recognition import parse_recognition

ROOT = Path(__file__).resolve().parents[2]
SHA = "c" * 64


def _doc(intervals):
    return {
        "schema": "aqr.recognition/1",
        "source": {"file": "lot1-05.mp3", "sha256": SHA, "duration_s": 100.0},
        "engine": {"asr": "whisper-test@abc", "constrained": False},
        "decoder": {"min_recognized_score": 0.75},
        "timing": {"total_s": 5.0},
        "intervals": intervals,
    }


INTERVALS = [
    {"kind": "non_quran", "label": "istiadha", "t": [0.5, 3.0]},
    {"kind": "verse", "ref": "42:3", "words": [1, 10], "status": "recognized",
     "t": [42.68, 59.96], "time_interpolated": False, "confidence": 1.0, "candidates": []},
    {"kind": "verse", "ref": "2:255", "words": [1, 5], "status": "recognized",
     "t": [60.0, 64.0], "time_interpolated": False, "confidence": 0.9, "candidates": []},
    {"kind": "verse", "ref": "42:4", "words": [1, 8], "status": "inferred",
     "t": [64.0, 70.0], "time_interpolated": True, "confidence": 0.5, "candidates": []},
    {"kind": "verse", "ref": "42:5", "words": [1, 8], "status": "uncertain",
     "t": [70.0, 75.0], "time_interpolated": False, "confidence": 0.4,
     "candidates": ["42:5", "6:45"]},
    {"kind": "verse", "ref": "42:6", "words": [1, 8], "status": "uncertain",
     "t": None, "time_interpolated": False, "confidence": 0.4, "candidates": ["42:6", "6:46"]},
    {"kind": "abstention", "reason": "below_threshold", "t": [75.0, 80.0], "best_score": 0.6},
    {"kind": "non_quran", "label": "unclassified", "t": [80.0, 90.0]},
]  # fmt: skip


def _full_words(ref: VerseRef) -> int | None:
    return {VerseRef(42, 3): 10}.get(ref)


def test_etiquettes_confirmables_et_non_confirmees_sont_distinctes():
    pre = build_preannotation(parse_recognition(_doc(INTERVALS)), full_word_count=_full_words)
    lines = [ln.split("\t") for ln in pre.label_text.splitlines()]
    labels = [ln[2] for ln in lines]
    assert "NON_QURAN:istiadha" in labels
    assert "42:3|recognized" in labels  # plage complète -> all
    assert "2:255[1-5]|recognized" in labels  # plage partielle conservée
    unconfirmed = [x for x in labels if x.startswith("UNCONFIRMED:")]
    assert any(":inferred:42:4" in x for x in unconfirmed)
    assert any(":uncertain:42:5" in x and "6:45" in x for x in unconfirmed)
    assert any(":abstention:below_threshold" in x for x in unconfirmed)
    assert any(":non_quran:unclassified" in x for x in unconfirmed)
    assert [float(ln[0]) for ln in lines] == sorted(float(ln[0]) for ln in lines)
    assert pre.n_unlocated == 1  # l'uncertain sans temps n'a pas d'étiquette
    assert pre.provenance["unlocated"][0]["ref"] == "42:6"


def test_provenance_dit_que_ce_n_est_pas_une_verite():
    pre = build_preannotation(parse_recognition(_doc(INTERVALS)), full_word_count=None)
    prov = pre.provenance
    assert prov["independent_truth"] is False
    assert prov["must_be_reviewed_by_human"] is True
    assert prov["produced_by"]["asr"] == "whisper-test@abc"
    assert prov["source"]["sha256"] == SHA


def test_l_import_refuse_tant_que_les_etiquettes_non_confirmees_restent():
    pre = build_preannotation(parse_recognition(_doc(INTERVALS)), full_word_count=_full_words)
    with pytest.raises(LabelError) as err:
        parse_labels(pre.label_text)
    assert any("UNCONFIRMED" in p for p in err.value.problems)


def test_aller_retour_apres_revue_humaine_des_non_confirmees():
    pre = build_preannotation(parse_recognition(_doc(INTERVALS)), full_word_count=_full_words)
    kept = "".join(
        ln + "\n" for ln in pre.label_text.splitlines() if "UNCONFIRMED" not in ln
    )  # le relecteur a supprimé/tranché les étiquettes douteuses
    expected, non_quran = parse_labels(kept)
    assert [(str(i.ref), str(i.words), i.status) for i in expected] == [
        ("42:3", "all", Status.RECOGNIZED),
        ("2:255", "1-5", Status.RECOGNIZED),
    ]
    assert expected[0].t == (42.68, 59.96)
    assert [(i.kind, i.t) for i in non_quran] == [(NonQuranKind.ISTIADHA, (0.5, 3.0))]


def _setup(tmp_path: Path, **over) -> tuple[Path, Path, Path]:
    audio_dir = tmp_path / "audio"
    audio_dir.mkdir(parents=True)
    manifest_path = tmp_path / "manifest.yaml"
    base = dict(
        id="lot1-05", file="C01/lot1-05.mp3", sha256=SHA, categorie=("C01",),
        recitant="recitant_f", riwaya="hafs", langues=("ar",), license="x",
        duree_s=100.0, split="dev",
    )  # fmt: skip
    base.update(over)
    Manifest(cases=[AudioCase(**base)]).save(manifest_path)  # type: ignore[arg-type]
    rec = tmp_path / "lot1-05.json"
    rec.write_text(json.dumps(_doc(INTERVALS)), encoding="utf-8")
    return audio_dir, manifest_path, rec


def test_ecriture_des_deux_fichiers_et_cas_inchange(tmp_path: Path):
    audio_dir, manifest_path, rec = _setup(tmp_path)
    before = manifest_path.read_text(encoding="utf-8")
    labels, prov = write_preannotation(manifest_path, audio_dir, rec)
    assert labels == labels_path(audio_dir, "lot1-05") and prov == provenance_path(
        audio_dir, "lot1-05"
    )
    assert json.loads(prov.read_text(encoding="utf-8"))["independent_truth"] is False
    assert "UNCONFIRMED" in labels.read_text(encoding="utf-8")
    assert manifest_path.read_text(encoding="utf-8") == before  # le manifeste n'est pas touché
    case = Manifest.load(manifest_path).get("lot1-05")
    assert case.statut == "a_annoter" and not case.expected


def test_ne_remplace_jamais_sans_force(tmp_path: Path):
    audio_dir, manifest_path, rec = _setup(tmp_path)
    labels, _ = write_preannotation(manifest_path, audio_dir, rec)
    labels.write_text("correction manuelle\n", encoding="utf-8")
    with pytest.raises(FileExistsError):
        write_preannotation(manifest_path, audio_dir, rec)
    assert labels.read_text(encoding="utf-8") == "correction manuelle\n"
    write_preannotation(manifest_path, audio_dir, rec, force=True)
    assert "UNCONFIRMED" in labels.read_text(encoding="utf-8")
    # un fichier de provenance existant seul bloque aussi, avant toute écriture
    labels.unlink()
    with pytest.raises(FileExistsError):
        write_preannotation(manifest_path, audio_dir, rec)
    assert not labels.exists()


def test_refus_mauvais_audio_cas_inconnu_et_jeu_test(tmp_path: Path):
    audio_dir, manifest_path, rec = _setup(tmp_path, sha256="d" * 64)
    with pytest.raises(PreannotationRefused, match="sha256"):
        write_preannotation(manifest_path, audio_dir, rec)
    audio_dir, manifest_path, rec = _setup(tmp_path / "b")
    with pytest.raises(PreannotationRefused, match="inconnu"):
        write_preannotation(manifest_path, audio_dir, rec, case_id="lot9-99")
    audio_dir, manifest_path, rec = _setup(tmp_path / "c", split="test")
    with pytest.raises(PreannotationRefused, match="test"):
        write_preannotation(manifest_path, audio_dir, rec)


def test_import_d_une_preannotation_relue_sans_relecteur_reste_non_evaluable(tmp_path: Path):
    audio_dir, manifest_path, rec = _setup(tmp_path)
    labels, _ = write_preannotation(manifest_path, audio_dir, rec)
    labels.write_text(
        "".join(ln + "\n" for ln in labels.read_text(encoding="utf-8").splitlines()
                if "UNCONFIRMED" not in ln),
        encoding="utf-8",
    )  # fmt: skip
    import_labels(manifest_path, audio_dir, "lot1-05", config=DataConfig())
    assert not has_trusted_truth(Manifest.load(manifest_path).get("lot1-05"))


def _load_script():
    spec = importlib.util.spec_from_file_location(
        "prepare_annotation", ROOT / "scripts" / "prepare_annotation.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_script_ecrit_les_fichiers_et_refuse_l_ecrasement(tmp_path: Path, capsys):
    audio_dir, manifest_path, rec = _setup(tmp_path)
    script = _load_script()
    argv = [str(rec), "--audio-dir", str(audio_dir), "--manifest", str(manifest_path)]
    assert script.main(argv) == 0
    assert labels_path(audio_dir, "lot1-05").exists()
    assert "PRÉANNOTATION" in capsys.readouterr().out
    assert script.main(argv) == 1  # existe déjà : refus, code non nul
    assert "force" in capsys.readouterr().err
    assert script.main([*argv, "--force"]) == 0
