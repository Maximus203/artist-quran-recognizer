#!/usr/bin/env python3
"""Capture le FORMAT RÉEL de sortie d'un ASR sur des versets EveryAyah et mesure ASR -> matcher.

    python scripts/capture_asr_samples.py [--asr fastconformer] [--fixture 80]

Pour chaque verset EveryAyah de `$AQR_AUDIO_DIR/everyayah` : transcription brute (voyelles,
orthographe), mots horodatés, puis passage dans le matcher (B6). Écrit un échantillon réduit dans
`tests/fixtures/asr/<asr>_everyayah.json` (versionné : texte et temps seulement, aucun audio) —
c'est le contrat réel que les tests du matcher rejouent (phase 4, point 4).
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from collections import Counter
from dataclasses import replace
from pathlib import Path

from aqr.adapters.ffmpeg_extractor import FfmpegAudioExtractor
from aqr.corpus.imlai_corrections import build_word_corrections, load_simple_clean_words
from aqr.corpus.normalize import normalize_arabic
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.decoding.viterbi_decoder import DecoderConfig
from aqr.domain.models import TimeSpan, VerseRef
from aqr.domain.ports import QuranASR
from aqr.matching.flow_matcher import FlowVerseMatcher

ROOT = Path(__file__).resolve().parents[1]
HARAKAT = set("ًٌٍَُِّْٰٓٔٱ")  # voyelles et signes combinants arabes


def has_vowels(text: str) -> bool:
    return any(ch in HARAKAT for ch in text)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asr", default="fastconformer", choices=["fastconformer", "whisper"])
    parser.add_argument("--fixture", type=int, default=80, help="taille de l'échantillon versionné")
    parser.add_argument("--corpus", type=Path, default=ROOT / "data" / "corpus")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--pad", type=float, help="context_pad_s (défaut : celui de la config)")
    parser.add_argument("--pad-noise", type=float, default=0.0, help="amplitude du bruit de marge")
    parser.add_argument("--no-write", action="store_true", help="ne pas écrire la fixture")
    args = parser.parse_args()
    audio_dir, models_dir = os.environ.get("AQR_AUDIO_DIR"), os.environ.get("AQR_MODELS_DIR")
    if not audio_dir or not models_dir:
        sys.exit("Variables manquantes : AQR_AUDIO_DIR et AQR_MODELS_DIR")

    lock = ROOT / "models" / "LOCK.json"
    if args.asr == "fastconformer":
        from aqr.adapters.fastconformer import FastConformerConfig, FastConformerQuranASR

        base = FastConformerConfig(models_dir=Path(models_dir), lock_path=lock)
        asr: QuranASR = FastConformerQuranASR(
            replace(
                base,
                context_pad_s=base.context_pad_s if args.pad is None else args.pad,
                pad_noise=args.pad_noise,
            )
        )
    else:
        from aqr.adapters.whisper_tarteel import WhisperTarteelASR, WhisperTarteelConfig

        asr = WhisperTarteelASR(WhisperTarteelConfig(models_dir=Path(models_dir), lock_path=lock))
    corpus = TanzilCorpusRepository(args.corpus)
    simple = load_simple_clean_words(args.corpus)
    matcher = FlowVerseMatcher(corpus, word_corrections=build_word_corrections(corpus, simple))
    threshold = DecoderConfig().min_recognized_score
    extractor = FfmpegAudioExtractor()

    rows: list[dict[str, object]] = []
    skipped_long: list[str] = []
    audio_seconds = infer_seconds = 0.0
    for clip_path in sorted((Path(audio_dir) / "everyayah").glob("*/[0-9]*.mp3")):
        ref = VerseRef(int(clip_path.stem[:3]), int(clip_path.stem[3:]))
        clip = extractor.extract(clip_path)
        duration = len(clip.samples) / clip.sample_rate
        if args.asr == "whisper" and duration > 30.0:  # fenêtre d'entrée de Whisper
            skipped_long.append(str(ref))
            continue
        started = time.perf_counter()
        transcript = asr.transcribe(clip, TimeSpan(0.0, duration))
        infer_seconds += time.perf_counter() - started
        audio_seconds += duration
        raw = " ".join(w.text for w in transcript.words)
        candidates = matcher.match(normalize_arabic(raw), top_k=3)
        best = candidates[0] if candidates else None
        top_refs = [c.refs[0] for c in candidates]
        rows.append(
            {
                "reciter": clip_path.parent.name,
                "ref": str(ref),
                "duration_s": round(duration, 3),
                "raw_text": raw,
                "has_vowels": has_vowels(raw),
                "words": [
                    {
                        "text": w.text,
                        "t": [round(w.time.start_s, 3), round(w.time.end_s, 3)],
                        "confidence": round(w.confidence, 3),
                    }
                    for w in transcript.words
                ],
                "engine": transcript.engine,
                "top1": str(best.refs[0]) if best else None,
                "score": round(best.score, 3) if best else None,
                "correct": bool(
                    best and (ref in best.refs or corpus.text(best.refs[0]) == corpus.text(ref))
                ),
                "top3_has_ref": ref in top_refs,
            }
        )

    n = len(rows)
    if skipped_long:
        print(f"écartés (> 30 s, fenêtre de Whisper) : {skipped_long}")
    correct = sum(1 for r in rows if r["correct"])
    named = sum(1 for r in rows if r["correct"] and (r["score"] or 0) >= threshold)
    wrong_named = sum(1 for r in rows if not r["correct"] and (r["score"] or 0) >= threshold)
    rtf = infer_seconds / audio_seconds
    print(f"{n} versets · {audio_seconds / 60:.1f} min d'audio · RTF {rtf:.3f}")
    print(
        f"top-1 correct {correct / n:.1%} · nommés justes (>= seuil) {named / n:.1%} · "
        f"FAUX versets nommés {wrong_named}"
    )
    print(f"sorties avec voyelles : {sum(1 for r in rows if r['has_vowels']) / n:.1%}")
    for reciter, count in sorted(Counter(str(r["reciter"]) for r in rows).items()):
        sub = [r for r in rows if r["reciter"] == reciter]
        print(
            f"  {reciter:32s} {count:3d}  top-1 {sum(1 for r in sub if r['correct']) / count:.1%}"
        )
    for r in [r for r in rows if not r["correct"]][:8]:
        print(f"  MISS {r['reciter']} {r['ref']} -> {r['top1']} ({r['score']}) : {r['raw_text']}")

    if args.no_write:
        return 0
    rng = random.Random(args.seed)
    sample = sorted(
        rng.sample(rows, min(args.fixture, n)), key=lambda r: (str(r["reciter"]), str(r["ref"]))
    )
    out = ROOT / "tests" / "fixtures" / "asr" / f"{args.asr}_everyayah.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps({"engine": rows[0]["engine"], "samples": sample}, ensure_ascii=False, indent=1)
        + "\n",
        encoding="utf-8",
    )
    print(f"échantillon de {len(sample)} écrit dans {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
