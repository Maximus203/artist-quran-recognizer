"""Manifeste de vérité terrain : lecture/écriture fidèles, idempotentes."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from aqr.data.manifest import (
    AudioCase,
    ExpectedItem,
    Manifest,
    ManifestError,
    NonQuranItem,
    WordRange,
)
from aqr.domain.models import NonQuranKind, Status, VerseRef


def _case(cid: str = "c1", sha: str = "a" * 64) -> AudioCase:
    return AudioCase(
        id=cid,
        file="C08/x.m4a",
        sha256=sha,
        categorie=("C08",),
        recitant="imam_a",
        riwaya="hafs",
        langues=("ar",),
        license="usage interne",
        duree_s=12.5,
        statut="annote",
        split="dev",
        expected=(
            ExpectedItem((0.0, 6.1), VerseRef(67, 4), WordRange.all(), Status.RECOGNIZED),
            ExpectedItem((6.1, 11.4), VerseRef(67, 5), WordRange(2, 5), Status.INFERRED),
        ),
        non_quran=(NonQuranItem((11.4, 12.5), NonQuranKind.FRENCH),),
    )


def test_aller_retour_fichier(tmp_path: Path):
    path = tmp_path / "manifest.yaml"
    manifest = Manifest(cases=[_case("c1"), _case("c2", "b" * 64)])
    manifest.save(path)
    loaded = Manifest.load(path)
    assert loaded.cases == manifest.cases


def test_fichier_absent_donne_un_manifeste_vide(tmp_path: Path):
    assert Manifest.load(tmp_path / "absent.yaml").cases == []


def test_format_compatible_avec_le_garde_fou_existant(tmp_path: Path):
    path = tmp_path / "m.yaml"
    Manifest(cases=[_case()]).save(path)
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert data["version"] == 1
    item = data["cases"][0]["expected"][0]
    assert item["ref"] == "67:4" and item["status"] == "recognized"
    assert item["words"] == "all" and item["t"] == [0.0, 6.1]
    assert data["cases"][0]["expected"][1]["words"] == "2-5"
    assert data["cases"][0]["non_quran"][0]["kind"] == "french"


def test_upsert_est_idempotent_par_id():
    manifest = Manifest(cases=[])
    manifest.upsert(_case())
    manifest.upsert(_case())
    assert len(manifest.cases) == 1


def test_recherche_par_sha():
    manifest = Manifest(cases=[_case("c1", "a" * 64)])
    found = manifest.by_sha("a" * 64)
    assert found is not None and found.id == "c1"
    assert manifest.by_sha("f" * 64) is None


def test_id_dupliques_refuses_au_chargement(tmp_path: Path):
    path = tmp_path / "m.yaml"
    path.write_text(
        "version: 1\ncases:\n  - {id: a, file: x, sha256: aa}\n  - {id: a, file: y, sha256: bb}\n",
        encoding="utf-8",
    )
    with pytest.raises(ManifestError, match="dupliqu"):
        Manifest.load(path)


def test_version_inconnue_refusee(tmp_path: Path):
    path = tmp_path / "m.yaml"
    path.write_text("version: 99\ncases: []\n", encoding="utf-8")
    with pytest.raises(ManifestError, match="version"):
        Manifest.load(path)


def test_plage_de_mots_invalide():
    with pytest.raises(ValueError):
        WordRange(5, 2)
    assert WordRange.parse("3-7") == WordRange(3, 7)
    assert WordRange.parse("4") == WordRange(4, 4)
    assert WordRange.parse("all").is_all


# --- provenance des annotations (docs/ANNOTATION-DEV-SET.md) -------------------------------


def _annotated(**annotation_kwargs) -> AudioCase:
    from dataclasses import replace

    from aqr.data.manifest import Annotation

    return replace(_case(), annotation=Annotation(**annotation_kwargs))


def test_annotation_aller_retour_fichier(tmp_path: Path):
    from aqr.data.manifest import Annotation

    path = tmp_path / "m.yaml"
    case = _annotated(by="human", reviewed_by="rel-01", date="2026-10-06", note="deux passes")
    Manifest(cases=[case]).save(path)
    loaded = Manifest.load(path).cases[0]
    assert loaded == case
    assert loaded.annotation == Annotation("human", "rel-01", "2026-10-06", "deux passes")
    # relu puis réécrit : octet pour octet identique
    first = path.read_text(encoding="utf-8")
    Manifest.load(path).save(path)
    assert path.read_text(encoding="utf-8") == first


def test_ancien_manifeste_sans_annotation_reste_identique(tmp_path: Path):
    path = tmp_path / "m.yaml"
    Manifest(cases=[_case()]).save(path)
    text = path.read_text(encoding="utf-8")
    assert "annotation" not in text
    assert Manifest.load(path).cases[0].annotation is None
    Manifest.load(path).save(path)
    assert path.read_text(encoding="utf-8") == text


def test_annotation_provenance_inconnue_refusee(tmp_path: Path):
    path = tmp_path / "m.yaml"
    path.write_text(
        "version: 1\ncases:\n  - {id: a, file: x, sha256: aa, annotation: {by: robot}}\n",
        encoding="utf-8",
    )
    with pytest.raises(ManifestError, match="annotation"):
        Manifest.load(path)


def test_annote_par_un_modele_refuse_au_chargement(tmp_path: Path):
    path = tmp_path / "m.yaml"
    path.write_text(
        "version: 1\ncases:\n  - {id: a, file: x, sha256: aa, statut: annote,"
        " annotation: {by: model_preannotation}}\n",
        encoding="utf-8",
    )
    with pytest.raises(ManifestError, match="préannotation"):
        Manifest.load(path)


def test_preannotation_modele_garde_a_annoter(tmp_path: Path):
    from dataclasses import replace

    from aqr.data.manifest import Annotation

    path = tmp_path / "m.yaml"
    case = replace(
        _case(), statut="a_annoter", annotation=Annotation("model_preannotation", None, None, None)
    )
    Manifest(cases=[case]).save(path)
    assert Manifest.load(path).cases[0] == case


def test_controle_humain_exige_human_et_relecteur():
    from dataclasses import replace

    from aqr.data.manifest import has_trusted_truth, provenance_problems

    ok = _annotated(by="human", reviewed_by="rel-01")
    assert provenance_problems(ok) == [] and has_trusted_truth(ok)
    assert has_trusted_truth(_case()) is False  # annote mais sans provenance
    assert "annotation" in " ".join(provenance_problems(_case()))
    no_reviewer = _annotated(by="human", reviewed_by="  ")
    assert not has_trusted_truth(no_reviewer) and "reviewed_by" in " ".join(
        provenance_problems(no_reviewer)
    )
    model = _annotated(by="model_preannotation", reviewed_by="rel-01")
    assert not has_trusted_truth(model)
    todo = replace(ok, statut="a_annoter")
    assert not has_trusted_truth(todo)


def test_cas_mix_synthetique_exempte_car_verite_construite():
    from dataclasses import replace

    from aqr.data.manifest import has_trusted_truth

    assert has_trusted_truth(replace(_case(), origine="mix"))


# --- annotation par fenêtres (extraits) ----------------------------------------------------


def test_fenetres_annotees_aller_retour_et_absentes_par_defaut(tmp_path: Path):
    from dataclasses import replace

    path = tmp_path / "m.yaml"
    Manifest(cases=[_case()]).save(path)
    assert "annotated_windows" not in path.read_text(encoding="utf-8")
    case = replace(_case(), annotated_windows=((0.0, 12.0), (30.0, 60.5)))
    Manifest(cases=[case]).save(path)
    loaded = Manifest.load(path).cases[0]
    assert loaded.annotated_windows == ((0.0, 12.0), (30.0, 60.5))
    first = path.read_text(encoding="utf-8")
    Manifest.load(path).save(path)
    assert path.read_text(encoding="utf-8") == first


def test_fenetres_invalides_refusees(tmp_path: Path):
    path = tmp_path / "m.yaml"
    path.write_text(
        "version: 1\ncases:\n  - {id: a, file: x, sha256: aa, annotated_windows: [[5, 1]]}\n",
        encoding="utf-8",
    )
    with pytest.raises(ManifestError, match="annotated_windows"):
        Manifest.load(path)
