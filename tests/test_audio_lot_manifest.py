"""Garde-fous du dépôt public : manifeste du lot 1 cohérent, aucun média ni modèle versionné."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
MEDIA = re.compile(
    r"\.(mp3|m4a|wav|ogg|opus|flac|mp4|mkv|webm|onnx|pt|safetensors|nemo|bin)$", re.I
)


def test_lot1_manifest_is_well_formed() -> None:
    items = yaml.safe_load((ROOT / "docs/data-lots/lot-1.yaml").read_text("utf-8"))["fichiers"]
    assert len(items) == 12
    assert len({i["id"] for i in items}) == len(items)
    for i in items:
        assert re.fullmatch(r"[0-9a-f]{64}", i["sha256"])
        assert i["duree_s"] > 0 and i["source"].startswith("https://")


@pytest.mark.skipif(shutil.which("git") is None, reason="git requis")
def test_no_media_or_model_is_tracked() -> None:
    out = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=False
    ).stdout.splitlines()
    assert [f for f in out if MEDIA.search(f)] == []
