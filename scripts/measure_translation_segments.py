#!/usr/bin/env python
"""Mesure honnête du découpage de la traduction en fragments (précision d'abord).

    python scripts/measure_translation_segments.py [--sessions DIR] [--translation-id ID]

1. PSEUDO-VÉRITÉ. Des suites de versets consécutifs dont les frontières sont connues (une
   frontière de verset est une vraie frontière de proposition). Les modèles sont appris sur les
   sourates PAIRES, évalués sur des fenêtres des sourates IMPAIRES (aucune fuite). Le prior de
   frontière n'est appris que sur les signes de pause (pas sur les fins de verset : leurs rimes
   gonfleraient le score). Mesure : parmi les frontières gardées, part à la place exacte et à un
   mot près. C'est un plafond optimiste (les fenêtres n'ont ni inversion d'ordre ni signe de
   pause) : la lecture d'un échantillon de vrais versets reste la mesure qui compte.
2. COUVERTURE du fichier `data/translation-segments/<id>.json` : versets découpés, mots couverts.
3. SESSIONS (optionnel, `--sessions DIR`) : sur les `prediction.recognition.json` d'un dossier,
   combien d'intervalles partiels de verset reçoivent un fragment, exact ou approché, ou le repli.
"""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter, defaultdict
from collections.abc import Sequence
from dataclasses import replace
from pathlib import Path

import numpy as np

from aqr.adapters.quranenc import QuranEncTranslationRepository
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.eval.recognition import VerseInterval, load_recognition
from aqr.rendering.translation_segments import FragmentPolicy, SegmentStore, select_fragment
from aqr.translation_align import segmenter as seg
from aqr.translation_align.build import Prepared, VerseSource, prepare, train_models
from aqr.translation_align.config import TranslationAlignmentConfig

ROOT = Path(__file__).resolve().parents[1]


def _windows(items: Sequence[Prepared], sizes: tuple[int, ...] = (3, 5, 4)) -> list[list[Prepared]]:
    by_surah: dict[int, list[Prepared]] = defaultdict(list)
    for item in items:
        by_surah[item.source.ref.surah].append(item)
    out: list[list[Prepared]] = []
    k = 0
    for verses in by_surah.values():
        i = 0
        while i + 2 <= len(verses):
            size = sizes[k % len(sizes)]
            k += 1
            chunk = verses[i : i + size]
            i += size
            if len(chunk) >= 2:
                out.append(chunk)
    return out


def _short_windows(
    items: Sequence[Prepared], max_words: int = 7, size: int = 5
) -> list[list[Prepared]]:
    out: list[list[Prepared]] = []
    cur: list[Prepared] = []
    last = None
    for item in items:
        short = len(item.verse.arabic) <= max_words and item.skip == 0
        if short and (last is None or item.source.ref.surah == last):
            cur.append(item)
        else:
            if len(cur) >= 3:
                out.append(cur)
            cur = [item] if short else []
        last = item.source.ref.surah
        if len(cur) == size:
            out.append(cur)
            cur = []
    return out


def _document(chunk: Sequence[Prepared]) -> tuple[seg.VerseInput, list[int]]:
    arabic: list[int] = []
    waqf: list[int] = []
    letters: list[int] = []
    clauses: list[list[int]] = []
    french_letters: list[int] = []
    gold: list[int] = []
    for item in chunk:
        v = item.verse
        arabic += list(v.arabic)
        waqf += list(v.waqf)
        letters += list(v.arabic_letters)
        clauses.append([t for c in v.clauses for t in c])
        french_letters.append(sum(v.french_letters))
        gold.append(len(arabic))
    return seg.VerseInput(arabic, waqf, clauses, letters, french_letters), gold[:-1]


def pseudo_gold(sources: Sequence[VerseSource], config: TranslationAlignmentConfig) -> None:
    prepared = prepare(sources, config)
    train = [p for p in prepared if p.source.ref.surah % 2 == 0]
    test = [p for p in prepared if p.source.ref.surah % 2 == 1]
    models = train_models(train, config)
    print("== 1. Pseudo-vérité (modèles : sourates paires ; fenêtres : sourates impaires)")
    for label, windows in (
        ("fenêtres longues", _windows(test)),
        ("unités courtes (≤ 7 mots)", _short_windows(test)),
    ):
        total = kept = exact = within = 0
        for chunk in windows:
            verse, gold = _document(chunk)
            total += len(gold)
            for cut in seg.segment_verse(verse, models, config):
                kept += 1
                nearest = min(gold, key=lambda g: abs(g - (cut.word - 1)))
                exact += nearest == cut.word - 1
                within += abs(nearest - (cut.word - 1)) <= config.position_tolerance
        print(
            f"  {label:28s} frontières {total:5d} · gardées {kept / total:6.1%} · "
            f"à ±{config.position_tolerance} mot {within / max(1, kept):6.2%} · "
            f"exactes {exact / max(1, kept):6.2%}"
        )


def coverage(document: dict[str, object], sources: Sequence[VerseSource]) -> None:
    verses = document["verses"]
    assert isinstance(verses, dict)
    total_words = split_words = 0
    split = single = 0
    segments = Counter[int]()
    for source in sources:
        entry = verses[str(source.ref)]
        n = len(source.arabic_words)
        total_words += n
        count = len(entry["cuts"]) + 1
        segments[count] += 1
        if count > 1:
            split += 1
            split_words += n
        else:
            single += 1
    print("== 2. Couverture du fichier de frontières")
    print(
        f"  versets découpés (≥ 2 tranches) : {split}/{len(sources)} ({split / len(sources):.1%})"
    )
    print(f"  mots arabes dans des versets découpés : {split_words / total_words:.1%}")
    print(
        f"  versets à une seule tranche : {single} ; "
        f"tranches par verset : {dict(sorted(segments.items())[:8])}"
    )


def sessions(
    directory: Path,
    store: SegmentStore,
    corpus: TanzilCorpusRepository,
    repo: QuranEncTranslationRepository,
    translation_id: str,
) -> None:
    policy = FragmentPolicy()
    outcome = Counter[str]()
    files = sorted(directory.glob("*/prediction.recognition.json"))
    for path in files:
        try:
            recognition = load_recognition(path)
        except Exception:  # une session illisible ne bloque pas la mesure
            continue
        for interval in recognition.intervals:
            if not isinstance(interval, VerseInterval) or interval.status.value == "uncertain":
                continue
            words = len(corpus.words(interval.ref))
            if interval.first_word == 1 and interval.last_word >= words:
                continue
            text = repo.get(interval.ref, translation_id).text
            segments = store.segments(interval.ref, text, words)
            if segments is None or len(segments) < 2:
                outcome["verset entier (pas de découpage)"] += 1
                continue
            fragment = select_fragment(
                segments, text, interval.first_word, interval.last_word, words, policy
            )
            if fragment is None:
                outcome["verset entier (fragment trop large)"] += 1
            elif fragment.approximate:
                outcome["fragment approché"] += 1
            else:
                outcome["fragment exact"] += 1
    total = sum(outcome.values())
    print(f"== 3. Intervalles partiels de {len(files)} sessions : {total}")
    for key, value in outcome.most_common():
        print(f"  {key:40s} {value:5d} ({value / max(1, total):.1%})")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--translation-id", default="french_hameedullah")
    parser.add_argument("--corpus-dir", type=Path, default=ROOT / "data" / "corpus")
    base = os.environ.get("AQR_CACHE_DIR") or str(Path.home() / ".cache" / "aqr")
    parser.add_argument("--cache-dir", type=Path, default=Path(base) / "translations")
    parser.add_argument("--segments-dir", type=Path, default=ROOT / "data" / "translation-segments")
    parser.add_argument(
        "--sessions", type=Path, help="dossier de sessions (…/<id>/prediction.recognition.json)"
    )
    args = parser.parse_args()

    config = TranslationAlignmentConfig()
    corpus = TanzilCorpusRepository(args.corpus_dir)
    repo = QuranEncTranslationRepository(args.cache_dir)
    sources = [
        VerseSource(r, corpus.words(r), corpus.text(r), repo.get(r, args.translation_id).text)
        for r in corpus.all_refs()
    ]
    pseudo_gold(sources, replace(config))
    path = args.segments_dir / f"{args.translation_id}.json"
    if path.exists():
        document = json.loads(path.read_text(encoding="utf-8"))
        coverage(document, sources)
        if args.sessions:
            sessions(
                args.sessions,
                SegmentStore.from_document(document),
                corpus,
                repo,
                args.translation_id,
            )
    else:
        print(f"(pas de fichier {path} : lancer scripts/build_translation_segments.py)")
    return 0


if __name__ == "__main__":
    np.seterr(all="ignore")
    raise SystemExit(main())
