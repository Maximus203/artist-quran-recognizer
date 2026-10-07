#!/usr/bin/env python3
"""Préannote un audio à partir d'une sortie `aqr.recognition/1` (jamais une vérité terrain).

    python scripts/prepare_annotation.py sortie/lot1-05.json --audio-dir "$AQR_AUDIO_DIR"

Écrit `<audio_dir>/labels/<id>.txt` (étiquettes Audacity à corriger à l'oreille) et
`<audio_dir>/labels/<id>.provenance.json` (`independent_truth: false`). Ne modifie pas le
manifeste. N'écrase jamais un fichier existant sans `--force`. Refuse le jeu test.
Voir docs/ANNOTATION-DEV-SET.md.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from aqr.data.preannotation import PreannotationRefused, write_preannotation

ROOT = Path(__file__).resolve().parents[1]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("recognition", type=Path, help="sortie JSON aqr.recognition/1")
    parser.add_argument("--audio-dir", type=Path, help="défaut : $AQR_AUDIO_DIR")
    parser.add_argument(
        "--manifest", type=Path, default=ROOT / "tests/fixtures/audio/manifest.yaml"
    )
    parser.add_argument("--case-id", help="défaut : nom du fichier source de la sortie")
    parser.add_argument(
        "--corpus", type=Path, default=ROOT / "data" / "corpus", help="pour écrire `all`"
    )
    parser.add_argument("--force", action="store_true", help="écraser des étiquettes existantes")
    args = parser.parse_args(argv)
    audio_dir = args.audio_dir or (
        Path(os.environ["AQR_AUDIO_DIR"]) if os.environ.get("AQR_AUDIO_DIR") else None
    )
    if audio_dir is None:
        print(
            "Variable d'environnement manquante : AQR_AUDIO_DIR (ou --audio-dir)", file=sys.stderr
        )
        return 2
    try:
        labels, provenance = write_preannotation(
            args.manifest,
            audio_dir,
            args.recognition,
            case_id=args.case_id,
            corpus_dir=args.corpus,
            force=args.force,
        )
    except PreannotationRefused as exc:
        print(f"Refusé : {exc}", file=sys.stderr)
        return 1
    except FileExistsError as exc:
        print(f"Refusé : {exc}", file=sys.stderr)
        return 1
    print(
        f"PRÉANNOTATION MODÈLE (pas une vérité) : {labels}\n"
        f"provenance : {provenance}\n"
        "Corriger dans Audacity, trancher les étiquettes UNCONFIRMED:*, puis importer "
        "avec un relecteur humain (docs/ANNOTATION-DEV-SET.md)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
