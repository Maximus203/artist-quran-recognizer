"""EveryAyah : récitations verset par verset, sous-ensemble configurable (DATA-COLLECTION §0).

Source des clips « un verset par fichier » (libres, non collectés à la main) servant à fabriquer
les mixages synthétiques (`aqr.data.mixer`). Les empreintes SHA-256 sont épinglées au premier
téléchargement dans `LOCK.json` : ensuite, un fichier local altéré OU un contenu distant qui a
changé est une erreur explicite, jamais une substitution silencieuse (comme le corpus).
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from aqr.domain.models import VerseRef
from aqr.domain.quran_structure import SURAH_COUNT, ayah_count

EVERYAYAH_BASE = "https://everyayah.com/data"
BISMILLAH_FILENAME = "bismillah.mp3"
LOCK_NAME = "LOCK.json"

Fetcher = Callable[[str], bytes]


class EveryAyahError(RuntimeError):
    pass


@dataclass(frozen=True)
class EveryAyahSubset:
    reciters: tuple[str, ...]
    surahs: tuple[int, ...]
    include_bismillah: bool = True

    def __post_init__(self) -> None:
        if not self.reciters:
            raise ValueError("au moins un récitant est requis")
        bad = [s for s in self.surahs if not 1 <= s <= SURAH_COUNT]
        if not self.surahs or bad:
            raise ValueError(f"sourates invalides : {bad or 'aucune'}")


DEFAULT_SUBSET = EveryAyahSubset(
    reciters=("Alafasy_128kbps", "Husary_128kbps", "Abdul_Basit_Murattal_192kbps"),
    surahs=(1, 67, 97, 103, 108, 109, 110, 112, 113, 114),
)
"""Petit pour commencer : 3 récitants × 10 sourates (courtes + Al-Mulk pour les trous/sauts)."""


@dataclass(frozen=True)
class ClipSpec:
    reciter: str
    filename: str

    @property
    def key(self) -> str:
        return f"{self.reciter}/{self.filename}"

    @property
    def url(self) -> str:
        return clip_url(self.reciter, self.filename)


def clip_filename(ref: VerseRef) -> str:
    return f"{ref.surah:03d}{ref.ayah:03d}.mp3"


def clip_url(reciter: str, filename: str) -> str:
    return f"{EVERYAYAH_BASE}/{reciter}/{filename}"


def verse_clip_path(dest: Path, reciter: str, ref: VerseRef) -> Path:
    return dest / reciter / clip_filename(ref)


def bismillah_clip_path(dest: Path, reciter: str) -> Path:
    return dest / reciter / BISMILLAH_FILENAME


def parse_surahs(text: str) -> tuple[int, ...]:
    """« 1,67,108-110 » -> (1, 67, 108, 109, 110)."""
    out: list[int] = []
    for part in text.split(","):
        part = part.strip()
        if "-" in part:
            low, high = part.split("-", 1)
            out.extend(range(int(low), int(high) + 1))
        else:
            out.append(int(part))
    return tuple(out)


def plan(subset: EveryAyahSubset) -> list[ClipSpec]:
    clips: list[ClipSpec] = []
    for reciter in subset.reciters:
        if subset.include_bismillah:
            clips.append(ClipSpec(reciter, BISMILLAH_FILENAME))
        for surah in subset.surahs:
            for ayah in range(1, ayah_count(surah) + 1):
                clips.append(ClipSpec(reciter, clip_filename(VerseRef(surah, ayah))))
    return clips


def fetch_url(url: str) -> bytes:  # pragma: no cover - I/O réseau
    request = urllib.request.Request(
        url, headers={"User-Agent": "artist-quran-recognizer/0.1 (+scripts/fetch_everyayah.py)"}
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        data: bytes = response.read()
    return data


@dataclass
class SyncReport:
    downloaded: int = 0
    verified: int = 0
    pinned_existing: int = 0
    errors: list[tuple[str, str]] = field(default_factory=list)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _looks_like_mp3(data: bytes) -> bool:
    return bool(data) and not data.lstrip().startswith(b"<")


def _read_lock(path: Path) -> dict[str, dict[str, object]]:
    if not path.exists():
        return {}
    files = json.loads(path.read_text(encoding="utf-8")).get("files", {})
    return dict(files)


def _write_lock(path: Path, files: dict[str, dict[str, object]]) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump({"source": EVERYAYAH_BASE, "files": files}, handle, indent=1, sort_keys=True)
            handle.write("\n")
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def sync(
    dest: Path, subset: EveryAyahSubset, *, fetch: Fetcher = fetch_url, pause_s: float = 0.2
) -> SyncReport:
    """Télécharge ce qui manque, vérifie le reste ; un fichier en erreur n'arrête pas les autres."""
    try:
        dest.mkdir(parents=True, exist_ok=True)
    except (FileExistsError, NotADirectoryError) as exc:
        raise EveryAyahError(f"dossier de destination inutilisable : {dest}") from exc
    lock_path = dest / LOCK_NAME
    lock = _read_lock(lock_path)
    report = SyncReport()

    for clip in plan(subset):
        target = dest / clip.reciter / clip.filename
        pinned = lock.get(clip.key)
        if target.exists():
            digest = _sha256(target.read_bytes())
            if pinned is None:
                lock[clip.key] = {"sha256": digest, "bytes": target.stat().st_size}
                report.pinned_existing += 1
                _write_lock(lock_path, lock)
            elif pinned["sha256"] != digest:
                report.errors.append((clip.key, "fichier local altéré : empreinte ≠ épinglée"))
            else:
                report.verified += 1
            continue

        try:
            data = fetch(clip.url)
        except Exception as exc:  # réseau/HTTP : un échec ne bloque pas le lot
            report.errors.append((clip.key, f"téléchargement impossible : {exc}"))
            continue
        if not _looks_like_mp3(data):
            report.errors.append((clip.key, "réponse vide ou page HTML au lieu d'un MP3"))
            continue
        digest = _sha256(data)
        if pinned is not None and pinned["sha256"] != digest:
            report.errors.append(
                (clip.key, "le contenu distant a changé depuis l'empreinte épinglée (refusé)")
            )
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        lock[clip.key] = {"sha256": digest, "bytes": len(data)}
        _write_lock(lock_path, lock)
        report.downloaded += 1
        if pause_s:
            time.sleep(pause_s)
    return report
