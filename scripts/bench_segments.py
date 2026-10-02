#!/usr/bin/env python3
"""Banc de la recherche sur segments réalistes (phase 2b, ADR-0004).

Fenêtres de 3–6, 7–12 et 13–25 mots tirées du flux continu imla'i (basmala retirée des
versets 1 sauf 1:1), plus « verset 1 sans basmala », avec et sans bruit de lettre.
Métrique principale : faux versets que le décodeur nommerait (doit rester à 0, I3).
Graine fixe : résultats reproductibles.

Usage :
    python scripts/bench_segments.py [--n 600] [--corpus data/corpus] [--seed 7]
"""

from __future__ import annotations

import argparse
import random
from pathlib import Path

from aqr.corpus.imlai_corrections import build_word_corrections, load_simple_clean_words
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.decoding.viterbi_decoder import DecoderConfig
from aqr.matching.flow_matcher import FlowVerseMatcher
from aqr.matching.noise import inject_letter_noise
from aqr.matching.segment_bench import (
    SegmentMetrics,
    build_flow,
    evaluate,
    sample_windows,
    verse_one_cases,
)

WINDOWS = ((3, 6), (7, 12), (13, 25))


def _print(label: str, m: SegmentMetrics) -> None:
    print(
        f"{label:34s} n={m.n:4d}  top-1 {m.top1_correct / m.n:6.1%}  "
        f"nommés justes {m.named_correct / m.n:6.1%}  incertains {m.uncertain / m.n:6.1%}  "
        f"FAUX {m.false_named:3d}  partiels {m.partial_named:3d}  "
        f"couverture {m.mean_coverage:5.1%}  {m.mean_ms:5.1f} ms"
    )


def run(corpus_dir: Path, n: int, seed: int) -> None:
    corpus = TanzilCorpusRepository(corpus_dir)
    simple_clean = load_simple_clean_words(corpus_dir)
    corrections = build_word_corrections(corpus, simple_clean)
    matcher = FlowVerseMatcher(corpus, word_corrections=corrections)
    decoder = DecoderConfig()
    flow = build_flow(simple_clean)
    print(
        f"flux : {len(flow)} mots · seuil décodeur {decoder.min_recognized_score} · graine {seed}\n"
    )

    for noisy in (False, True):
        print("== bruit de lettre (1 mot sur 5) ==" if noisy else "== texte imla'i exact ==")
        for lo, hi in WINDOWS:
            cases = sample_windows(flow, n, lo, hi, random.Random(seed), f"{lo}-{hi} mots")
            _print(
                f"fenêtres {lo}-{hi} mots",
                evaluate(
                    matcher,
                    cases,
                    decoder.min_recognized_score,
                    decoder.uncertainty_ratio,
                    transform=(lambda t, r: inject_letter_noise(t, r, 5)) if noisy else None,
                    rng=random.Random(seed),
                ),
            )
        _print(
            "verset 1 sans basmala",
            evaluate(
                matcher,
                verse_one_cases(simple_clean),
                decoder.min_recognized_score,
                decoder.uncertainty_ratio,
                transform=(lambda t, r: inject_letter_noise(t, r, 5)) if noisy else None,
                rng=random.Random(seed),
            ),
        )
        print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--n", type=int, default=600)
    parser.add_argument("--corpus", type=Path, default=Path("data/corpus"))
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    run(args.corpus, args.n, args.seed)
