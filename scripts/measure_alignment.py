#!/usr/bin/env python3
"""Mesure de l'alignement forcé (ADR-0006) sur des passages EveryAyah reconstitués.

Chaque passage = clips EveryAyah consécutifs d'une sourate, mis bout à bout (≤ `--max-passage-s`).
Référence de chaque verset = étendue de sa PAROLE dans son clip, par énergie (trames de 20 ms
dont la RMS dépasse `--energy-ratio` × la RMS maximale du clip) : une référence approchée, pas une
annotation humaine, qui dépend de la façon dont on définit la fin d'un son qui s'éteint (la mesure
la fait varier). On aligne la suite des versets du passage (texte du corpus) sur le treillis du
FastConformer et on compare début et fin de chaque verset.

Ce que la mesure dit : la précision des limites quand on SAIT quels versets sont dits (le cas de
la vérité terrain semi-automatique), sur des récitants qu'EveryAyah a pu fournir à l'entraînement du
modèle (plafond optimiste). Ce qu'elle ne dit pas : la tenue sur du vrai audio de prière ou
d'assise.

Usage :
    python scripts/measure_alignment.py --audio-dir $AQR_AUDIO_DIR/everyayah \\
        --models-dir $AQR_MODELS_DIR --out mesure.json
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from array import array
from dataclasses import dataclass
from pathlib import Path

from aqr.adapters.fastconformer import FastConformerConfig, FastConformerQuranASR
from aqr.adapters.ffmpeg_extractor import FfmpegAudioExtractor
from aqr.alignment.forced import AlignmentConfig, PassageAligner, emittable_encoder
from aqr.corpus.alignment_text import AlignmentTexts, recited_span
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.domain.models import TimeSpan, VerseRef
from aqr.domain.ports import AudioClip

ENERGY_FRAME_S = 0.02
TOLERANCE_MS = (100, 300, 500)


@dataclass(frozen=True)
class Placed:
    ref: VerseRef
    speech: TimeSpan  # étendue de parole, en temps du passage


def speech_extent(samples: array[float], rate: int, ratio: float) -> tuple[float, float]:
    step = round(ENERGY_FRAME_S * rate)
    rms = [
        (sum(x * x for x in samples[i : i + step]) / step) ** 0.5
        for i in range(0, len(samples) - step + 1, step)
    ]
    threshold = ratio * max(rms)
    active = [i for i, value in enumerate(rms) if value >= threshold]
    return active[0] * ENERGY_FRAME_S, (active[-1] + 1) * ENERGY_FRAME_S


def passages(
    reciter_dir: Path, extractor: FfmpegAudioExtractor, max_s: float, ratio: float
) -> list[tuple[AudioClip, list[Placed]]]:
    by_surah: dict[int, list[tuple[int, Path]]] = {}
    for path in sorted(reciter_dir.glob("[0-9]*.mp3")):
        by_surah.setdefault(int(path.stem[:3]), []).append((int(path.stem[3:]), path))
    out: list[tuple[AudioClip, list[Placed]]] = []
    for surah, files in sorted(by_surah.items()):
        samples: array[float] = array("f")
        placed: list[Placed] = []
        previous = None
        for ayah, path in files:
            clip = extractor.extract(path)
            seconds = len(clip.samples) / clip.sample_rate
            contiguous = previous is not None and ayah == previous + 1
            if placed and (not contiguous or len(samples) / clip.sample_rate + seconds > max_s):
                out.append((AudioClip(samples, 16000, f"{reciter_dir.name}/{surah}"), placed))
                samples, placed = array("f"), []
            offset = len(samples) / clip.sample_rate
            start, end = speech_extent(clip.samples, clip.sample_rate, ratio)  # type: ignore[arg-type]
            placed.append(Placed(VerseRef(surah, ayah), TimeSpan(offset + start, offset + end)))
            samples.extend(clip.samples)
            previous = ayah
        if placed:
            out.append((AudioClip(samples, 16000, f"{reciter_dir.name}/{surah}"), placed))
    return out


def summary(errors_ms: list[float]) -> dict[str, float | int]:
    absolute = [abs(e) for e in errors_ms]
    result: dict[str, float | int] = {
        "n": len(errors_ms),
        "median_abs_ms": round(statistics.median(absolute), 1),
        "median_signed_ms": round(statistics.median(errors_ms), 1),
        "max_abs_ms": round(max(absolute), 1),
    }
    for tolerance in TOLERANCE_MS:
        result[f"within_{tolerance}ms"] = round(
            sum(a <= tolerance for a in absolute) / len(absolute), 3
        )
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument(
        "--audio-dir", type=Path, required=True, help="dossier everyayah/<récitant>/"
    )
    parser.add_argument("--models-dir", type=Path, required=True)
    parser.add_argument("--lock", type=Path, default=Path("models/LOCK.json"))
    parser.add_argument("--corpus-dir", type=Path, default=Path("data/corpus"))
    parser.add_argument("--max-passage-s", type=float, default=40.0)
    parser.add_argument("--energy-ratio", type=float, default=0.05)
    parser.add_argument(
        "--boundary-ratios",
        type=float,
        nargs="+",
        default=[0.0, 0.02, 0.05, 0.1, 0.2],
        help="valeurs d'`AlignmentConfig.energy_ratio` balayées (0 = sans affinage par l'énergie)",
    )
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)

    corpus = TanzilCorpusRepository(args.corpus_dir)
    texts = AlignmentTexts.from_corpus_dir(args.corpus_dir, corpus)
    model = FastConformerQuranASR(
        FastConformerConfig(models_dir=args.models_dir, lock_path=args.lock)
    )
    extractor = FfmpegAudioExtractor()

    ratios = args.boundary_ratios
    starts_by: dict[float, list[float]] = {r: [] for r in ratios}
    ends: dict[float, list[float]] = {r: [] for r in ratios}
    worst: dict[float, list[tuple[float, str, str]]] = {r: [] for r in ratios}
    llrs: list[float] = []
    variants: dict[str, int] = {}
    failures: list[str] = []
    align_s = 0.0
    audio_s = 0.0
    for reciter in sorted(p for p in args.audio_dir.iterdir() if p.is_dir()):
        for clip, placed in passages(reciter, extractor, args.max_passage_s, args.energy_ratio):
            duration = len(clip.samples) / clip.sample_rate
            audio_s += duration
            lattice = model.lattice(clip, TimeSpan(0.0, duration))
            spans = [recited_span(p.ref, texts.word_count(p.ref)) for p in placed]
            for ratio in ratios:
                aligner = PassageAligner(
                    texts, emittable_encoder(model), AlignmentConfig(energy_ratio=ratio or None)
                )
                began = time.perf_counter()
                result = aligner.align(lattice, spans)
                align_s += time.perf_counter() - began
                if result is None:
                    failures.append(clip.source)
                    break
                for truth, aligned in zip(placed, result.spans, strict=True):
                    end_error = (aligned.time.end_s - truth.speech.end_s) * 1000
                    ends[ratio].append(end_error)
                    starts_by[ratio].append((aligned.time.start_s - truth.speech.start_s) * 1000)
                    worst[ratio].append((abs(end_error), reciter.name, str(truth.ref)))
                if ratio == ratios[0]:
                    llrs.append(result.evidence.llr_per_frame)
                    variants[result.variant.value] = variants.get(result.variant.value, 0) + 1

    report = {
        "reference": f"énergie (trames {ENERGY_FRAME_S * 1000:.0f} ms, ratio {args.energy_ratio})",
        "engine": model.engine,
        "passages": len(llrs),
        "audio_s": round(audio_s, 1),
        "failures": failures,
        "variants": variants,
        "llr_per_frame": {"median": round(statistics.median(llrs), 3), "min": round(min(llrs), 3)},
        "start_error": {str(r): summary(v) for r, v in starts_by.items()},
        "end_error": {str(r): summary(v) for r, v in ends.items()},
        "worst_end": {
            str(r): [
                {"abs_ms": round(e, 1), "reciter": who, "ref": ref}
                for e, who, ref in sorted(w)[-5:]
            ]
            for r, w in worst.items()
        },
        "align_compute_s_per_audio_s": round(align_s / audio_s / len(ratios), 4),
    }
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
