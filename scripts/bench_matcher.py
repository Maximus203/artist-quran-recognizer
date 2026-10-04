#!/usr/bin/env python3
"""Banc de robustesse du VerseMatcher (phase 2, ADR-0003).

Mesure le taux de top-1 correct sur des requêtes construites depuis l'orthographe
imla'i réelle (fichier simple-clean de Tanzil, jamais le corpus Uthmani lui-même),
avec plusieurs types de bruit simulant une sortie d'ASR. Graine fixe : résultats
reproductibles.

Usage :
    python scripts/bench_matcher.py [--n 2000] [--corpus data/corpus] [--seed 42]
"""

from __future__ import annotations

import argparse
import random
import time
from pathlib import Path

from aqr.corpus.imlai_corrections import build_word_corrections, load_simple_clean_words
from aqr.corpus.normalize import normalize_arabic
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.matching.flow_matcher import FlowVerseMatcher
from aqr.matching.noise import drop_random_word, inject_letter_noise, insert_random_word

SCENARIOS = {
    "exact_imlai": None,
    "bruit_lettre_1_pour_5_mots": lambda tokens, rng: inject_letter_noise(
        tokens, rng, every_n_words=5
    ),
    "mot_manquant": drop_random_word,
    "mot_en_trop": insert_random_word,
}


def run(corpus_dir: Path, n: int, seed: int) -> None:
    corpus = TanzilCorpusRepository(corpus_dir)
    simple_clean_words = load_simple_clean_words(corpus_dir)
    corrections = build_word_corrections(corpus, simple_clean_words)

    t0 = time.perf_counter()
    matcher = FlowVerseMatcher(corpus, word_corrections=corrections)
    build_s = time.perf_counter() - t0

    refs = sorted(corpus.all_refs())
    eligible = [r for r in refs if len(corpus.words(r)) >= 4]
    rng = random.Random(seed)
    sample = rng.sample(eligible, min(n, len(eligible)))
    if n > len(eligible):
        # Ré-échantillonne avec remise pour atteindre n (peu de versets ont < 4 mots).
        sample += [rng.choice(eligible) for _ in range(n - len(eligible))]

    print(f"corpus : {len(refs)} versets, dictionnaire de corrections : {len(corrections)} entrées")
    print(f"index du matcher construit en {build_s:.2f} s")
    print(f"échantillon : {len(sample)} versets, graine {seed}\n")

    for name, transform in SCENARIOS.items():
        correct = 0
        total_ms = 0.0
        scenario_rng = random.Random(seed)
        for ref in sample:
            tokens = tuple(normalize_arabic(w) for w in simple_clean_words[ref])
            if transform is not None:
                tokens = transform(tokens, scenario_rng)
            query = " ".join(tokens)
            start = time.perf_counter()
            candidates = matcher.match(query)
            total_ms += (time.perf_counter() - start) * 1000
            if candidates and (
                candidates[0].span.ref == ref
                or corpus.text(candidates[0].span.ref) == corpus.text(ref)
            ):
                correct += 1
        accuracy = correct / len(sample)
        avg_ms = total_ms / len(sample)
        print(f"{name:32s} top-1 = {accuracy:6.2%}   moyenne = {avg_ms:5.2f} ms/requête")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--n", type=int, default=2000)
    parser.add_argument("--corpus", type=Path, default=Path("data/corpus"))
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    run(args.corpus, args.n, args.seed)
