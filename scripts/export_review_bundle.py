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
from pathlib import Path
from typing import Any


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def build_bundle(session_dir: Path, target: Path) -> None:
    session: dict[str, Any] = json.loads((session_dir / "session.json").read_text(encoding="utf-8"))
    extension = session["extension"]
    if not isinstance(extension, str) or not extension.startswith(".") or "/" in extension:
        raise ValueError("extension audio invalide")
    audio = session_dir / f"source{extension}"
    if _sha256(audio) != session["audio_sha256"]:
        raise ValueError("empreinte audio incorrecte")
    files: list[tuple[Path, str]] = [(audio, f"audio/source{extension}")]
    prediction = session_dir / "prediction.recognition.json"
    if prediction.exists():
        if _sha256(prediction) != session["prediction_sha256"]:
            raise ValueError("empreinte prédiction incorrecte")
        files.append((prediction, "predictions/original.recognition.json"))
    review = session_dir / "review.json"
    if review.exists():
        files.append((review, "reviews/current.review.json"))
    revisions = session_dir / "revisions"
    if revisions.exists():
        files.extend(
            (item, f"reviews/{item.name}") for item in sorted(revisions.glob("*.review.json"))
        )
    hashes = {name: _sha256(source) for source, name in files}
    manifest = {
        "schema": "aqr.review-bundle/1",
        "session_id": session["id"],
        "source_name": session.get("name"),
        "audio_sha256": session["audio_sha256"],
        "prediction_sha256": session.get("prediction_sha256"),
        "files": hashes,
        "evaluation": "unavailable: partial review is not complete human ground truth",
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f"{target.name}.tmp")
    try:
        with zipfile.ZipFile(temporary, "w") as archive:
            archive.writestr(
                "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
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
