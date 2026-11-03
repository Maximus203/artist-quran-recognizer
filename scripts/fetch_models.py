#!/usr/bin/env python3
"""Télécharge les modèles à la révision épinglée (models/LOCK.json) dans $AQR_MODELS_DIR.

    python scripts/fetch_models.py                       # tous les modèles du registre
    python scripts/fetch_models.py --only recitation-segmenter
    python scripts/fetch_models.py --only whisper-base-quran --repin   # nouvelle version

Premier passage : la tête du dépôt est téléchargée puis ÉPINGLÉE (révision + SHA-256 de chaque
fichier, recoupé avec l'empreinte du serveur pour les fichiers LFS). Ensuite le LOCK fait foi :
un contenu différent est refusé. Jamais de poids dans git : seul LOCK.json est versionné.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from aqr.models.hf_hub import HfHub
from aqr.models.lock import ModelLockError, ModelsLock
from aqr.models.registry import MODELS
from aqr.models.sync import sync_model

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--only", help=f"séparés par des virgules ({', '.join(MODELS)})")
    parser.add_argument("--repin", action="store_true", help="accepter une nouvelle version")
    parser.add_argument("--models-dir", type=Path, help="défaut : $AQR_MODELS_DIR")
    parser.add_argument("--lock", type=Path, default=ROOT / "models" / "LOCK.json")
    args = parser.parse_args()

    models_dir = args.models_dir or (
        Path(os.environ["AQR_MODELS_DIR"]) if os.environ.get("AQR_MODELS_DIR") else None
    )
    if models_dir is None:
        sys.exit("Variable d'environnement manquante : AQR_MODELS_DIR (ou --models-dir)")
    keys = args.only.split(",") if args.only else list(MODELS)
    unknown = [k for k in keys if k not in MODELS]
    if unknown:
        sys.exit(f"modèle(s) inconnu(s) : {unknown} (connus : {list(MODELS)})")

    lock = ModelsLock.load(args.lock)
    hub = HfHub()
    failed = 0
    for key in keys:
        try:
            entry = sync_model(MODELS[key], models_dir, lock, hub, repin=args.repin)
        except (ModelLockError, OSError, RuntimeError) as exc:
            print(f"ERREUR {key} : {exc}", file=sys.stderr)
            failed += 1
            continue
        lock.save(args.lock)
        total = sum(f.size for f in entry.files.values()) / 1e6
        print(f"ok {key} @ {entry.revision[:12]} · {len(entry.files)} fichier(s) · {total:.0f} Mo")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
