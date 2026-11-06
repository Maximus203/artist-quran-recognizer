"""Banc de la parole libre (ADR-0027) : le garde-fou laisse-t-il passer du Coran ?

Pour un enregistrement et son résultat `aqr.recognition/1` :
- les versets RECONNUS sont présentés au module comme de la parole libre : tous doivent être
  retenus (`withheld`) ; un seul traduit est une fuite, le critère n°1 (I3) ;
- les passages éligibles (`arabic_speech`, abstentions `no_candidate`) : part traduite et raisons ;

Usage : python scripts/bench_free_speech.py RÉSULTAT AUDIO [--max-verses N] [--out RAPPORT]
Le rapport ne contient aucun texte arabe (des comptes et des raisons), il peut être versionné.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

from aqr.domain.models import TimeSpan
from aqr.freespeech.command import FreeSpeechOptions, build_engine
from aqr.freespeech.config import FreeSpeechConfig
from aqr.freespeech.service import eligible_intervals, process_interval


def verse_spans(intervals: list[dict[str, object]], limit: int) -> list[tuple[int, TimeSpan]]:
    out = []
    for index, item in enumerate(intervals):
        t = item.get("t")
        if item.get("kind") == "verse" and item.get("status") == "recognized" and t:
            out.append((index, TimeSpan(float(t[0]), float(t[1]))))  # type: ignore[index]
    step = max(1, len(out) // limit) if limit else 1
    return out[::step][:limit] if limit else out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("recognition", type=Path)
    parser.add_argument("audio", type=Path)
    parser.add_argument("--max-verses", type=int, default=40)
    parser.add_argument("--models-dir", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    intervals = json.loads(args.recognition.read_text(encoding="utf-8"))["intervals"]
    engine = build_engine(FreeSpeechOptions(models_dir=args.models_dir), os.environ)
    config = FreeSpeechConfig()
    clip = engine.extract(args.audio)

    def run(spans: list[tuple[int, TimeSpan]]) -> list:
        return [
            process_interval(
                i, s, clip, engine.transcriber, engine.translator, engine.guard, config
            )
            for i, s in spans
        ]

    verses = run(verse_spans(intervals, args.max_verses))
    free = run(eligible_intervals(intervals))
    leaks = [v.index for v in verses if v.status == "translated"]
    report = {
        "transcriber": engine.transcriber_name,
        "translator": engine.translator_name,
        "verses_tested": len(verses),
        "verses_leaked": len(leaks),
        "verses_leaked_indexes": leaks,
        "verses_withheld_reasons": dict(Counter(v.reason for v in verses if v.reason)),
        "free_tested": len(free),
        "free_translated": sum(1 for v in free if v.status == "translated"),
        "free_withheld_reasons": dict(Counter(v.reason for v in free if v.reason)),
    }
    text = json.dumps(report, indent=1, ensure_ascii=False)
    print(text)
    if args.out:
        args.out.write_text(text + "\n", encoding="utf-8")
    return 1 if leaks else 0


if __name__ == "__main__":
    sys.exit(main())
