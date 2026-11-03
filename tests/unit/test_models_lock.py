"""models/LOCK.json : modèles épinglés (révision + sha256), vérifiés au téléchargement."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from aqr.models.lock import ModelLockError, ModelsLock, verify_model_files
from aqr.models.registry import MODELS, ModelSpec
from aqr.models.sync import RemoteFile, RemoteInfo, sync_model

SPEC = ModelSpec(
    key="mini",
    repo_id="org/mini",
    files=("config.json", "weights.bin"),
    license="mit",
    role="test",
)
REMOTE_FILES = {"config.json": b'{"a": 1}', "weights.bin": b"\x00\x01poids" * 100}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class FakeHub:
    """Résolveur + téléchargeur factices (aucun réseau)."""

    def __init__(self, revision: str = "rev1", files: dict[str, bytes] | None = None) -> None:
        self.revision = revision
        self.files = dict(files or REMOTE_FILES)
        self.downloads: list[tuple[str, str]] = []

    def resolve(self, repo_id: str, revision: str | None) -> RemoteInfo:
        rev = revision or self.revision
        return RemoteInfo(
            revision=rev,
            files={
                name: RemoteFile(
                    size=len(data), sha256=sha(data) if name == "weights.bin" else None
                )
                for name, data in self.files.items()
            },
        )

    def download(self, repo_id: str, filename: str, revision: str, dest: Path) -> None:
        self.downloads.append((filename, revision))
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(self.files[filename])


def test_premier_passage_telecharge_et_epingle(tmp_path: Path):
    hub = FakeHub()
    lock = ModelsLock()
    sync_model(SPEC, tmp_path, lock, hub)
    entry = lock.models["mini"]
    assert entry.revision == "rev1" and entry.repo_id == "org/mini"
    assert entry.files["weights.bin"].sha256 == sha(REMOTE_FILES["weights.bin"])
    assert entry.files["config.json"].sha256 == sha(REMOTE_FILES["config.json"])
    assert (tmp_path / "mini" / "weights.bin").exists()


def test_relance_ne_retelecharge_rien(tmp_path: Path):
    hub, lock = FakeHub(), ModelsLock()
    sync_model(SPEC, tmp_path, lock, hub)
    hub.downloads.clear()
    sync_model(SPEC, tmp_path, lock, hub)
    assert hub.downloads == []


def test_revision_epinglee_fait_foi_meme_si_le_depot_a_avance(tmp_path: Path):
    lock = ModelsLock()
    sync_model(SPEC, tmp_path, lock, FakeHub(revision="rev1"))
    (tmp_path / "mini" / "weights.bin").unlink()
    hub2 = FakeHub(revision="rev2")  # le dépôt distant a une nouvelle tête
    sync_model(SPEC, tmp_path, lock, hub2)
    assert hub2.downloads == [("weights.bin", "rev1")]  # téléchargé à la révision épinglée


def test_contenu_distant_different_de_l_empreinte_epinglee_est_refuse(tmp_path: Path):
    lock = ModelsLock()
    sync_model(SPEC, tmp_path, lock, FakeHub())
    (tmp_path / "mini" / "weights.bin").unlink()
    tampered = FakeHub(files={**REMOTE_FILES, "weights.bin": b"autre contenu"})
    with pytest.raises(ModelLockError, match=r"weights\.bin"):
        sync_model(SPEC, tmp_path, lock, tampered)
    assert not (tmp_path / "mini" / "weights.bin").exists()  # rien d'écrit de suspect


def test_fichier_local_altere_est_detecte(tmp_path: Path):
    lock = ModelsLock()
    sync_model(SPEC, tmp_path, lock, FakeHub())
    (tmp_path / "mini" / "weights.bin").write_bytes(b"corrompu")
    with pytest.raises(ModelLockError, match=r"weights\.bin"):
        verify_model_files(tmp_path, "mini", lock)


def test_hash_serveur_discordant_au_premier_telechargement(tmp_path: Path):
    class Lying(FakeHub):
        def download(self, repo_id, filename, revision, dest):  # type: ignore[no-untyped-def]
            super().download(repo_id, filename, revision, dest)
            if filename == "weights.bin":
                dest.write_bytes(b"corrompu en route")

    with pytest.raises(ModelLockError, match="serveur"):
        sync_model(SPEC, tmp_path, ModelsLock(), Lying())


def test_lock_aller_retour_json(tmp_path: Path):
    lock = ModelsLock()
    sync_model(SPEC, tmp_path, lock, FakeHub())
    path = tmp_path / "LOCK.json"
    lock.save(path)
    assert ModelsLock.load(path) == lock
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["schema"] == 1 and "mini" in data["models"]


def test_lock_absent_donne_un_lock_vide(tmp_path: Path):
    assert ModelsLock.load(tmp_path / "nope.json").models == {}


def test_registre_des_trois_modeles_epingles_avec_licence():
    assert {"fastconformer-quran", "whisper-base-quran", "recitation-segmenter"} <= set(MODELS)
    assert MODELS["fastconformer-quran"].files == ("phase3_full/phase3_full_wer0.0014.nemo",)
    assert all(spec.license for spec in MODELS.values())
