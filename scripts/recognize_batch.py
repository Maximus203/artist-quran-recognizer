#!/usr/bin/env python3
"""Reconnaissance par lot avec modèles chargés une seule fois (évaluation de référence).

Écrit `<id>.json` (aqr.recognition/1) par cas du manifeste + `timings.json` (temps mur,
RTF, pic RSS du processus). Usage :
    python scripts/recognize_batch.py --manifest M --audio-dir D --split dev --asr fastconformer --out-dir OUT
Aucun audio n'est écrit dans le dépôt ; `--split test` exige `--final` (ensemble réservé).
"""

from __future__ import annotations

import argparse
import json
import os
import resource
import sys
import time
from pathlib import Path

from aqr.cli import _sha256_of
from aqr.data.manifest import Manifest
from aqr.pipeline.factory import RecognizeOptions, build_recognizer
from aqr.pipeline.output import build_json


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--audio-dir", type=Path, required=True)
    p.add_argument("--split", choices=("dev", "test"), default="dev")
    p.add_argument("--final", action="store_true")
    p.add_argument("--asr", choices=("whisper", "fastconformer"), default="fastconformer")
    p.add_argument("--out-dir", type=Path, required=True)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--only-condition", action="append", default=[])
    p.add_argument("--translation", default="none")
    p.add_argument("--corpus-dir", type=Path, default=Path("data/corpus"))
    args = p.parse_args(argv)
    if args.split == "test" and not args.final:
        print("ensemble test réservé : relancer avec --final", file=sys.stderr)
        return 2
    manifest = Manifest.load(args.manifest)
    cases = [c for c in manifest.cases if c.split == args.split]
    if args.only_condition:
        cases = [c for c in cases if (c.extra.get("ref") or {}).get("condition") in args.only_condition]
    if args.limit:
        cases = cases[: args.limit]
    args.out_dir.mkdir(parents=True, exist_ok=True)
    options = RecognizeOptions(
        asr=args.asr,
        models_dir=Path(os.environ["AQR_MODELS_DIR"]),
        corpus_dir=args.corpus_dir,
        translation_id=None if args.translation == "none" else args.translation,
        device="cpu",
    )
    t0 = time.perf_counter()
    recognizer = build_recognizer(options, os.environ)
    load_s = time.perf_counter() - t0
    rows = []
    for case in cases:
        path = args.audio_dir / case.file
        started = time.perf_counter()
        try:
            result = recognizer.pipeline.run(path)
        except (OSError, ValueError, RuntimeError) as exc:
            rows.append({"id": case.id, "error": str(exc)})
            continue
        wall = time.perf_counter() - started
        doc = build_json(result, recognizer.renderer, None, _sha256_of(path))
        (args.out_dir / f"{case.id}.json").write_text(
            json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
        )
        rows.append({"id": case.id, "wall_s": round(wall, 3), "audio_s": round(result.duration_s, 3),
                     "peak_rss_mb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024})
        print(f"{case.id} {wall:.1f}s/{result.duration_s:.1f}s", flush=True)
    (args.out_dir / "timings.json").write_text(
        json.dumps({"asr": args.asr, "split": args.split, "model_load_s": round(load_s, 2), "cases": rows}, indent=1)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
