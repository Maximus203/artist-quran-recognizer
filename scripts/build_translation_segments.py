#!/usr/bin/env python
"""Calcule les frontières de découpage d'une traduction en fragments (hors ligne, déterministe).

    python scripts/build_translation_segments.py [--translation-id ID] [--show 11:61 2:255 ...]

Lit le corpus Tanzil (`--corpus-dir`) et la traduction QuranEnc du cache local (`--cache-dir` ;
une sourate absente est téléchargée), écrit `data/translation-segments/<translation_id>.json`
(indices de mots, offsets de caractères, empreintes : AUCUN texte coranique ni traduction), puis
vérifie l'invariant I2 sur chaque verset (tranches rejointes = traduction d'origine).
Les réglages viennent de `aqr.translation_align.config.TranslationAlignmentConfig`.
`--show` affiche, pour lecture humaine seulement, l'arabe et les tranches françaises en regard.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import fields, replace
from pathlib import Path

from aqr.adapters.quranenc import QuranEncTranslationRepository
from aqr.corpus.checksums import sha256_of
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.domain.models import VerseRef
from aqr.rendering.translation_segments import SegmentStore
from aqr.translation_align.build import (
    VerseSource,
    build_document,
    dump_document,
    verify_reconstruction,
)
from aqr.translation_align.config import TranslationAlignmentConfig

ROOT = Path(__file__).resolve().parents[1]


def _default_cache_dir() -> Path:
    base = os.environ.get("AQR_CACHE_DIR") or str(Path.home() / ".cache" / "aqr")
    return Path(base) / "translations"


def _sources(
    corpus: TanzilCorpusRepository, repo: QuranEncTranslationRepository, translation_id: str
) -> list[VerseSource]:
    return [
        VerseSource(
            ref=ref,
            arabic_words=corpus.words(ref),
            arabic_text=corpus.text(ref),
            french=repo.get(ref, translation_id).text,
        )
        for ref in corpus.all_refs()
    ]


def _show(document: dict[str, object], sources: list[VerseSource], refs: list[str]) -> None:
    store = SegmentStore.from_document(document)
    by_ref = {str(s.ref): s for s in sources}
    for raw in refs:
        source = by_ref[str(VerseRef.parse(raw))]
        segments = store.segments(source.ref, source.french, len(source.arabic_words))
        print(f"=== {source.ref}  ({len(source.arabic_words)} mots)")
        if segments is None:
            print("  (pas de découpage)")
            continue
        for seg in segments:
            arabic = " ".join(source.arabic_words[seg.first_word - 1 : seg.last_word])
            conf = "" if seg.confidence is None else f" [frontière {seg.confidence:.3f}]"
            print(f"  mots {seg.first_word}-{seg.last_word}{conf}")
            print(f"    AR  {arabic}")
            print(f"    FR  {source.french[seg.start : seg.end]}")


def _config_from_args(args: argparse.Namespace) -> TranslationAlignmentConfig:
    config = TranslationAlignmentConfig()
    overrides = {
        f.name: getattr(args, f.name)
        for f in fields(config)
        if getattr(args, f.name, None) is not None
    }
    return replace(config, **overrides)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--translation-id", default="french_hameedullah")
    parser.add_argument("--corpus-dir", type=Path, default=ROOT / "data" / "corpus")
    parser.add_argument("--cache-dir", type=Path, default=_default_cache_dir())
    parser.add_argument("--out-dir", type=Path, default=ROOT / "data" / "translation-segments")
    parser.add_argument("--show", nargs="*", default=[], metavar="REF", help="ex. 11:61 2:255")
    parser.add_argument("--no-write", action="store_true", help="calcule et vérifie sans écrire")
    # surcharges de réglages pour les essais de calibration (le défaut est dans la configuration)
    parser.add_argument("--temperature", type=float)
    parser.add_argument("--min_boundary_confidence", type=float)
    parser.add_argument("--waqf_bonus", type=float)
    parser.add_argument("--null_weight", type=float)
    parser.add_argument("--em_iterations", type=int)
    args = parser.parse_args(argv)
    config = _config_from_args(args)

    corpus = TanzilCorpusRepository(args.corpus_dir)
    repo = QuranEncTranslationRepository(args.cache_dir)
    sources = _sources(corpus, repo, args.translation_id)
    corpus_sha = sha256_of((args.corpus_dir / "quran-uthmani.txt").read_bytes())

    started = time.monotonic()
    document = build_document(
        sources, args.translation_id, config, corpus_sha, progress=lambda m: print(m, flush=True)
    )
    elapsed = time.monotonic() - started
    problems = verify_reconstruction(document, sources)
    stats = document["stats"]
    assert isinstance(stats, dict)
    total = stats["verses"]
    print(f"{total} versets en {elapsed:.0f} s ; reconstitution : {total - len(problems)}/{total}")
    print(
        f"un seul segment naturel {stats['single_clause']} · découpés {stats['split']} "
        f"({stats['cuts']} frontières) · repli (propositions trop incertaines) {stats['fallback']}"
    )
    for line in problems[:20]:
        print("ANOMALIE", line, file=sys.stderr)
    if args.show:
        _show(document, sources, args.show)
    if problems:
        return 1
    if not args.no_write:
        args.out_dir.mkdir(parents=True, exist_ok=True)
        target = args.out_dir / f"{args.translation_id}.json"
        target.write_text(dump_document(document), encoding="utf-8")
        print(f"écrit : {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
