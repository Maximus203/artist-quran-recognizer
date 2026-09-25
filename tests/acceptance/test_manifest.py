"""Garde-fou du manifeste : il doit rester lisible et cohérent, même vide."""

from pathlib import Path

import yaml

from aqr.domain.models import Status, VerseRef

MANIFEST = Path(__file__).parents[1] / "fixtures" / "audio" / "manifest.yaml"


def test_manifeste_valide():
    data = yaml.safe_load(MANIFEST.read_text(encoding="utf-8"))
    assert data["version"] == 1
    ids = [c["id"] for c in data["cases"]]
    assert len(ids) == len(set(ids)), "identifiants de cas dupliqués"
    for case in data["cases"]:
        for item in case["expected"]:
            VerseRef.parse(item["ref"])
            Status(item["status"])
            start, end = item["t"]
            assert end > start
