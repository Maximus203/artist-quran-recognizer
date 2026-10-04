#!/usr/bin/env python3
"""Fabrique des mixages synthétiques avec vérité terrain exacte (reproductibles : graine).

    python scripts/make_mix.py --seed 7 --per-scenario 3
    python scripts/make_mix.py --scenarios priere,assise_fr --seed 1

Sources (dans $AQR_AUDIO_DIR, hors dépôt) :
  everyayah/    récitations — scripts/fetch_everyayah.py
  specials/     istiadha.<ext>, takbir.<ext>, amin.<ext> — à fournir (absents d'EveryAyah)
  speech/       french_*.<ext>, arabic_speech_*.<ext> — parole non coranique à fournir
Un scénario dont les sources manquent est écarté AVEC sa raison (rien n'est inventé).
Sortie : mix/<id>.wav, _derived/<id>.wav et le cas annoté dans le manifeste
(`--manifest`, défaut tests/fixtures/audio/manifest.yaml).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.data.config import DataConfig
from aqr.data.mixer import SCENARIOS, DiskClipProvider, MixConfig, generate_mixes, materialize

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--audio-dir", type=Path, help="défaut : $AQR_AUDIO_DIR")
    parser.add_argument(
        "--manifest", type=Path, default=ROOT / "tests/fixtures/audio/manifest.yaml"
    )
    parser.add_argument("--corpus", type=Path, default=ROOT / "data" / "corpus")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--per-scenario", type=int, default=3)
    parser.add_argument("--scenarios", help=f"séparés par des virgules ({', '.join(SCENARIOS)})")
    args = parser.parse_args()

    audio_dir = args.audio_dir or (
        Path(os.environ["AQR_AUDIO_DIR"]) if "AQR_AUDIO_DIR" in os.environ else None
    )
    if audio_dir is None:
        sys.exit("Variable d'environnement manquante : AQR_AUDIO_DIR (ou passer --audio-dir)")

    data_config = DataConfig()
    corpus = TanzilCorpusRepository(args.corpus)
    provider = DiskClipProvider(audio_dir, sample_rate=data_config.sample_rate)
    report = generate_mixes(
        provider,
        corpus,
        seed=args.seed,
        per_scenario=args.per_scenario,
        scenarios=args.scenarios.split(",") if args.scenarios else None,
        config=MixConfig(sample_rate=data_config.sample_rate),
    )
    for mix in report.mixes:
        case = materialize(mix, audio_dir, args.manifest, data_config)
        print(
            f"{case.id}  {case.duree_s:7.1f} s  {len(mix.expected):2d} versets  "
            f"{len(mix.non_quran)} zones  frontières {mix.boundaries}"
        )
    for scenario, reason in report.skipped:
        print(f"ÉCARTÉ {scenario} : {reason}", file=sys.stderr)
    print(f"{len(report.mixes)} mixages · {len(report.skipped)} scénarios écartés")
    return 0 if report.mixes else 1


if __name__ == "__main__":
    sys.exit(main())
