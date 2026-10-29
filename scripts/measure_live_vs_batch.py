#!/usr/bin/env python3
"""Direct contre lot sur les mêmes sessions (ADR-0016) : combien de versets le direct manque-t-il ?

    python scripts/measure_live_vs_batch.py --session <dossier de session> [--session ...]
        [--surah N] [--max-seconds 0] [--out rapport.json]

Une « session » est un dossier de l'atelier : `source.*` (ou `listening/`) et
`prediction.recognition.json` (la référence du lot). Le flux est rejoué hors temps réel dans le vrai
service du direct (comme `measure_live_guided.py`), puis on compare les versets nommés aux versets
reconnus par le lot : manquants, en trop, ordre. Aucun texte coranique n'est écrit.
Variables : AQR_MODELS_DIR.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
for extra in (ROOT / "src", ROOT / "scripts"):
    if extra.is_dir() and str(extra) not in sys.path:
        sys.path.insert(0, str(extra))

from measure_live_guided import BLOCK_BYTES, named_verses, read_pcm  # noqa: E402


def batch_verses(prediction: Path) -> list[str]:
    """Versets reconnus par le lot, dans l'ordre, sans doublon consécutif."""
    document = json.loads(prediction.read_text(encoding="utf-8"))
    out: list[str] = []
    for interval in document["intervals"]:
        ref = interval.get("ref")
        if (
            ref
            and interval.get("status") in ("recognized", "inferred")
            and (not out or out[-1] != ref)
        ):
            out.append(ref)
    return out


def source_audio(session: Path) -> Path:
    for path in sorted(session.glob("source.*")):
        if path.suffix != ".json":
            return path
    raise FileNotFoundError(f"aucun source.* dans {session}")


def confirmed_verses(messages: list[dict[str, Any]]) -> list[str]:
    """Versets des messages CONFIRMED (ADR-0016), dans l'ordre, sans doublon consécutif."""
    out: list[str] = []
    for m in messages:
        if m.get("type") == "CONFIRMED":
            for interval in m.get("intervals", []):
                ref = interval.get("ref")
                if isinstance(ref, str) and (not out or out[-1] != ref):
                    out.append(ref)
    return out


def replay(factory: Any, pcm: bytes, surah: int | None, speed: float) -> list[dict[str, Any]]:
    """Rejoue le flux ; `speed` > 0 le cadence à cette vitesse (1 = temps réel : c'est ce que vit le
    micro, et la confirmation doit y tenir), 0 = aussi vite que possible."""
    stream = factory("measure-0001", None, False, surah)
    messages: list[dict[str, Any]] = []
    started = time.perf_counter()
    for i in range(0, len(pcm), BLOCK_BYTES):
        if speed > 0:
            due = started + (i / 32000) / speed
            time.sleep(max(0.0, due - time.perf_counter()))
        messages.extend(stream.push(pcm[i : i + BLOCK_BYTES]))
    messages.extend(stream.end())
    return messages


def compare(batch: list[str], heard_list: list[str]) -> dict[str, Any]:
    wanted, heard = set(batch), set(heard_list)
    return {
        "batch": len(wanted),
        "heard": len(heard),
        "found": len(wanted & heard),
        "missing": sorted(wanted - heard),
        "extra": sorted(heard - wanted),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session", action="append", type=Path, required=True)
    parser.add_argument("--surah", type=int, help="annoncer cette sourate (récitation guidée)")
    parser.add_argument("--speed", type=float, default=0.0, help="1 = temps réel, 0 = sans pause")
    parser.add_argument("--max-seconds", type=int, default=0)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    from aqr.app.live_service import ServiceOptions, load_engine, make_stream_factory
    from aqr.live.service_config import LiveServiceConfig

    engine = load_engine(
        ServiceOptions(
            models_dir=Path(os.environ["AQR_MODELS_DIR"]),
            lock_path=ROOT / "models" / "LOCK.json",
            corpus_dir=ROOT / "data" / "corpus",
            asr_threads=args.threads,
        ),
        os.environ,
    )
    factory = make_stream_factory(engine, LiveServiceConfig())
    report: list[dict[str, Any]] = []
    for session in args.session:
        pcm = read_pcm(source_audio(session), args.max_seconds or None)
        started = time.perf_counter()
        messages = replay(factory, pcm, args.surah, args.speed)
        spent = time.perf_counter() - started
        batch = batch_verses(session / "prediction.recognition.json")
        live, confirmed = named_verses(messages), confirmed_verses(messages)
        row: dict[str, Any] = {
            "session": session.name,
            "audio_s": round(len(pcm) / 32000, 1),
            "compute_s": round(spent, 1),
            "live_only": compare(batch, live),
            "with_confirmation": compare(batch, live + confirmed),
            # secondes de flux entre la fin d'un passage et l'arrivée de sa confirmation
            "confirmation_lag_s": [
                round(m["t"] - m["span"][1], 1) for m in messages if m["type"] == "CONFIRMED"
            ],
        }
        report.append(row)
        for label in ("live_only", "with_confirmation"):
            c = row[label]
            print(
                f"{session.name[:8]} · {row['audio_s']} s · {label:17s} · lot {c['batch']} versets "
                f"· retrouvés {c['found']} · manquants {len(c['missing'])} "
                f"· en trop {len(c['extra'])}",
                flush=True,
            )
            print(
                "   manquants:",
                " ".join(c["missing"]),
                "· en trop:",
                " ".join(c["extra"]),
                flush=True,
            )
        print("   délai de confirmation (s) :", row["confirmation_lag_s"], flush=True)
    if args.out:
        args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
