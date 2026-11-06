"""Télécharge le modèle de traduction arabe → français de la parole libre (ADR-0027).

`Helsinki-NLP/opus-mt-ar-fr` (Marian, licence CC-BY-4.0, environ 300 Mo) est copié dans
`<AQR_MODELS_DIR>/opus-mt-ar-fr`. Les empreintes SHA-256 des fichiers sont écrites dans
`LOCK.json` à côté des poids. Le transcripteur (Whisper large-v3) vient du cache faster-whisper.

Usage : python scripts/fetch_free_speech_models.py [--models-dir DIR] [--yes]
Sans `--yes`, le script dit ce qu'il télécharge et s'arrête : aucun téléchargement implicite.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

REPO = "Helsinki-NLP/opus-mt-ar-fr"
NAME = "opus-mt-ar-fr"
PATTERNS = [
    "config.json",
    "generation_config.json",
    "pytorch_model.bin",
    "source.spm",
    "target.spm",
    "tokenizer_config.json",
    "vocab.json",
]


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--models-dir", type=Path)
    parser.add_argument("--yes", action="store_true", help="confirmer le téléchargement")
    args = parser.parse_args(argv)
    models = args.models_dir or (
        Path(os.environ["AQR_MODELS_DIR"]) if os.environ.get("AQR_MODELS_DIR") else None
    )
    if models is None:
        print("Variable manquante : AQR_MODELS_DIR (ou --models-dir)", file=sys.stderr)
        return 2
    target = models / NAME
    print(f"Source : https://huggingface.co/{REPO} (CC-BY-4.0, ~300 Mo)\nCible  : {target}")
    if not args.yes:
        print("Rien téléchargé : relancer avec --yes pour confirmer.")
        return 0
    from huggingface_hub import snapshot_download

    snapshot_download(repo_id=REPO, local_dir=str(target), allow_patterns=PATTERNS)
    paths = sorted(p for p in target.iterdir() if p.is_file() and p.name != "LOCK.json")
    files = {p.name: sha256_of(p) for p in paths}
    (target / "LOCK.json").write_text(
        json.dumps({"repo": REPO, "files": files}, indent=1) + "\n", encoding="utf-8"
    )
    print(f"{len(files)} fichier(s) écrit(s), empreintes dans {target / 'LOCK.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
