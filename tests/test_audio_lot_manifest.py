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


# --- import local (sans réseau) -------------------------------------------------------------


def _load_audio_lot():
    import importlib.util

    spec = importlib.util.spec_from_file_location("audio_lot", ROOT / "scripts" / "audio_lot.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_import_local_verifie_le_sha_et_ecrit_les_fiches(tmp_path: Path, monkeypatch) -> None:
    import hashlib

    audio_lot = _load_audio_lot()
    src, inbox = tmp_path / "src" / "lot-1", tmp_path / "inbox"
    src.mkdir(parents=True)
    contents = {"lot1-01": b"un", "lot1-02": b"deux"}
    manifest = [
        {
            "id": cid,
            "sha256": hashlib.sha256(data).hexdigest(),
            "categorie": ["C09"],
            "recitant": "orateur_x",
            "riwaya": "inconnu",
            "langues": ["fr"],
            "source": "https://exemple.test/" + cid,
        }
        for cid, data in contents.items()
    ]
    for cid, data in contents.items():
        (src / f"{cid}.mp3").write_bytes(data)
    monkeypatch.setattr(audio_lot, "load_manifest", lambda lot: manifest)

    audio_lot.import_local(1, tmp_path / "src", inbox)

    assert (inbox / "lot1-01.mp3").read_bytes() == b"un"
    sidecar = yaml.safe_load((inbox / "lot1-02.yaml").read_text("utf-8"))
    assert sidecar["fichier"] == "lot1-02.mp3" and sidecar["categorie"] == ["C09"]
    assert "usage interne" in sidecar["droits"]


def test_import_local_refuse_un_fichier_absent_ou_altere(tmp_path: Path, monkeypatch) -> None:
    import hashlib

    audio_lot = _load_audio_lot()
    src = tmp_path / "src"
    src.mkdir()
    item = {
        "id": "lot1-01",
        "sha256": hashlib.sha256(b"attendu").hexdigest(),
        "categorie": ["C09"],
        "recitant": "x",
        "riwaya": "inconnu",
        "langues": ["fr"],
        "source": "https://exemple.test",
    }
    monkeypatch.setattr(audio_lot, "load_manifest", lambda lot: [item])
    (src / "lot1-01.mp3").write_bytes(b"altere")
    with pytest.raises(SystemExit, match="lot1-01"):
        audio_lot.import_local(1, src, tmp_path / "inbox")
    assert not (tmp_path / "inbox" / "lot1-01.mp3").exists()
