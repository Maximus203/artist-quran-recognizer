"""Écriture dans le manifeste des passages alignés puis validés à l'oreille (étape A, ADR-0006).

Le cas est retrouvé par l'empreinte de l'audio ; seuls des fichiers DEV sont annotés (protocole
docs/ANNOTATION-DEV-SET.md) ; le relecteur est un identifiant anonyme ; une revalidation remplace
les versets de la même fenêtre sans toucher au reste.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from aqr.data.alignment_import import AlignmentImportError, import_alignment
from aqr.data.config import DataConfig
from aqr.data.manifest import (
    Annotation,
    AudioCase,
    ExpectedItem,
    Manifest,
    WordRange,
    has_trusted_truth,
)
from aqr.domain.models import Status, VerseRef

SHA = "ab" * 32


def case(**overrides) -> AudioCase:
    base = {
        "id": "lot1-06",
        "file": "C08/lot1-06.mp3",
        "sha256": SHA,
        "categorie": ("C08",),
        "recitant": "imam_e",
        "riwaya": "hafs",
        "langues": ("ar",),
        "license": "usage interne",
        "duree_s": 3128.6,
        "split": "dev",
    }
    base.update(overrides)
    return AudioCase(**base)  # type: ignore[arg-type]


def write(tmp_path: Path, *cases: AudioCase) -> Path:
    path = tmp_path / "manifest.yaml"
    Manifest(cases=list(cases)).save(path)
    return path


def passage(t, spans, **extra):
    return {"declared": "x", "t": t, "variant": "simple", "evidence": {}, "spans": spans, **extra}


def span(ref, t, words=(1, 9), partial=False):
    return {"ref": ref, "words": list(words), "partial": partial, "t": list(t), "word_times": []}


def document(*passages, sha=SHA):
    return {
        "schema": "aqr.alignment/2",
        "source": {"file": "a.mp3", "sha256": sha, "duration_s": 3128.6},
        "engine": {"model": "fastconformer-quran@b33af7936f9a/ctc"},
        "config": {"energy_ratio": 0.1},
        "passages": list(passages),
    }


def run(path: Path, doc, reviewed_by="rel-01"):
    return import_alignment(
        path, doc, reviewed_by=reviewed_by, date="2026-10-19", config=DataConfig()
    )


def test_premier_import_rend_le_cas_evaluable_sur_ses_fenetres(tmp_path):
    path = write(tmp_path, case())
    doc = document(
        passage([46.0, 160.0], [span("21:51", (47.1, 56.7)), span("21:52", (57.4, 68.0))]),
        passage([200.0, 230.0], [span("22:1", (201.0, 220.0), words=(5, 16), partial=False)]),
    )
    report = run(path, doc)
    saved = Manifest.load(path).get("lot1-06")
    assert report.case_id == "lot1-06" and report.verses == 3
    assert saved.statut == "annote" and has_trusted_truth(saved)
    assert saved.annotation == Annotation("human", "rel-01", "2026-10-19", saved.annotation.note)
    assert saved.annotated_windows == ((46.0, 160.0), (200.0, 230.0))
    first = saved.expected[0]
    assert first.ref == VerseRef(21, 51) and first.words.is_all and first.t == (47.1, 56.7)
    assert first.status is Status.RECOGNIZED


def test_plage_partielle_et_reprise(tmp_path):
    path = write(tmp_path, case())
    doc = document(
        passage(
            [90.0, 106.0],
            [
                span("21:56", (91.8, 99.9)),
                span("21:56", (100.1, 104.9), words=(5, 8), partial=True),
            ],
        )
    )
    run(path, doc)
    expected = Manifest.load(path).get("lot1-06").expected
    assert [str(e.words) for e in expected] == ["all", "5-8"]


def test_revalidation_remplace_la_fenetre_et_garde_le_reste(tmp_path):
    path = write(tmp_path, case())
    run(path, document(passage([46.0, 160.0], [span("21:51", (47.1, 56.7))])))
    run(path, document(passage([200.0, 230.0], [span("22:1", (201.0, 220.0))])))
    run(path, document(passage([40.0, 100.0], [span("21:52", (57.4, 68.0))])))
    saved = Manifest.load(path).get("lot1-06")
    assert [str(e.ref) for e in saved.expected] == ["21:52", "22:1"]
    assert saved.annotated_windows == ((40.0, 160.0), (200.0, 230.0))


def test_une_preannotation_modele_est_remplacee_pas_fusionnee(tmp_path):
    old = ExpectedItem((1.0, 2.0), VerseRef(1, 1), WordRange.all(), Status.RECOGNIZED)
    path = write(tmp_path, case(expected=(old,), annotation=Annotation("model_preannotation")))
    run(path, document(passage([46.0, 60.0], [span("21:51", (47.1, 56.7))])))
    saved = Manifest.load(path).get("lot1-06")
    assert [str(e.ref) for e in saved.expected] == ["21:51"]


@pytest.mark.parametrize("split", ["test", "quarantaine", None])
def test_seul_le_jeu_dev_est_annote(tmp_path, split):
    path = write(tmp_path, case(split=split))
    with pytest.raises(AlignmentImportError, match="dev"):
        run(path, document(passage([46.0, 60.0], [span("21:51", (47.1, 56.7))])))
    assert Manifest.load(path).get("lot1-06").statut == "a_annoter"


def test_audio_absent_du_manifeste(tmp_path):
    path = write(tmp_path, case())
    with pytest.raises(AlignmentImportError, match="manifeste"):
        run(path, document(passage([0.0, 5.0], [span("1:1", (0.1, 4.0))]), sha="cd" * 32))


@pytest.mark.parametrize("who", ["", "Cherif Diouf", "a" * 40])
def test_relecteur_identifiant_anonyme(tmp_path, who):
    path = write(tmp_path, case())
    with pytest.raises(AlignmentImportError, match="relecteur"):
        run(path, document(passage([0.0, 5.0], [span("1:1", (0.1, 4.0))])), reviewed_by=who)


def test_passage_en_erreur_ou_hors_duree_refuse(tmp_path):
    path = write(tmp_path, case())
    with pytest.raises(AlignmentImportError, match="erreur"):
        run(path, document({"declared": "1:1", "t": [0.0, 5.0], "error": "ne tient pas"}))
    with pytest.raises(AlignmentImportError, match="durée"):
        run(path, document(passage([3120.0, 3200.0], [span("1:1", (3121.0, 3125.0))])))
    with pytest.raises(AlignmentImportError, match="schéma"):
        run(path, {"schema": "aqr.alignment/1"})


def test_cli_import_alignment_sans_dossier_audio(tmp_path):
    import io
    import json

    from aqr.cli import main

    path = write(tmp_path, case())
    alignment = tmp_path / "a.alignment.json"
    doc = document(passage([46.0, 60.0], [span("21:51", (47.1, 56.7))]))
    alignment.write_text(json.dumps(doc), encoding="utf-8")
    out, err = io.StringIO(), io.StringIO()
    argv = ["data", "--manifest", str(path), "import-alignment", str(alignment)]
    code = main([*argv, "--reviewed-by", "rel-01"], env={}, out=out, err=err)
    assert code == 0, err.getvalue()
    assert "lot1-06 : 1 verset(s)" in out.getvalue()
    code = main([*argv, "--reviewed-by", "Cherif"], env={}, out=out, err=err)
    assert code == 1 and "relecteur" in err.getvalue()


def formula(label, t):
    return {"kind": "non_quran", "label": label, "t": list(t), "word_times": []}


def test_formules_ecrites_comme_zones_non_coraniques(tmp_path):
    from aqr.domain.models import NonQuranKind

    path = write(tmp_path, case())
    doc = document(
        passage(
            [0.0, 60.0],
            [
                formula("takbir", (2.6, 5.4)),
                span("1:7", (31.0, 41.0)),
                formula("amin", (42.0, 44.5)),
            ],
        )
    )
    report = run(path, doc)
    saved = Manifest.load(path).get("lot1-06")
    assert report.verses == 1
    assert [(z.kind, z.t) for z in saved.non_quran] == [
        (NonQuranKind.TAKBIR, (2.6, 5.4)),
        (NonQuranKind.AMIN, (42.0, 44.5)),
    ]
    # revalidation de la fenêtre : les anciennes zones de la fenêtre sont remplacées
    run(path, document(passage([0.0, 60.0], [span("1:7", (31.0, 41.0))])))
    assert Manifest.load(path).get("lot1-06").non_quran == ()
