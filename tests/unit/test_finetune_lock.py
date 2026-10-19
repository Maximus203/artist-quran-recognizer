"""Épinglage des sources de fine-tuning (révision + sha256), même discipline que les modèles."""

from __future__ import annotations

import hashlib
import json
import re
from fnmatch import fnmatch
from pathlib import Path

import pytest

from aqr.data.finetune_lock import data_files, fetch_files, pin_source, verify_files
from aqr.data.finetune_sources import FINETUNE_SOURCES, DatasetSpec, DataUnit, SourceKind
from aqr.models.lock import ModelLockError, ModelsLock
from aqr.models.sync import RemoteFile, RemoteInfo

ROOT = Path(__file__).resolve().parents[2]
SPEC = DatasetSpec(
    key="mini",
    repo_id="org/mini",
    kind=SourceKind.TADABUR,
    license="cc-by-nc-4.0",
    quran=True,
    units=(DataUnit("data/train-*.parquet", None),),
    aux=("dict.json",),
    role="test",
)
FILES = {
    "data/train-00000.parquet": b"shard0" * 50,
    "data/train-00001.parquet": b"shard1" * 50,
    "dict.json": b'{"a": 1}',
    "README.md": b"# hors motif",
}
LFS = {"data/train-00000.parquet", "data/train-00001.parquet"}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class FakeHub:
    def __init__(self, files: dict[str, bytes] | None = None, revision: str = "rev1") -> None:
        self.files = dict(files or FILES)
        self.revision = revision
        self.resolved = 0
        self.downloads: list[str] = []

    def resolve(self, repo_id: str, revision: str | None) -> RemoteInfo:
        self.resolved += 1
        return RemoteInfo(
            revision=revision or self.revision,
            files={
                name: RemoteFile(size=len(data), sha256=sha(data) if name in LFS else None)
                for name, data in self.files.items()
            },
        )

    def download(self, repo_id: str, filename: str, revision: str, dest: Path) -> None:
        self.downloads.append(filename)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(self.files[filename])


def test_epingle_sans_telecharger_les_gros_fichiers(tmp_path: Path) -> None:
    lock, hub = ModelsLock(), FakeHub()
    entry = pin_source(SPEC, lock, hub, tmp_path)
    assert entry.revision == "rev1" and entry.license == "cc-by-nc-4.0"
    assert set(entry.files) == {"data/train-00000.parquet", "data/train-00001.parquet", "dict.json"}
    assert entry.files["data/train-00001.parquet"].sha256 == sha(FILES["data/train-00001.parquet"])
    # Seul le petit fichier sans empreinte serveur est téléchargé (pour le hacher).
    assert hub.downloads == ["dict.json"]
    assert entry.files["dict.json"].sha256 == sha(FILES["dict.json"])
    assert lock.models["mini"] == entry


def test_epinglage_existant_fait_foi(tmp_path: Path) -> None:
    lock, hub = ModelsLock(), FakeHub()
    pin_source(SPEC, lock, hub, tmp_path)
    again = FakeHub(revision="rev2")
    assert pin_source(SPEC, lock, again, tmp_path).revision == "rev1"
    assert again.resolved == 0
    assert pin_source(SPEC, lock, again, tmp_path, repin=True).revision == "rev2"


def test_motif_sans_fichier_refuse(tmp_path: Path) -> None:
    with pytest.raises(ModelLockError, match="data/train-"):
        pin_source(SPEC, ModelsLock(), FakeHub({"dict.json": b"{}"}), tmp_path)


def test_selection_des_fichiers_de_donnees(tmp_path: Path) -> None:
    lock = ModelsLock()
    pin_source(SPEC, lock, FakeHub(), tmp_path)
    assert data_files(SPEC, lock) == ["data/train-00000.parquet", "data/train-00001.parquet"]
    assert data_files(SPEC, lock, max_files=1) == ["data/train-00000.parquet"]
    assert data_files(SPEC, lock, only=["data/train-00001.parquet"]) == ["data/train-00001.parquet"]
    with pytest.raises(ModelLockError, match="non épinglé"):
        data_files(SPEC, lock, only=["data/train-00009.parquet"])
    with pytest.raises(ModelLockError, match="lancer `pin`"):
        data_files(SPEC, ModelsLock())


def test_telechargement_verifie_l_empreinte(tmp_path: Path) -> None:
    lock = ModelsLock()
    pin_source(SPEC, lock, FakeHub(), tmp_path)
    hub = FakeHub()
    paths = fetch_files(SPEC, ["data/train-00001.parquet"], lock, hub, tmp_path)
    assert paths == [tmp_path / "mini" / "data/train-00001.parquet"]
    assert paths[0].read_bytes() == FILES["data/train-00001.parquet"]
    assert fetch_files(SPEC, ["data/train-00001.parquet"], lock, hub, tmp_path) == paths
    assert hub.downloads == ["data/train-00001.parquet"]  # déjà présent et conforme


def test_contenu_distant_different_refuse_sans_laisser_de_fichier(tmp_path: Path) -> None:
    lock = ModelsLock()
    pin_source(SPEC, lock, FakeHub(), tmp_path)
    tampered = FakeHub({**FILES, "data/train-00000.parquet": b"autre contenu"})
    with pytest.raises(ModelLockError, match="diffère"):
        fetch_files(SPEC, ["data/train-00000.parquet"], lock, tampered, tmp_path)
    assert not list((tmp_path / "mini").rglob("train-00000*"))


def test_fichier_local_altere_refuse(tmp_path: Path) -> None:
    lock = ModelsLock()
    pin_source(SPEC, lock, FakeHub(), tmp_path)
    target = tmp_path / "mini" / "data" / "train-00000.parquet"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"altere")
    with pytest.raises(ModelLockError, match="altéré"):
        verify_files(SPEC, ["data/train-00000.parquet"], lock, tmp_path)


def test_lock_versionne_couvre_chaque_source() -> None:
    lock = ModelsLock.load(ROOT / "data" / "finetune" / "LOCK.json")
    assert set(lock.models) == set(FINETUNE_SOURCES)
    for key, spec in FINETUNE_SOURCES.items():
        entry = lock.models[key]
        assert entry.repo_id == spec.repo_id and entry.license == spec.license
        assert re.fullmatch(r"[0-9a-f]{40}", entry.revision)
        for unit in spec.units:
            assert any(fnmatch(name, unit.pattern) for name in entry.files), unit.pattern
        assert set(spec.aux) <= set(entry.files)
        for locked in entry.files.values():
            assert re.fullmatch(r"[0-9a-f]{64}", locked.sha256) and locked.size > 0
    raw = json.loads((ROOT / "data" / "finetune" / "LOCK.json").read_text(encoding="utf-8"))
    assert raw["schema"] == 1
