"""Téléchargement des modèles à la révision épinglée, avec vérification d'empreinte."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from aqr.models.lock import (
    LockedModel,
    LockedModelFile,
    ModelLockError,
    ModelsLock,
    sha256_file,
)
from aqr.models.registry import ModelSpec


@dataclass(frozen=True)
class RemoteFile:
    size: int
    sha256: str | None
    """Empreinte annoncée par le serveur (fichiers LFS) ; None pour les petits fichiers git."""


@dataclass(frozen=True)
class RemoteInfo:
    revision: str
    files: dict[str, RemoteFile]


class Hub(Protocol):
    def resolve(self, repo_id: str, revision: str | None) -> RemoteInfo: ...
    def download(self, repo_id: str, filename: str, revision: str, dest: Path) -> None: ...


def _fetch_checked(
    hub: Hub,
    spec: ModelSpec,
    name: str,
    revision: str,
    target: Path,
    expected: str | None,
    what: str,
) -> str:
    """Télécharge dans un `.part`, vérifie, puis installe : un fichier douteux n'existe jamais."""
    part = target.with_name(target.name + ".part")
    part.parent.mkdir(parents=True, exist_ok=True)
    try:
        hub.download(spec.repo_id, name, revision, part)
        digest = sha256_file(part)
        if expected is not None and digest != expected:
            raise ModelLockError(
                f"{spec.key}/{name} : le contenu téléchargé diffère de {what} "
                f"({expected[:12]}… attendu, {digest[:12]}… reçu) : refusé."
            )
        part.replace(target)
    finally:
        part.unlink(missing_ok=True)
    return digest


def sync_model(
    spec: ModelSpec, models_dir: Path, lock: ModelsLock, hub: Hub, *, repin: bool = False
) -> LockedModel:
    """Télécharge et épingle `spec`. Le LOCK existant fait foi (révision et empreintes) ;
    seul `repin=True` accepte une nouvelle version."""
    pinned = None if repin else lock.models.get(spec.key)
    base = models_dir / spec.key

    if pinned is not None:
        missing = [f for f in spec.files if f not in pinned.files]
        if missing:
            raise ModelLockError(
                f"{spec.key} : fichiers {missing} absents du LOCK (registre modifié ?) : --repin"
            )
        for name in spec.files:
            target, locked = base / name, pinned.files[name]
            if target.exists():
                if sha256_file(target) != locked.sha256:
                    raise ModelLockError(
                        f"{spec.key}/{name} : fichier local altéré (empreinte ≠ épinglée)"
                    )
                continue
            _fetch_checked(
                hub, spec, name, pinned.revision, target, locked.sha256, "l'empreinte épinglée"
            )
        return pinned

    info = hub.resolve(spec.repo_id, None)
    files: dict[str, LockedModelFile] = {}
    for name in spec.files:
        if name not in info.files:
            raise ModelLockError(
                f"{spec.key} : {name} introuvable dans {spec.repo_id}@{info.revision[:12]}"
            )
        remote = info.files[name]
        target = base / name
        if target.exists():
            digest = sha256_file(target)
            if remote.sha256 is not None and digest != remote.sha256:
                raise ModelLockError(
                    f"{spec.key}/{name} : fichier local ≠ empreinte du serveur : le supprimer"
                )
        else:
            digest = _fetch_checked(
                hub,
                spec,
                name,
                info.revision,
                target,
                remote.sha256,
                "l'empreinte annoncée par le serveur",
            )
        files[name] = LockedModelFile(sha256=digest, size=target.stat().st_size)
    entry = LockedModel(
        repo_id=spec.repo_id, revision=info.revision, license=spec.license, files=files
    )
    lock.models[spec.key] = entry
    return entry
