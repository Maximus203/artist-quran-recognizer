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
