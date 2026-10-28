#!/usr/bin/env python3
"""Récitation guidée contre écoute classique (ADR-0015) : mêmes audios, vrai moteur, deux modes.

    python scripts/measure_live_guided.py --audio A.wav --surah 112 [--audio B.mp3 --surah 91 ...]
        [--max-seconds 180] [--out rapport.json]

Pour chaque audio, le flux est rejoué hors temps réel dans le vrai service (`make_stream_factory`),
une fois sans sourate (classique : tout le Coran) et une fois avec la sourate annoncée (guidée).
On compare les versets nommés dans le document final : combien, dans quel ordre, combien hors de
la sourate annoncée, et ceux qui sautent par-dessus un verset. Aucun texte coranique n'est écrit :
des références et des nombres. Variables : AQR_MODELS_DIR.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if (ROOT / "src").is_dir() and str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))

RATE = 16000
BLOCK_BYTES = RATE * 2 // 10  # 100 ms


def read_pcm(path: Path, max_seconds: int | None) -> bytes:
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-i", str(path), "-ac", "1", "-ar", str(RATE)]
    if max_seconds:
        cmd += ["-t", str(max_seconds)]
    cmd += ["-f", "s16le", "-"]
    return subprocess.run(cmd, check=True, capture_output=True).stdout


def named_verses(messages: list[dict[str, Any]]) -> list[str]:
    """Versets nommés, dans l'ordre où le service les a verrouillés (sans doublon consécutif)."""
    out: list[str] = []
    for m in messages:
        if m.get("type") == "LOCKED":
            ref = (m.get("interval") or {}).get("ref")
            if isinstance(ref, str) and (not out or out[-1] != ref):
                out.append(ref)
    return out


def run_mode(factory: Any, pcm: bytes, surah: int | None) -> dict[str, Any]:
    stream = factory("measure-0001", None, False, surah)
    messages: list[dict[str, Any]] = []
    started = time.perf_counter()
    for i in range(0, len(pcm), BLOCK_BYTES):
        messages.extend(stream.push(pcm[i : i + BLOCK_BYTES]))
    messages.extend(stream.end())
    spent = time.perf_counter() - started
    verses = named_verses(messages)
    return {
        "named": verses,
        "n_named": len(verses),
        "compute_s": round(spent, 1),
        "audio_s": round(len(pcm) / (RATE * 2), 1),
    }


def score(named: list[str], surah: int) -> dict[str, Any]:
    inside = [v for v in named if v.split(":")[0] == str(surah)]
    numbers = [int(v.split(":")[1]) for v in inside]
    skipped = 0
    for a, b in zip(numbers, numbers[1:], strict=False):
        if b > a + 1:
            skipped += b - a - 1
    backwards = sum(1 for a, b in zip(numbers, numbers[1:], strict=False) if b < a)
    return {
        "outside_surah": len(named) - len(inside),
        "skipped_between": skipped,
        "backwards": backwards,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", action="append", required=True)
    parser.add_argument("--surah", action="append", type=int, required=True)
    parser.add_argument("--max-seconds", type=int, default=0)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--out")
    args = parser.parse_args()
    if len(args.audio) != len(args.surah):
        parser.error("un --surah par --audio")

    from aqr.app.live_service import ServiceOptions, load_engine, make_stream_factory
    from aqr.live.service_config import LiveServiceConfig

    options = ServiceOptions(
        models_dir=Path(os.environ["AQR_MODELS_DIR"]),
        lock_path=ROOT / "models" / "LOCK.json",
        corpus_dir=ROOT / "data" / "corpus",
        asr_threads=args.threads,
    )
    engine = load_engine(options, os.environ)
    factory = make_stream_factory(engine, LiveServiceConfig())
    report: list[dict[str, Any]] = []
    for audio, surah in zip(args.audio, args.surah, strict=True):
        pcm = read_pcm(Path(audio), args.max_seconds or None)
        row: dict[str, Any] = {"audio": Path(audio).name, "surah": surah}
        for mode, chosen in (("classic", None), ("guided", surah)):
            result = run_mode(factory, pcm, chosen)
            result.update(score(result["named"], surah))
            row[mode] = result
            print(
                f"{Path(audio).name} sourate {surah} · {mode:7s} · {result['n_named']} versets nommés "
                f"· hors sourate {result['outside_surah']} · sautés {result['skipped_between']} "
                f"· retours {result['backwards']} · {result['compute_s']} s de calcul",
                flush=True,
            )
            print("   ", " ".join(result["named"][:40]), flush=True)
        report.append(row)
    if args.out:
        Path(args.out).write_text(
            json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
