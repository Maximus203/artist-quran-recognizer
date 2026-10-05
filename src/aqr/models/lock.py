"""`models/LOCK.json` : révision Git et SHA-256 de chaque fichier de modèle, versionné.

Même discipline que le corpus : un fichier local altéré ou un contenu distant qui ne correspond
plus à l'empreinte épinglée est une erreur explicite, jamais une substitution silencieuse.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

SCHEMA = 1


class ModelLockError(RuntimeError):
    pass


@dataclass(frozen=True)
class LockedModelFile:
    sha256: str
    size: int


@dataclass(frozen=True)
class LockedModel:
    repo_id: str
    revision: str
    license: str
    files: dict[str, LockedModelFile]


@dataclass
class ModelsLock:
    models: dict[str, LockedModel] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> ModelsLock:
        if not path.exists():
            return cls()
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("schema") != SCHEMA:
            raise ModelLockError(
                f"schéma de LOCK {data.get('schema')!r} non géré (attendu {SCHEMA})"
            )
        return cls(
            {
                key: LockedModel(
                    repo_id=m["repo_id"],
                    revision=m["revision"],
                    license=m["license"],
                    files={n: LockedModelFile(**f) for n, f in m["files"].items()},
                )
                for key, m in data["models"].items()
            }
        )

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema": SCHEMA,
            "models": {
                key: {
                    "repo_id": m.repo_id,
                    "revision": m.revision,
                    "license": m.license,
                    "files": {n: vars(f) for n, f in sorted(m.files.items())},
                }
                for key, m in sorted(self.models.items())
            },
        }
        fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                json.dump(payload, handle, indent=2, ensure_ascii=False)
                handle.write("\n")
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 22), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_model_files(models_dir: Path, key: str, lock: ModelsLock) -> None:
    """Vérifie que tous les fichiers épinglés de `key` existent et correspondent à leur SHA-256."""
    if key not in lock.models:
        raise ModelLockError(
            f"modèle {key!r} absent de models/LOCK.json (lancer scripts/fetch_models.py)"
        )
    for name, locked in lock.models[key].files.items():
        path = models_dir / key / name
        if not path.exists():
            raise ModelLockError(f"{key}/{name} manquant (lancer scripts/fetch_models.py)")
        if sha256_file(path) != locked.sha256:
            raise ModelLockError(
                f"{key}/{name} : empreinte ≠ épinglée (fichier altéré ou autre version)"
            )
