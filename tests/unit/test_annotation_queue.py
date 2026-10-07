"""Garde-fou de la file d'annotation dev : dev seulement, bornes valides, budget, sans étiquette."""

from __future__ import annotations

from pathlib import Path

import yaml

from aqr.data.config import DataConfig
from aqr.data.manifest import Manifest

ROOT = Path(__file__).resolve().parents[2]
QUEUE = ROOT / "docs" / "evaluation" / "dev-annotation-queue.yaml"
MANIFEST = ROOT / "tests" / "fixtures" / "audio" / "manifest.yaml"
BASES = {"model_preannotation", "structure_du_fichier"}
ALLOWED_KEYS = {
    "id", "file", "start_s", "end_s", "category", "reason", "selection_basis", "model_hint",
    "status",
}  # fmt: skip


def _load():
    return yaml.safe_load(QUEUE.read_text(encoding="utf-8"))


def test_file_dev_uniquement_et_fenetres_valides():
    data = _load()
    manifest = Manifest.load(MANIFEST)
    ids = [e["id"] for e in data["extracts"]]
    assert len(ids) == len(set(ids))
    for e in data["extracts"]:
        case = manifest.get(e["file"])
        assert case.split == "dev", f"{e['id']} : {e['file']} n'est pas dev (jeu test réservé)"
        assert 0 <= e["start_s"] < e["end_s"]
        assert case.duree_s is not None and e["end_s"] <= case.duree_s
        assert e["category"] in DataConfig().categories
        assert e["category"] in case.categorie or e["category"] in {"C05", "C06"}
        assert e["selection_basis"] in BASES
        assert e["status"] == "todo"


def test_budget_respecte():
    data = _load()
    extracts = data["extracts"]
    assert 12 <= len(extracts) <= data["budget"]["max_extracts"]
    total_min = sum(e["end_s"] - e["start_s"] for e in extracts) / 60
    assert total_min <= data["budget"]["max_total_minutes"]
    assert all(20 <= e["end_s"] - e["start_s"] <= 300 for e in extracts)


def test_aucune_etiquette_de_verite_dans_la_file():
    for e in _load()["extracts"]:
        assert set(e) <= ALLOWED_KEYS, f"{e['id']} : clés inattendues {set(e) - ALLOWED_KEYS}"
        # un indice modèle est obligatoirement présenté comme non vérifié
        if "model_hint" in e:
            assert "non vérifié" in e["model_hint"]
            assert e["selection_basis"] == "model_preannotation"
        if e["selection_basis"] == "model_preannotation":
            assert "model_hint" in e


def test_couvre_les_situations_demandees():
    extracts = _load()["extracts"]
    files = {e["file"] for e in extracts}
    assert {"lot1-01", "lot1-03", "lot1-04", "lot1-05", "lot1-06", "lot1-09", "lot1-12"} <= files
    categories = {e["category"] for e in extracts}
    assert {"C01", "C05", "C06", "C08", "C09", "C10", "C11"} <= categories
