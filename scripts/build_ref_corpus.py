#!/usr/bin/env python3
"""Construit le corpus de référence : mixages à vérité exacte, silence, parole hors cible et
versions dégradées (bruit, téléphone, réverbération, MP3, silence en tête), avec manifeste.

    python scripts/fetch_everyayah.py --dest ~/aqr-ref/everyayah      # sources (hors dépôt)
    python scripts/build_ref_corpus.py --seed 7 --per-scenario 2

Audios : ~/aqr-ref (--out-dir ; jamais dans le dépôt). Sources : <out-dir>/everyayah,
<out-dir>/specials et <out-dir>/speech (voir scripts/make_mix.py ; un scénario sans source est
écarté avec sa raison). Manifeste : tests/fixtures/ref-corpus/manifest.yaml (schéma figé :
src/aqr/data/refcorpus.py). Récitants disjoints entre dev et test ; rien n'est réaffecté d'un
lancement à l'autre. Droits des sources : docs/data-lots/ref-corpus-provenance.md.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.data.config import DataConfig
from aqr.data.mixer import SCENARIOS
from aqr.data.refbuild import (
    DEFAULT_DEGRADATIONS,
    ReferenceClipProvider,
    build_ref_corpus,
    ensure_outside_repo,
)
from aqr.data.refcorpus import RefCorpusError

ROOT = Path(__file__).resolve().parents[1]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--out-dir", type=Path, default=Path("~/aqr-ref"))
    parser.add_argument(
        "--manifest", type=Path, default=ROOT / "tests/fixtures/ref-corpus/manifest.yaml"
    )
    parser.add_argument("--corpus", type=Path, default=ROOT / "data" / "corpus")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--per-scenario", type=int, default=2)
    parser.add_argument("--scenarios", help=f"séparés par des virgules ({', '.join(SCENARIOS)})")
    args = parser.parse_args(argv)

    out_dir = args.out_dir.expanduser()
    try:
        ensure_outside_repo(out_dir, ROOT)
    except RefCorpusError as exc:
        sys.exit(str(exc))
    config = DataConfig()
    corpus = TanzilCorpusRepository(args.corpus)
    provider = ReferenceClipProvider(out_dir, sample_rate=config.sample_rate)
    report = build_ref_corpus(
        provider,
        corpus,
        out_dir,
        args.manifest,
        seed=args.seed,
        per_scenario=args.per_scenario,
        scenarios=args.scenarios.split(",") if args.scenarios else None,
        degradations=DEFAULT_DEGRADATIONS,
        config=config,
    )
    for name, reason in report.skipped:
        print(f"ÉCARTÉ {name} : {reason}", file=sys.stderr)
    for problem in report.problems:
        print(f"PROBLÈME {problem}", file=sys.stderr)
    cases = report.manifest.cases
    print(
        f"{len(cases)} cas · dev {sum(c.split == 'dev' for c in cases)} · "
        f"test {sum(c.split == 'test' for c in cases)} · {len(report.skipped)} écarté(s)"
    )
    if report.problems:
        print("manifeste NON écrit (voir PROBLÈME)", file=sys.stderr)
        return 1
    print(f"manifeste : {args.manifest}")
    return 0 if cases else 1


if __name__ == "__main__":
    sys.exit(main())
