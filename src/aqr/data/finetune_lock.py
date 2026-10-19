"""`data/finetune/LOCK.json` : révision et SHA-256 de chaque fichier des sources de fine-tuning.

Même schéma et même discipline que `models/LOCK.json` (`aqr.models.lock`) : le LOCK fait foi, un
contenu différent est refusé, un fichier douteux n'est jamais installé. Une différence : on épingle
SANS télécharger les gros fichiers (Tadabur : 385 × 2,4 Go), avec l'empreinte LFS annoncée par le
serveur, qui est le SHA-256 du contenu ; le contrôle local a lieu au téléchargement. Les petits
fichiers sans empreinte serveur sont téléchargés pour être hachés.
"""

from __future__ import annotations

from fnmatch import fnmatch
from pathlib import Path

from aqr.data.finetune_sources import DatasetSpec
from aqr.models.lock import LockedModel, LockedModelFile, ModelLockError, ModelsLock, sha256_file
from aqr.models.sync import Hub, fetch_checked


def _pinned(spec: DatasetSpec, lock: ModelsLock) -> LockedModel:
    entry = lock.models.get(spec.key)
    if entry is None:
        raise ModelLockError(f"{spec.key} absent de data/finetune/LOCK.json : lancer `pin`")
    return entry


def pin_source(
    spec: DatasetSpec,
    lock: ModelsLock,
    hub: Hub,
    raw_dir: Path,
    *,
    revision: str | None = None,
    repin: bool = False,
) -> LockedModel:
    """Épingle les fichiers de `spec` (motifs des unités + `aux`). Le LOCK existant fait foi ;
    seul `repin=True` accepte une nouvelle version."""
    if not repin and spec.key in lock.models:
        return lock.models[spec.key]
    info = hub.resolve(spec.repo_id, revision)
    wanted: list[str] = []
    for unit in spec.units:
        matches = sorted(name for name in info.files if fnmatch(name, unit.pattern))
        if not matches:
            raise ModelLockError(
                f"{spec.key} : aucun fichier « {unit.pattern} » dans "
                f"{spec.repo_id}@{info.revision[:12]}"
            )
        wanted.extend(matches)
    for name in spec.aux:
        if name not in info.files:
            raise ModelLockError(f"{spec.key} : {name} introuvable dans {spec.repo_id}")
        wanted.append(name)
    files: dict[str, LockedModelFile] = {}
    for name in dict.fromkeys(wanted):
        remote = info.files[name]
        if remote.sha256 is not None:
            files[name] = LockedModelFile(sha256=remote.sha256, size=remote.size)
            continue
        target = raw_dir / spec.key / name
        digest = fetch_checked(
            hub, spec.repo_id, spec.key, name, info.revision, target, None, "rien (épinglage)"
        )
        files[name] = LockedModelFile(sha256=digest, size=target.stat().st_size)
    entry = LockedModel(
        repo_id=spec.repo_id, revision=info.revision, license=spec.license, files=files
    )
    lock.models[spec.key] = entry
    return entry


def data_files(
    spec: DatasetSpec,
    lock: ModelsLock,
    *,
    max_files: int | None = None,
    only: list[str] | None = None,
) -> list[str]:
    """Fichiers de données épinglés (hors `aux`), triés ; `only` ou les `max_files` premiers."""
    entry = _pinned(spec, lock)
    names = sorted(
        name for name in entry.files if any(fnmatch(name, u.pattern) for u in spec.units)
    )
    if only is not None:
        unknown = [name for name in only if name not in names]
        if unknown:
            raise ModelLockError(f"{spec.key} : fichier(s) non épinglé(s) : {unknown}")
        return [name for name in names if name in only]
    return names[:max_files] if max_files is not None else names


def verify_files(spec: DatasetSpec, names: list[str], lock: ModelsLock, raw_dir: Path) -> None:
    """Chaque fichier présent localement doit avoir l'empreinte épinglée."""
    entry = _pinned(spec, lock)
    for name in names:
        path = raw_dir / spec.key / name
        if path.exists() and sha256_file(path) != entry.files[name].sha256:
            raise ModelLockError(f"{spec.key}/{name} : fichier local altéré (empreinte ≠ épinglée)")


def fetch_files(
    spec: DatasetSpec, names: list[str], lock: ModelsLock, hub: Hub, raw_dir: Path
) -> list[Path]:
    """Télécharge les fichiers absents à la révision épinglée, vérifie ceux déjà présents."""
    entry = _pinned(spec, lock)
    verify_files(spec, names, lock, raw_dir)
    paths: list[Path] = []
    for name in names:
        target = raw_dir / spec.key / name
        if not target.exists():
            fetch_checked(
                hub,
                spec.repo_id,
                spec.key,
                name,
                entry.revision,
                target,
                entry.files[name].sha256,
                "l'empreinte épinglée",
            )
        paths.append(target)
    return paths
