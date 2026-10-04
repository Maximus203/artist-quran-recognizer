"""Téléchargement et épinglage du corpus Tanzil (Hafs).

Séparé en deux : la logique pure (`count_verses`, `build_lock`, `source_url`) est
testée sans réseau ; `fetch_url`/`fetch_and_lock` font l'I/O réseau réelle et ne
sont pas couverts par la suite unitaire (cf. NF2).
"""

from __future__ import annotations

import datetime as dt
import urllib.request
from pathlib import Path

from aqr.corpus.checksums import CorpusLock, LockedFile, sha256_of

TANZIL_BASE = "https://tanzil.net/pub/download/index.php"

# Le fichier simple-clean est épinglé pour la provenance / vérification croisée
# uniquement. L'indexation des mots (WordSpan, matching B6) utilise la tokenisation
# Uthmani, jamais simple-clean : ~363/6236 versets ont un découpage en mots différent
# entre les deux (ex. « يَـٰٓأَيُّهَا » fusionné vs « يا أيها » séparé), voir
# .artist/decision-log.md (2026-09-25).
SOURCES: dict[str, dict[str, str]] = {
    "uthmani": {
        "path": "quran-uthmani.txt",
        "params": "quranType=uthmani&outType=txt-2&marks=true&sajdah=true&tatweel=true&agree=true",
        "purpose": "rendu (invariant I1) — texte Mushaf exact, jamais modifié",
    },
    "simple_clean": {
        "path": "quran-simple-clean.txt",
        "params": (
            "quranType=simple-clean&outType=txt-2&marks=false&sajdah=false&tatweel=false&agree=true"
        ),
        "purpose": "provenance / vérification croisée uniquement (voir decision-log)",
    },
}


def source_url(key: str) -> str:
    return f"{TANZIL_BASE}?{SOURCES[key]['params']}"


def count_verses(uthmani_raw: str) -> int:
    return sum(
        1
        for line in uthmani_raw.splitlines()
        if line and not line.startswith("#") and line.count("|") >= 2
    )


def build_lock(raw_by_key: dict[str, bytes], *, fetched_at: str | None = None) -> CorpusLock:
    if raw_by_key.keys() != SOURCES.keys():
        raise ValueError(f"sources attendues {sorted(SOURCES)}, reçues {sorted(raw_by_key)}")
    files = {
        key: LockedFile(
            path=SOURCES[key]["path"],
            url=source_url(key),
            sha256=sha256_of(data),
            quran_type=SOURCES[key]["params"].split("quranType=")[1].split("&")[0],
            purpose=SOURCES[key]["purpose"],
        )
        for key, data in raw_by_key.items()
    }
    verse_count = count_verses(raw_by_key["uthmani"].decode("utf-8"))
    return CorpusLock(
        riwaya="hafs",
        source="tanzil.net",
        fetched_at=fetched_at or dt.datetime.now(dt.UTC).isoformat(),
        verse_count=verse_count,
        files=files,
    )


def fetch_url(url: str) -> bytes:  # pragma: no cover - I/O réseau
    request = urllib.request.Request(
        url, headers={"User-Agent": "artist-quran-recognizer/0.1 (+scripts/fetch_corpus.py)"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        data: bytes = response.read()
        return data


def fetch_and_lock(out_dir: Path) -> CorpusLock:  # pragma: no cover - I/O réseau
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_by_key = {key: fetch_url(source_url(key)) for key in SOURCES}
    for key, data in raw_by_key.items():
        (out_dir / SOURCES[key]["path"]).write_bytes(data)
    lock = build_lock(raw_by_key)
    lock.save(out_dir / "LOCK.json")
    return lock
