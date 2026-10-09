"""Trace de construction du corpus de référence : `manifest.build.json`, écrit à côté du manifeste.

Le manifeste dit CE QUE contient le corpus ; la trace dit COMMENT le reproduire : graine, sel du
découpage dev/test, scénarios, dégradations, récitants retenus et écartés (avec la raison), état
de la source EveryAyah (SHA-256 de son `LOCK.json`), fichiers `speech/` et `specials/` réellement
utilisés (nom relatif + SHA-256), versions de ffmpeg et de libmp3lame, SHA git du code et commande
exacte. Rejouer la commande sur les mêmes sources redonne le même manifeste, octet pour octet
(procédure : docs/data-lots/ref-corpus-provenance.md, section « Reproduire »).

La trace est versionnable : aucun chemin local, hôte ou secret. Les chemins sont relatifs au
dépôt ou à `~` (`portable_path`), jamais absolus.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from aqr.data.config import DataConfig
from aqr.data.ingest import sha256_file
from aqr.data.manifest import AudioCase, Manifest
from aqr.data.refcorpus import Degradation, case_sources

TRACE_SCHEMA = 1
OUTSIDE = "<hors-depot>"
_FFMPEG_VERSION = re.compile(rb"ffmpeg version (\S+)")
_LAME_VERSION = re.compile(rb"LAME(\d+\.\d+(?:\.\d+)?)")
_ABSENT = "absent"


def trace_path(manifest_path: Path) -> Path:
    """`manifest.yaml` -> `manifest.build.json`, dans le même dossier."""
    return manifest_path.with_name(f"{manifest_path.stem}.build.json")


def portable_path(path: Path, repo_root: Path, home: Path) -> str:
    """Chemin sans information locale : relatif au dépôt, sinon `~/...`, sinon `<hors-depot>/x`."""
    text = str(path)
    if text == "~" or text.startswith("~/"):
        return text
    if not path.is_absolute():
        return path.as_posix()
    for base, prefix in ((repo_root, ""), (home, "~/")):
        try:
            return prefix + path.relative_to(base).as_posix()
        except ValueError:
            continue
    return f"{OUTSIDE}/{path.name}"


def _first_line(output: bytes) -> bytes:
    return output.splitlines()[0] if output else b""


def toolchain_versions() -> dict[str, str]:
    """Versions qui déterminent les octets de l'audio dégradé (ffmpeg, encodeur MP3 LAME)."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        return {"ffmpeg": _ABSENT, "libmp3lame": _ABSENT}
    version = subprocess.run([ffmpeg, "-version"], capture_output=True, check=True).stdout
    found = _FFMPEG_VERSION.search(_first_line(version))
    # l'encodeur MP3 signe son flux : on encode 0,1 s de silence et on lit la balise LAME
    coded = subprocess.run(
        [
            *(ffmpeg, "-nostdin", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono"),
            *("-t", "0.1", "-c:a", "libmp3lame", "-b:a", "32k", "-f", "mp3", "-"),
        ],
        capture_output=True,
    ).stdout
    lame = _LAME_VERSION.search(coded)
    return {
        "ffmpeg": found.group(1).decode() if found else "inconnue",
        "libmp3lame": lame.group(1).decode() if lame else _ABSENT,
    }


def _source_files(manifest: Manifest) -> list[dict[str, Any]]:
    seen: dict[tuple[str, str, str], dict[str, Any]] = {}
    for case in manifest.cases:
        for source in case_sources(case):
            entry = {key: source[key] for key in ("kind", "file", "sha256") if key in source}
            seen[(str(entry.get("kind")), str(entry.get("file", "")), entry["sha256"])] = entry
    return [seen[key] for key in sorted(seen)]


def _splits(cases: Sequence[AudioCase]) -> dict[str, str | None]:
    return dict(sorted({case.recitant: case.split for case in cases}.items()))


def build_trace(
    *,
    manifest: Manifest,
    manifest_path: Path,
    out_dir: Path,
    seed: int,
    per_scenario: int,
    scenarios: Sequence[str],
    degradations: Sequence[Degradation],
    config: DataConfig,
    retained: Sequence[str],
    excluded: Sequence[tuple[str, str]],
    skipped: Sequence[tuple[str, str]],
    removed: Sequence[tuple[str, str]],
    environment: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    lock = out_dir / "everyayah" / "LOCK.json"
    return {
        "schema": TRACE_SCHEMA,
        "manifest": manifest_path.name,
        "parameters": {
            "seed": seed,
            "per_scenario": per_scenario,
            "scenarios": list(scenarios),
            "split_seed": config.split_seed,
            "dev_ratio": config.dev_ratio,
            "sample_rate": config.sample_rate,
            "tolerance_ms": config.tolerance_ms,
            "degradations": [d.to_dict() for d in degradations],
        },
        "reciters": {
            "retained": sorted(retained),
            "excluded": [{"name": n, "reason": r} for n, r in sorted(excluded)],
        },
        "splits": _splits(manifest.cases),
        "skipped": [{"name": n, "reason": r} for n, r in skipped],
        "removed": [{"name": n, "reason": r} for n, r in removed],
        "sources": {
            "everyayah_lock_sha256": sha256_file(lock) if lock.exists() else None,
            "files": _source_files(manifest),
        },
        "toolchain": toolchain_versions(),
        "environment": dict(environment or {}),
    }


def write_trace(path: Path, trace: Mapping[str, Any]) -> None:
    """JSON stable (clés triées, UTF-8, saut de ligne final) : un rejeu identique ne change rien."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(trace, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8"
    )
