"""Exporter un essai local de revue en ZIP autonome, sans modifier ses sources.

Le serveur Next.js écrit déjà hors Git. Ce script contrôle les empreintes avant de
préparer un transfert explicite vers un environnement de test autorisé.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import zipfile
from collections.abc import Iterable
from pathlib import Path
from typing import Any

BUNDLE_SCHEMA = "aqr.review-bundle/1"
MANIFEST_ENTRY = "manifest.json"
AUDIO_ENTRY_STEM = "audio/source"  # + l'extension du média (".mp3", ".wav", ...)
PREDICTION_ENTRY = "predictions/original.recognition.json"
CURRENT_REVIEW_ENTRY = "reviews/current.review.json"
REVIEW_ENTRY_DIR = "reviews"  # reviews/<révision>.review.json


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_chunks(chunks: Iterable[bytes]) -> str:
    digest = hashlib.sha256()
    for block in chunks:
        digest.update(block)
    return digest.hexdigest()


def sha256_file(path: Path) -> str:
    with path.open("rb") as stream:
        return sha256_chunks(iter(lambda: stream.read(1024 * 1024), b""))


def build_bundle(session_dir: Path, target: Path) -> None:
    session: dict[str, Any] = json.loads((session_dir / "session.json").read_text(encoding="utf-8"))
    extension = session["extension"]
    if not isinstance(extension, str) or not extension.startswith(".") or "/" in extension:
        raise ValueError("extension audio invalide")
    audio = session_dir / f"source{extension}"
    if sha256_file(audio) != session["audio_sha256"]:
        raise ValueError("empreinte audio incorrecte")
    files: list[tuple[Path, str]] = [(audio, f"{AUDIO_ENTRY_STEM}{extension}")]
    prediction = session_dir / "prediction.recognition.json"
    if prediction.exists():
        if sha256_file(prediction) != session["prediction_sha256"]:
            raise ValueError("empreinte prédiction incorrecte")
        files.append((prediction, PREDICTION_ENTRY))
    review = session_dir / "review.json"
    if review.exists():
        files.append((review, CURRENT_REVIEW_ENTRY))
    revisions = session_dir / "revisions"
    if revisions.exists():
        files.extend(
            (item, f"{REVIEW_ENTRY_DIR}/{item.name}")
            for item in sorted(revisions.glob("*.review.json"))
        )
    hashes = {name: sha256_file(source) for source, name in files}
    engine = None
    if prediction.exists():
        parsed = json.loads(prediction.read_text(encoding="utf-8"))
        engine = parsed.get("engine")
    manifest = {
        "schema": BUNDLE_SCHEMA,
        "session_id": session["id"],
        "source_name": session.get("name"),
        "audio_sha256": session["audio_sha256"],
        "source_kind": session.get("source_kind", "file"),
        "prediction_sha256": session.get("prediction_sha256"),
        "engine": engine,
        "files": hashes,
        "evaluation": "unavailable: partial review is not complete human ground truth",
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f"{target.name}.tmp")
    try:
        with zipfile.ZipFile(temporary, "w") as archive:
            archive.writestr(
                MANIFEST_ENTRY, json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
            )
            for source, name in files:
                compression = zipfile.ZIP_STORED if source == audio else zipfile.ZIP_DEFLATED
                archive.write(source, name, compress_type=compression)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Exporter un pack de revue vérifié")
    parser.add_argument("session_dir", type=Path)
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    build_bundle(args.session_dir, args.target)


if __name__ == "__main__":
    main()
