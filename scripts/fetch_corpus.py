#!/usr/bin/env python3
"""Télécharge le corpus Tanzil (Hafs, Uthmani + simple-clean) et épingle les
checksums dans data/corpus/LOCK.json.

Usage :
    python scripts/fetch_corpus.py [--out data/corpus]
"""

from __future__ import annotations

import argparse
from pathlib import Path

from aqr.corpus.fetch import fetch_and_lock


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("data/corpus"))
    args = parser.parse_args()
    lock = fetch_and_lock(args.out)
    print(
        f"corpus téléchargé : {lock.verse_count} versets, "
        f"{len(lock.files)} fichier(s) épinglé(s) dans {args.out / 'LOCK.json'}"
    )


if __name__ == "__main__":
    main()
