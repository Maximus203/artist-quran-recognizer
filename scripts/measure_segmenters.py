#!/usr/bin/env python3
"""Mesure de fond de la segmentation sur un extrait : recitation-segmenter-v2 contre Silero VAD.

Sans vérité terrain : ne rapporte AUCUNE précision, seulement la forme de la segmentation
(nombre de segments, durées, part de segments < 1 s, couverture de parole, temps de calcul), qui
suffit à voir un découpage mot à mot. Pour Silero, balaie `min_silence_ms` (le reste = défauts).

Données lues en lecture seule (rien n'est copié dans le dépôt). Le fichier est décodé en entier par
`FfmpegAudioExtractor` puis l'extrait est découpé.

Usage :
    OMP_NUM_THREADS=2 python scripts/measure_segmenters.py --audio lot1-05.mp3 --start 60 \\
        --duration 180 --models-dir <AQR_MODELS_DIR> --out mesure.json
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from array import array
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path

from aqr.domain.models import TimeSpan
from aqr.domain.ports import AudioClip, SpeechSegmenter

SHORT_SEGMENT_S = 1.0
"""Un segment plus court qu'une seconde ne contient guère plus d'un mot récité."""
SILERO_MIN_SILENCE_MS = (100, 300, 500, 800)


@dataclass(frozen=True)
class SpanStats:
    count: int
    median_s: float
    min_s: float
    max_s: float
    short_share: float
    """Part des segments de durée strictement inférieure à `SHORT_SEGMENT_S`."""
    speech_coverage: float
    """Somme des durées de segments / durée de l'extrait."""


def summarize_spans(spans: Sequence[TimeSpan], excerpt_s: float) -> SpanStats:
    if excerpt_s <= 0:
        raise ValueError(f"durée d'extrait invalide : {excerpt_s}")
    durations = [s.end_s - s.start_s for s in spans]
    if not durations:
        return SpanStats(0, 0.0, 0.0, 0.0, 0.0, 0.0)
    return SpanStats(
        count=len(durations),
        median_s=statistics.median(durations),
        min_s=min(durations),
        max_s=max(durations),
        short_share=sum(d < SHORT_SEGMENT_S for d in durations) / len(durations),
        speech_coverage=sum(durations) / excerpt_s,
    )


def _timed(segmenter: SpeechSegmenter, clip: AudioClip) -> tuple[list[TimeSpan], float]:
    started = time.perf_counter()
    spans = segmenter.segment(clip)
    return spans, time.perf_counter() - started


def _row(label: str, spans: list[TimeSpan], seconds: float, excerpt_s: float) -> dict[str, object]:
    stats = summarize_spans(spans, excerpt_s)
    return {"segmenter": label, **asdict(stats), "compute_s": round(seconds, 2)}


def _print(row: dict[str, object]) -> None:
    print(
        f"{row['segmenter']:34s} n={row['count']:3d}  méd {row['median_s']:5.2f}s  "
        f"min {row['min_s']:5.2f}s  max {row['max_s']:6.2f}s  <1s {row['short_share']:6.1%}  "
        f"couv. {row['speech_coverage']:6.1%}  calcul {row['compute_s']:6.2f}s",
        flush=True,
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--start", type=float, default=0.0, help="début de l'extrait (s)")
    parser.add_argument("--duration", type=float, default=180.0, help="durée de l'extrait (s)")
    parser.add_argument("--models-dir", type=Path, required=True)
    parser.add_argument("--lock", type=Path, default=Path("models/LOCK.json"))
    parser.add_argument("--out", type=Path, help="écrit les résultats en JSON")
    parser.add_argument("--skip-v2", action="store_true", help="ne mesure que Silero")
    args = parser.parse_args(argv)

    from aqr.adapters.ffmpeg_extractor import FfmpegAudioExtractor
    from aqr.adapters.segmenters import (
        RecitationSegmenterConfig,
        RecitationSegmenterV2,
        SileroVadConfig,
        SileroVadSegmenter,
    )

    full = FfmpegAudioExtractor().extract(args.audio)
    rate = full.sample_rate
    first = round(args.start * rate)
    last = min(len(full.samples), first + round(args.duration * rate))
    if first >= last:
        parser.error("extrait vide : --start au-delà de la fin du fichier")
    clip = AudioClip(
        samples=array("f", full.samples[first:last]),
        sample_rate=rate,
        source=f"{args.audio.name}[{args.start:g}s+{args.duration:g}s]",
    )
    excerpt_s = len(clip.samples) / rate
    print(f"extrait {clip.source} : {excerpt_s:.1f} s", flush=True)

    rows: list[dict[str, object]] = []
    if not args.skip_v2:
        v2 = RecitationSegmenterV2(
            RecitationSegmenterConfig(models_dir=args.models_dir, lock_path=args.lock, device="cpu")
        )
        spans, seconds = _timed(v2, clip)  # inclut le chargement du modèle
        rows.append(_row("recitation-segmenter-v2 (défaut)", spans, seconds, excerpt_s))
        _print(rows[-1])
    for silence_ms in SILERO_MIN_SILENCE_MS:
        silero = SileroVadSegmenter(SileroVadConfig(min_silence_ms=silence_ms))
        spans, seconds = _timed(silero, clip)  # inclut le chargement du modèle
        label = f"silero min_silence_ms={silence_ms}" + (" (défaut)" if silence_ms == 100 else "")
        rows.append(_row(label, spans, seconds, excerpt_s))
        _print(rows[-1])

    if args.out:
        args.out.write_text(
            json.dumps({"excerpt": clip.source, "excerpt_s": excerpt_s, "rows": rows}, indent=1)
            + "\n",
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
