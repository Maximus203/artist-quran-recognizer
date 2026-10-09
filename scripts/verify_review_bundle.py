"""Vérifier un pack de revue ZIP (`aqr.review-bundle/1`) produit par `export_review_bundle.py`.

Contrôle le contenu réel de l'archive, pas des sous-chaînes : entrées attendues, empreintes
SHA-256 recalculées, cohérence manifeste / entrées / prédiction, et, si `--source` est donné,
égalité avec un fichier de référence indépendant (l'audio d'origine, jamais relu depuis le pack).
Lève `ValueError` avec la raison précise ; la ligne de commande sort en 1.

    python -m scripts.verify_review_bundle pack.zip --source audio.wav   # depuis la racine
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
import zlib
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any

from scripts.export_review_bundle import (
    AUDIO_ENTRY_STEM,
    BUNDLE_SCHEMA,
    MANIFEST_ENTRY,
    PREDICTION_ENTRY,
    REVIEW_ENTRY_DIR,
    sha256_bytes,
    sha256_chunks,
    sha256_file,
)

from aqr.pipeline.output import SCHEMA as RECOGNITION_SCHEMA

_SHA256 = re.compile(r"[0-9a-f]{64}")
_AUDIO_ENTRY = re.compile(rf"{re.escape(AUDIO_ENTRY_STEM)}\.[A-Za-z0-9]+")
_REVIEW_ENTRY = re.compile(rf"{re.escape(REVIEW_ENTRY_DIR)}/[A-Za-z0-9._-]+\.review\.json")
_SOURCE_KINDS = {"file", "microphone"}
MAX_MANIFEST_BYTES = 1 << 20  # le manifeste est petit (quelques entrées d'empreintes)
MAX_JSON_ENTRY_BYTES = 64 << 20  # prédiction et révisions de revue : JSON, jamais l'audio
_CHUNK_BYTES = 1 << 20


def verify_bundle(
    bundle: Path, source: Path | None = None, *, require_prediction: bool = True
) -> dict[str, Any]:
    """Vérifie `bundle` ; renvoie un résumé (session, empreintes, entrées) ou lève ValueError.

    Mémoire bornée : le manifeste (<= MAX_MANIFEST_BYTES) et les autres entrées JSON
    (<= MAX_JSON_ENTRY_BYTES) sont refusés d'après leur taille annoncée puis relus avec la même
    limite ; l'audio est haché par blocs. Une archive hostile ou corrompue donne une ValueError,
    jamais une MemoryError ni une erreur zlib."""
    try:
        return _verify(bundle, source, require_prediction)
    except (MemoryError, NotImplementedError, zlib.error, zipfile.BadZipFile, RuntimeError) as exc:
        raise ValueError(
            f"pack illisible ou corrompu : {bundle} ({type(exc).__name__}: {exc})"
        ) from exc


def _chunks(archive: zipfile.ZipFile, name: str, limit: int | None) -> Iterator[bytes]:
    """Lit `name` par blocs ; au-delà de `limit` octets réellement décompressés : ValueError."""
    total = 0
    with archive.open(name) as stream:
        for block in iter(lambda: stream.read(_CHUNK_BYTES), b""):
            total += len(block)
            if limit is not None and total > limit:
                raise ValueError(f"entrée trop volumineuse : {name} (plus de {limit} octets)")
            yield block


def _read_json_entry(archive: zipfile.ZipFile, name: str, limit: int) -> bytes:
    return b"".join(_chunks(archive, name, limit))


def _verify(bundle: Path, source: Path | None, require_prediction: bool) -> dict[str, Any]:
    try:
        archive = zipfile.ZipFile(bundle)
    except (zipfile.BadZipFile, OSError) as exc:
        raise ValueError(f"pack illisible : {bundle} ({exc})") from exc
    with archive:
        names = archive.namelist()
        duplicated = sorted({name for name in names if names.count(name) > 1})
        if duplicated:
            raise ValueError(f"entrée en double dans le pack : {duplicated}")
        if MANIFEST_ENTRY not in names:
            raise ValueError(f"{MANIFEST_ENTRY} absent du pack")
        _check_declared_size(archive, MANIFEST_ENTRY, MAX_MANIFEST_BYTES)
        manifest = _manifest(_read_json_entry(archive, MANIFEST_ENTRY, MAX_MANIFEST_BYTES))
        entries = [name for name in names if name != MANIFEST_ENTRY]
        listed: dict[str, str] = manifest["files"]
        for name in entries:
            if not _expected_entry_name(name):
                raise ValueError(f"entrée inattendue : {name!r}")
        for name in listed:
            if not _expected_entry_name(name):
                raise ValueError(f"entrée inattendue dans le manifeste : {name!r}")
        if missing := sorted(set(listed) - set(entries)):
            raise ValueError(f"entrée listée mais manquante dans le pack : {missing}")
        if unlisted := sorted(set(entries) - set(listed)):
            raise ValueError(f"entrée non listée dans le manifeste : {unlisted}")
        digests: dict[str, str] = {}
        prediction_raw: bytes | None = None
        for name in entries:
            # seul l'audio peut être gros ; tout JSON est plafonné (taille annoncée puis réelle)
            limit = None if _AUDIO_ENTRY.fullmatch(name) else MAX_JSON_ENTRY_BYTES
            if limit is not None:
                _check_declared_size(archive, name, limit)
            if name == PREDICTION_ENTRY:
                prediction_raw = _read_json_entry(archive, name, MAX_JSON_ENTRY_BYTES)
                digests[name] = sha256_bytes(prediction_raw)
            else:
                digests[name] = sha256_chunks(_chunks(archive, name, limit))
    for name, digest in digests.items():
        if digest != listed[name]:
            raise ValueError(f"empreinte incorrecte pour {name} : {digest} != {listed[name]}")

    audio_entries = [name for name in entries if _AUDIO_ENTRY.fullmatch(name)]
    if len(audio_entries) != 1:
        raise ValueError(f"une seule entrée audio attendue, trouvé {audio_entries}")
    audio_sha = digests[audio_entries[0]]
    if manifest["audio_sha256"] != audio_sha:
        raise ValueError(f"audio_sha256 du manifeste ({manifest['audio_sha256']}) != {audio_sha}")
    if source is not None:
        try:
            reference_sha = sha256_file(source)
        except OSError as exc:
            raise ValueError(f"fichier de référence illisible : {source} ({exc})") from exc
        if reference_sha != audio_sha:
            raise ValueError(
                f"l'audio du pack ({audio_sha}) diffère du fichier de référence {source.name}"
            )
    prediction_sha = _check_prediction(
        manifest, prediction_raw, digests, audio_sha, require_prediction
    )
    return {
        "session_id": manifest["session_id"],
        "source_kind": manifest["source_kind"],
        "audio_sha256": audio_sha,
        "prediction_sha256": prediction_sha,
        "entries": sorted(entries),
    }


def _check_declared_size(archive: zipfile.ZipFile, name: str, limit: int) -> None:
    declared = archive.getinfo(name).file_size
    if declared > limit:
        raise ValueError(
            f"entrée trop volumineuse : {name} ({declared} octets annoncés, plafond {limit})"
        )


def _expected_entry_name(name: str) -> bool:
    return bool(
        _AUDIO_ENTRY.fullmatch(name) or name == PREDICTION_ENTRY or _REVIEW_ENTRY.fullmatch(name)
    )


def _manifest(raw: bytes) -> dict[str, Any]:
    try:
        manifest = json.loads(raw)
    except ValueError as exc:
        raise ValueError(f"{MANIFEST_ENTRY} illisible : {exc}") from exc
    if not isinstance(manifest, dict) or manifest.get("schema") != BUNDLE_SCHEMA:
        schema = manifest.get("schema") if isinstance(manifest, dict) else manifest
        raise ValueError(f"schéma du manifeste inattendu : {schema!r} (attendu {BUNDLE_SCHEMA})")
    session_id = manifest.get("session_id")
    if not isinstance(session_id, str) or not session_id:
        raise ValueError("session_id absent ou vide dans le manifeste")
    if manifest.get("source_kind") not in _SOURCE_KINDS:
        raise ValueError(f"source_kind invalide : {manifest.get('source_kind')!r}")
    files = manifest.get("files")
    if not isinstance(files, dict) or not all(
        isinstance(name, str) and isinstance(sha, str) and _SHA256.fullmatch(sha)
        for name, sha in files.items()
    ):
        raise ValueError("« files » du manifeste doit associer chaque entrée à un SHA-256 hex")
    if not isinstance(manifest.get("audio_sha256"), str) or not _SHA256.fullmatch(
        manifest["audio_sha256"]
    ):
        raise ValueError("audio_sha256 du manifeste absent ou invalide")
    return manifest


def _check_prediction(
    manifest: dict[str, Any],
    prediction_raw: bytes | None,
    digests: dict[str, str],
    audio_sha: str,
    require_prediction: bool,
) -> str | None:
    if prediction_raw is None:
        if require_prediction:
            raise ValueError(f"prédiction absente du pack ({PREDICTION_ENTRY})")
        if manifest.get("prediction_sha256") is not None:
            raise ValueError("prediction_sha256 annoncé mais aucune prédiction dans le pack")
        return None
    prediction_sha = digests[PREDICTION_ENTRY]
    if manifest.get("prediction_sha256") != prediction_sha:
        claimed = manifest.get("prediction_sha256")
        raise ValueError(f"prediction_sha256 du manifeste ({claimed}) != {prediction_sha}")
    try:
        prediction = json.loads(prediction_raw)
    except ValueError as exc:
        raise ValueError(f"prédiction illisible : {exc}") from exc
    if not isinstance(prediction, dict) or prediction.get("schema") != RECOGNITION_SCHEMA:
        raise ValueError(f"prédiction : schéma différent de {RECOGNITION_SCHEMA}")
    declared = (prediction.get("source") or {}).get("sha256")
    if not isinstance(declared, str) or declared.lower() != audio_sha:
        raise ValueError(
            f"prédiction : source.sha256 ({declared!r}) != audio du pack ({audio_sha})"
        )
    if manifest.get("engine") != prediction.get("engine"):
        raise ValueError("engine du manifeste différent de celui de la prédiction")
    return prediction_sha


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Vérifier un pack de revue ZIP")
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--source", type=Path, help="audio de référence indépendant du pack")
    parser.add_argument(
        "--allow-no-prediction", action="store_true", help="accepter un pack sans prédiction"
    )
    args = parser.parse_args(argv)
    try:
        summary = verify_bundle(
            args.bundle, args.source, require_prediction=not args.allow_no_prediction
        )
    except ValueError as exc:
        print(f"ÉCHEC pack : {exc}", file=sys.stderr)
        return 1
    print(
        f"OK pack : session {summary['session_id']}, {len(summary['entries'])} entrées, "
        f"audio {summary['audio_sha256'][:12]}…" + (f" = {args.source.name}" if args.source else "")
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
