"""Téléchargement d'un lot audio depuis un dataset Hugging Face PUBLIC, à révision épinglée.

Aucun jeton : l'URL de téléchargement contient la révision Git (immuable), pas « main ». Chaque
fichier est vérifié contre l'empreinte SHA-256 du manifeste du lot (`docs/data-lots/lot-N.yaml`)
avant d'être installé ; un contenu différent, un fichier local altéré ou un transfert coupé sont
des erreurs explicites, jamais une substitution silencieuse (même discipline que le corpus,
EveryAyah et les modèles). Les audios ne sont jamais versionnés ni republiés ailleurs.
"""

from __future__ import annotations

import hashlib
import os
import tempfile
import urllib.request
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

Fetcher = Callable[[str], bytes]
HeadRevision = Callable[[str], str]


class LotFetchError(RuntimeError):
    pass


@dataclass(frozen=True)
class LotItem:
    id: str
    sha256: str


@dataclass(frozen=True)
class PublicLotSource:
    repo: str  # « utilisateur/nom »
    revision: str  # SHA de commit complet du dataset

    def url(self, item_id: str) -> str:
        return f"https://huggingface.co/datasets/{self.repo}/resolve/{self.revision}/{item_id}.mp3"


@dataclass(frozen=True)
class FetchResult:
    id: str
    status: str  # « telecharge » | « deja_present »
    sha256_ok: bool
    size: int
    remote_head_moved: bool | None = None


def http_fetch(url: str) -> bytes:  # pragma: no cover - I/O réseau
    request = urllib.request.Request(url, headers={"User-Agent": "artist-quran-recognizer/0.1"})
    with urllib.request.urlopen(request, timeout=120) as response:
        body: bytes = response.read()
        return body


def hf_head_revision(repo: str) -> str:  # pragma: no cover - I/O réseau
    import json

    url = f"https://huggingface.co/api/datasets/{repo}"
    with urllib.request.urlopen(url, timeout=30) as response:
        sha: str = json.load(response)["sha"]
        return sha


def _sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_public_lot(
    items: Sequence[LotItem],
    source: PublicLotSource,
    dest: Path,
    fetcher: Fetcher = http_fetch,
    head_revision: HeadRevision | None = None,
) -> list[FetchResult]:
    """Télécharge et vérifie chaque fichier. Lève `LotFetchError` (après avoir traité les autres
    fichiers) si au moins un fichier est refusé ; un fichier refusé n'est jamais installé."""
    dest.mkdir(parents=True, exist_ok=True)
    moved: bool | None = None
    if head_revision is not None:
        moved = head_revision(source.repo) != source.revision
    results: list[FetchResult] = []
    errors: list[str] = []
    for item in items:
        target = dest / f"{item.id}.mp3"
        if target.exists():
            if _sha256_of(target) == item.sha256:
                results.append(
                    FetchResult(item.id, "deja_present", True, target.stat().st_size, moved)
                )
            else:
                errors.append(
                    f"{item.id} : fichier local altéré (empreinte différente du manifeste)"
                )
            continue
        try:
            payload = fetcher(source.url(item.id))
        except OSError as exc:
            errors.append(f"{item.id} : téléchargement impossible ({exc})")
            continue
        if hashlib.sha256(payload).hexdigest() != item.sha256:
            errors.append(f"{item.id} : empreinte différente du manifeste, fichier refusé")
            continue
        fd, part_name = tempfile.mkstemp(dir=dest, prefix=f"{item.id}.", suffix=".part")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(payload)
            os.replace(part_name, target)
        finally:
            if os.path.exists(part_name):
                os.unlink(part_name)
        results.append(FetchResult(item.id, "telecharge", True, len(payload), moved))
    if errors:
        raise LotFetchError("; ".join(errors))
    return results
