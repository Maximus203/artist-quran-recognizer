"""Épinglage et vérification des checksums du corpus (invariant I1 : jamais un texte

non vérifié). Utilisé par `aqr.corpus.fetch` (écriture) et `TanzilCorpusRepository`
(lecture + vérification à chaque chargement).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class CorpusChecksumError(Exception):
    """Un fichier de corpus est absent ou ne correspond pas au checksum épinglé."""


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_of_file(path: Path) -> str:
    return sha256_of(path.read_bytes())


@dataclass(frozen=True)
class LockedFile:
    path: str
    url: str
    sha256: str
    quran_type: str
    purpose: str


@dataclass(frozen=True)
class CorpusLock:
    riwaya: str
    source: str
    fetched_at: str
    verse_count: int
    files: dict[str, LockedFile] = field(default_factory=dict)

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> CorpusLock:
        files = {key: LockedFile(**value) for key, value in data["files"].items()}
        return cls(
            riwaya=data["riwaya"],
            source=data["source"],
            fetched_at=data["fetched_at"],
            verse_count=data["verse_count"],
            files=files,
        )

    @classmethod
    def load(cls, path: Path) -> CorpusLock:
        return cls.from_json(json.loads(path.read_text(encoding="utf-8")))

    def to_json(self) -> dict[str, Any]:
        return {
            "riwaya": self.riwaya,
            "source": self.source,
            "fetched_at": self.fetched_at,
            "verse_count": self.verse_count,
            "files": {key: vars(locked) for key, locked in self.files.items()},
        }

    def save(self, path: Path) -> None:
        path.write_text(
            json.dumps(self.to_json(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    def verify(self, corpus_dir: Path) -> None:
        """Vérifie que chaque fichier épinglé existe et correspond à son checksum (F9)."""
        for key, locked in self.files.items():
            file_path = corpus_dir / locked.path
            if not file_path.exists():
                raise CorpusChecksumError(
                    f"fichier de corpus manquant : {file_path} "
                    "(relancer `python scripts/fetch_corpus.py`)"
                )
            actual = sha256_of_file(file_path)
            if actual != locked.sha256:
                raise CorpusChecksumError(
                    f"checksum invalide pour {file_path} ({key}) : "
                    f"attendu {locked.sha256}, obtenu {actual}"
                )
