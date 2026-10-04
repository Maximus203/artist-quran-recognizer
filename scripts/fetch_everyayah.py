#!/usr/bin/env python3
"""Télécharge un sous-ensemble d'EveryAyah (récitants x sourates) avec empreintes épinglées.

    python scripts/fetch_everyayah.py                      # défaut : 3 récitants x 10 sourates
    python scripts/fetch_everyayah.py --reciters Alafasy_128kbps --surahs 1,67,108-114

Destination : $AQR_AUDIO_DIR/everyayah (hors dépôt : aucun audio dans git).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from aqr.data.everyayah import DEFAULT_SUBSET, EveryAyahSubset, parse_surahs, plan, sync


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("--reciters", help="dossiers EveryAyah séparés par des virgules")
    parser.add_argument("--surahs", help="ex. 1,67,108-114")
    parser.add_argument("--no-bismillah", action="store_true")
    parser.add_argument("--dest", type=Path, help="défaut : $AQR_AUDIO_DIR/everyayah")
    parser.add_argument(
        "--pause", type=float, default=0.2, help="secondes entre deux téléchargements"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="liste le plan sans rien télécharger"
    )
    args = parser.parse_args()

    dest = args.dest
    if dest is None:
        audio_dir = os.environ.get("AQR_AUDIO_DIR")
        if not audio_dir:
            sys.exit("Variable d'environnement manquante : AQR_AUDIO_DIR (ou passer --dest)")
        dest = Path(audio_dir) / "everyayah"

    subset = EveryAyahSubset(
        reciters=tuple(args.reciters.split(",")) if args.reciters else DEFAULT_SUBSET.reciters,
        surahs=parse_surahs(args.surahs) if args.surahs else DEFAULT_SUBSET.surahs,
        include_bismillah=not args.no_bismillah,
    )
    clips = plan(subset)
    print(f"{len(clips)} fichiers prévus vers {dest}")
    if args.dry_run:
        return 0
    report = sync(dest, subset, pause_s=args.pause)
    print(
        f"téléchargés {report.downloaded} · vérifiés {report.verified} · "
        f"épinglés (déjà présents) {report.pinned_existing} · erreurs {len(report.errors)}"
    )
    for name, message in report.errors:
        print(f"  ERREUR {name} : {message}", file=sys.stderr)
    return 1 if report.errors else 0


if __name__ == "__main__":
    sys.exit(main())
