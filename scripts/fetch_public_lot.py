#!/usr/bin/env python3
"""Télécharge un lot audio depuis le dataset Hugging Face public, à la révision épinglée, et
vérifie chaque fichier contre `docs/data-lots/lot-N.yaml` (aucun jeton, aucun audio dans git).

    python scripts/fetch_public_lot.py --lot 1 --dest "$AQR_AUDIO_DIR/lot-1" \\
        [--check-head] [--report docs/evaluation/lot1-fetch-report.json]

Codes de sortie : 0 tout vérifié · 1 fichier refusé ou absent. `--check-head` signale seulement si
la tête du dataset a avancé depuis la révision épinglée (la révision épinglée reste utilisée).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

from aqr.data.lot_fetch import (
    LotFetchError,
    LotItem,
    PublicLotSource,
    fetch_public_lot,
    hf_head_revision,
)

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("--lot", type=int, required=True)
    parser.add_argument("--dest", type=Path, required=True)
    parser.add_argument("--check-head", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    manifest = yaml.safe_load(
        (ROOT / "docs" / "data-lots" / f"lot-{args.lot}.yaml").read_text(encoding="utf-8")
    )
    hf = manifest.get("hf_dataset")
    if not hf:
        print(f"lot {args.lot} : pas de bloc hf_dataset dans le manifeste", file=sys.stderr)
        return 1
    source = PublicLotSource(repo=hf["repo"], revision=hf["revision"])
    items = [LotItem(i["id"], i["sha256"]) for i in manifest["fichiers"]]
    try:
        results = fetch_public_lot(
            items, source, args.dest, head_revision=hf_head_revision if args.check_head else None
        )
    except LotFetchError as exc:
        print(f"ERREUR : {exc}", file=sys.stderr)
        return 1
    for r in results:
        print(f"ok {r.id} {r.status} {r.size} octets sha256=conforme")
    report = {
        "lot": args.lot,
        "repo": source.repo,
        "revision": source.revision,
        "remote_head_moved": results[0].remote_head_moved if results else None,
        "files": [
            {"id": r.id, "status": r.status, "size": r.size, "sha256_ok": r.sha256_ok}
            for r in results
        ],
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
