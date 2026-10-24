#!/usr/bin/env python3
"""Banc du service du direct (ADR-0011, étape 3) : délai ajouté, flux tenus, mémoire.

    python scripts/measure_live_service.py overhead --out o.json
    python scripts/measure_live_service.py latency  --audio A.wav [--audio B.wav ...] --out l.json
    python scripts/measure_live_service.py capacity --audio A.wav [--audio B.wav ...] --streams 1,4,8,12,16 --out c.json

Trois mesures, chacune avec un vrai client WebSocket sur le vrai serveur (loopback) :

- `overhead` : le service avec un faux ASR (zéro calcul) dans ce processus. Le délai « bloc envoyé ->
  message reçu » est alors tout ce que le service ajoute (JSON, fil, boucle réseau, TCP). Les mesures
  internes du service (attente avant traitement, écriture) sont données à côté.
- `latency` : le vrai service dans un AUTRE processus (`aqr live-serve`, vrai modèle), un client en
  temps réel. Le délai ajouté est la différence, événement par événement, entre « bloc envoyé ->
  message reçu » et « durée du calcul du même bloc hors réseau » (référence : le même moteur appelé
  directement, mêmes blocs). Même horloge (`perf_counter`) des deux côtés : même machine.
- `capacity` : N clients en temps réel en même temps sur le vrai service ; le bilan de chaque flux est
  lu dans le journal du service (`session.stats` : retard maximal, facteur temps réel).

Aucun texte coranique n'est écrit : des nombres et des références. Les audios sont lus, jamais
écrits. Variables : AQR_MODELS_DIR (le service réel). Dans un worktree : PYTHONPATH=<worktree>/src.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import math
import os
import re
import subprocess
import sys
import threading
import time
import wave
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT / "src", ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from aqr.adapters.ws.client import LiveClient  # noqa: E402
from aqr.adapters.ws.hmac_tokens import HmacTokenCodec  # noqa: E402

KEY = "bench-key-".ljust(40, "k")
RATE = 16000
BLOCK_MS = 100
BLOCK_BYTES = RATE * BLOCK_MS // 1000 * 2


# --------------------------------------------------------------------------- petits outils
def spread(values: Sequence[float], scale: float = 1.0) -> dict[str, Any]:
    if not values:
        return {"count": 0}
    ordered = sorted(v * scale for v in values)
    n = len(ordered)

    def pct(q: float) -> float:
        return ordered[min(n - 1, max(0, math.ceil(q * n) - 1))]

    median = ordered[n // 2] if n % 2 else (ordered[n // 2 - 1] + ordered[n // 2]) / 2
    return {
        "count": n,
        "median": round(median, 2),
        "p90": round(pct(0.9), 2),
        "p99": round(pct(0.99), 2),
        "max": round(ordered[-1], 2),
    }


def read_pcm(path: Path) -> bytes:
    with wave.open(str(path)) as wav:
        if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) != (RATE, 1, 2):
            raise SystemExit(f"{path} : WAV 16 kHz mono 16 bits attendu")
        return wav.readframes(wav.getnframes())


def memory_mb(pid: int) -> float | None:
    """Mémoire résidente d'un processus, en Mio (None si introuvable)."""
    if os.name == "nt":

        class Counters(ctypes.Structure):
            _fields_ = [
                ("cb", ctypes.c_ulong),
                ("PageFaultCount", ctypes.c_ulong),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        kernel = ctypes.windll.kernel32  # type: ignore[attr-defined]
        kernel.OpenProcess.restype = ctypes.c_void_p
        handle = kernel.OpenProcess(0x1010, False, pid)  # QUERY_INFORMATION | VM_READ
        if not handle:
            return None
        counters = Counters()
        counters.cb = ctypes.sizeof(Counters)
        ok = ctypes.windll.psapi.GetProcessMemoryInfo(  # type: ignore[attr-defined]
            ctypes.c_void_p(handle), ctypes.byref(counters), counters.cb
        )
        kernel.CloseHandle(ctypes.c_void_p(handle))
        return counters.WorkingSetSize / 2**20 if ok else None
    try:
        with open(f"/proc/{pid}/status", encoding="utf-8") as status:
            return next(int(line.split()[1]) / 1024 for line in status if line.startswith("VmRSS:"))
    except OSError:
        return None


# --------------------------------------------------------------------------- un client mesuré
@dataclass
class Run:
    messages: list[dict[str, Any]] = field(default_factory=list)
    arrivals: list[float] = field(default_factory=list)
    block_sent_at: list[float] = field(default_factory=list)
    end_sent_at: float = 0.0
    started_at: float = 0.0
    connect_s: float = 0.0
    close_code: int | None = None


def stream_once(
    url: str,
    codec: HmacTokenCodec,
    subject: str,
    pcm: bytes,
    *,
    realtime: bool = True,
    translation: str | None = "french_hameedullah",
    timeout_s: float = 300.0,
) -> Run:
    run = Run()
    client = LiveClient(url)
    opened = time.perf_counter()
    client.open()
    client.start(codec.issue(subject, 60, now=time.time()), translation=translation)
    ready = client.recv(30)
    run.connect_s = time.perf_counter() - opened
    if ready is None or ready["type"] != "READY":
        raise RuntimeError(f"pas de READY : {ready}")

    def on_block(_number: int, sent_at: float) -> None:
        run.block_sent_at.append(sent_at)

    run.started_at = client.stream(pcm, block_ms=BLOCK_MS, realtime=realtime, on_block=on_block)
    client.end()
    run.end_sent_at = time.perf_counter()
    client.recv_until(lambda m: m["type"] == "FINAL", timeout=timeout_s)
    run.messages = [r.message for r in client.received if r.message["seq"] > 0]
    run.arrivals = [r.arrived_at for r in client.received if r.message["seq"] > 0]
    run.close_code = client.close_code
    client.close()
    return run


# --------------------------------------------------------------------------- référence hors réseau
def reference_blocks(factory: Any, pcm: bytes, translation: str | None) -> list[tuple[int, float, dict[str, Any]]]:
    """(numéro de bloc, durée de calcul du bloc, message) pour chaque message du même flux appelé
    directement. Le bloc `-1` est la fin (END)."""
    stream = factory("reference-0001", translation, False)
    out: list[tuple[int, float, dict[str, Any]]] = []
    for number, i in enumerate(range(0, len(pcm), BLOCK_BYTES)):
        started = time.perf_counter()
        messages = stream.push(pcm[i : i + BLOCK_BYTES])
        spent = time.perf_counter() - started
        out.extend((number, spent, m) for m in messages)
    started = time.perf_counter()
    messages = stream.end()
    spent = time.perf_counter() - started
    out.extend((-1, spent, m) for m in messages)
    return out


def added_delays(run: Run, reference: list[tuple[int, float, dict[str, Any]]]) -> list[float]:
    """Pour chaque message : (réception - envoi du bloc qui l'a produit) - calcul de ce bloc hors réseau."""
    served = [(m, a) for m, a in zip(run.messages, run.arrivals, strict=True) if m["type"] != "PARTIAL"]
    expected = [r for r in reference if r[2]["type"] != "PARTIAL"]
    if [m["type"] for m, _a in served] != [r[2]["type"] for r in expected]:
        raise RuntimeError("le service et la référence n'ont pas produit les mêmes messages")
    delays = []
    for (_message, arrived), (block, spent, _ref) in zip(served, expected, strict=True):
        sent = run.end_sent_at if block < 0 else run.block_sent_at[block]
        delays.append((arrived - sent) - spent)
    return delays


# --------------------------------------------------------------------------- mesure 1 : overhead
def cmd_overhead(args: argparse.Namespace) -> dict[str, Any]:
    from tests.support.live_service import ServiceHarness, script_of

    script: list[tuple[str, float, float]] = []
    clock = 0.2
    for ayah in range(1, 11):
        words = script_of(f"67:{ayah}", start=clock, step=0.25)
        script.extend(words)
        clock = words[-1][2] + 0.4
    seconds = clock + 3.0
    from array import array

    pcm = array("h", [9830] * round(seconds * RATE)).tobytes()
    out: dict[str, Any] = {"audio_s": round(seconds, 1), "runs": []}
    for realtime in (True, False):
        with ServiceHarness(script=script, max_streams=4) as harness:
            run = stream_once(
                harness.url, harness.codec, "1", pcm, realtime=realtime, translation=None, timeout_s=120
            )
            reference = reference_blocks(harness.factory, pcm, None)
            delays = added_delays(run, reference)
            metrics = harness.server.metrics
            out["runs"].append(
                {
                    "realtime": realtime,
                    "messages": len(run.messages),
                    "added_delay_ms": spread(delays, 1000.0),
                    "service_ingress_wait_ms": spread(list(metrics.ingress_wait_s), 1000.0),
                    "service_compute_ms": spread(list(metrics.compute_s), 1000.0),
                    "service_egress_ms": spread(list(metrics.egress_s), 1000.0),
                    "connect_to_ready_ms": round(run.connect_s * 1000, 1),
                    "paused_reads": metrics.paused_reads,
                }
            )
    return out


# --------------------------------------------------------------------------- le vrai service
class RealService:
    """`aqr live-serve` dans un autre processus, journal dans un fichier."""

    def __init__(self, work: Path, port: int, **limits: int) -> None:
        self.log_path = work / f"service-{port}.log"
        self.port = port
        env = {
            **os.environ,
            "PYTHONPATH": str(ROOT / "src"),
            "PYTHONUTF8": "1",
            "AQR_LIVE_KEY": KEY,
            "AQR_LIVE_PORT": str(port),
            "AQR_LIVE_MAX_STREAMS": str(limits.get("max_streams", 64)),
            "AQR_LIVE_MAX_STREAMS_PER_ACCOUNT": str(limits.get("per_account", 64)),
            "AQR_LIVE_MAX_BACKLOG_S": "60",
            "AQR_LIVE_STALL_TIMEOUT_S": "120",
        }
        self._log = self.log_path.open("w", encoding="utf-8")
        self.started_at = time.perf_counter()
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "aqr.cli", "live-serve", "--asr-threads", str(limits.get("threads", 1))],
            cwd=ROOT,
            env=env,
            stdout=self._log,
            stderr=subprocess.STDOUT,
        )
        deadline = time.time() + 120
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError("le service s'est arrêté au démarrage :\n" + self.log_path.read_text("utf-8"))
            if "à l'écoute" in self.log_path.read_text("utf-8", errors="replace"):
                break
            time.sleep(0.3)
        else:
            raise RuntimeError("le service ne répond pas")
        self.startup_s = time.perf_counter() - self.started_at

    @property
    def url(self) -> str:
        return f"ws://127.0.0.1:{self.port}/live"

    def stats(self) -> list[dict[str, Any]]:
        """Les lignes `session.stats` du journal, en nombres."""
        text = self.log_path.read_text("utf-8", errors="replace")
        rows = []
        for line in text.splitlines():
            if "session.stats" not in line:
                continue
            row = dict(re.findall(r"(\w+)=(\S+)", line.split("session.stats", 1)[1]))
            rows.append(
                {
                    "outcome": row["outcome"],
                    "audio_s": float(row["audio_s"]),
                    "rtf": float(row["rtf"]),
                    "max_lag_s": float(row["max_lag_s"]),
                    "degraded_blocks": int(row["degraded_blocks"]),
                }
            )
        return rows

    def stop(self) -> None:
        self.proc.terminate()
        try:
            self.proc.wait(15)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        self._log.close()


def free_port() -> int:
    import socket

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


# --------------------------------------------------------------------------- mesure 2 : latency
def cmd_latency(args: argparse.Namespace) -> dict[str, Any]:
    from aqr.app.live_service import ServiceOptions, load_engine, make_stream_factory
    from aqr.live.service_config import LiveServiceConfig

    work = Path(args.work_dir)
    work.mkdir(parents=True, exist_ok=True)
    options = ServiceOptions(
        models_dir=Path(os.environ["AQR_MODELS_DIR"]),
        lock_path=ROOT / "models" / "LOCK.json",
        corpus_dir=ROOT / "data" / "corpus",
        asr_threads=args.threads,
    )
    engine = load_engine(options, os.environ)
    factory = make_stream_factory(engine, LiveServiceConfig())
    service = RealService(work, free_port(), threads=args.threads)
    codec = HmacTokenCodec(KEY)
    results: list[dict[str, Any]] = []
    try:
        idle_mb = memory_mb(service.proc.pid)
        for translation in ("french_hameedullah", None):
            for audio in args.audio:
                pcm = read_pcm(Path(audio))
                if args.max_seconds:
                    pcm = pcm[: args.max_seconds * RATE * 2]
                reference = reference_blocks(factory, pcm, translation)
                run = stream_once(service.url, codec, "1", pcm, translation=translation)
                delays = added_delays(run, reference)
                results.append(
                    {
                        "audio": Path(audio).name,
                        "translation": translation or "none",
                        "duration_s": round(len(pcm) / 2 / RATE, 1),
                        "messages": len(run.messages),
                        "by_type": {
                            kind: spread(
                                [d for d, m in zip(delays, [x for x in run.messages if x["type"] != "PARTIAL"], strict=True) if m["type"] == kind],
                                1000.0,
                            )
                            for kind in sorted({m["type"] for m in run.messages if m["type"] != "PARTIAL"})
                        },
                        "added_delay_ms": spread(delays, 1000.0),
                        "connect_to_ready_ms": round(run.connect_s * 1000, 1),
                    }
                )
        busy_mb = memory_mb(service.proc.pid)
        stats = service.stats()
    finally:
        service.stop()
    return {
        "service_startup_s": round(service.startup_s, 1),
        "service_memory_mb": {"idle": idle_mb and round(idle_mb), "after": busy_mb and round(busy_mb)},
        "runs": results,
        "session_stats": stats,
    }


# --------------------------------------------------------------------------- mesure 3 : capacity
def cmd_capacity(args: argparse.Namespace) -> dict[str, Any]:
    work = Path(args.work_dir)
    work.mkdir(parents=True, exist_ok=True)
    clips = [read_pcm(Path(a)) for a in args.audio]
    codec = HmacTokenCodec(KEY)
    service = RealService(work, free_port(), threads=args.threads)
    points: list[dict[str, Any]] = []
    try:
        idle_mb = memory_mb(service.proc.pid)
        for count in [int(x) for x in args.streams.split(",")]:
            before = len(service.stats())
            runs: dict[int, Run] = {}
            errors: list[str] = []

            def one(number: int) -> None:
                pcm = clips[number % len(clips)][: args.seconds * RATE * 2]
                try:
                    runs[number] = stream_once(
                        service.url, codec, f"acct-{count}-{number}", pcm, translation=None, timeout_s=args.seconds + 120
                    )
                except Exception as error:  # le banc dit ce qui a échoué
                    errors.append(f"{type(error).__name__}: {error}")

            threads = [threading.Thread(target=one, args=(n,), daemon=True) for n in range(count)]
            peak = [0.0]

            def watch() -> None:
                while any(t.is_alive() for t in threads):
                    peak[0] = max(peak[0], memory_mb(service.proc.pid) or 0.0)
                    time.sleep(1.0)

            watcher = threading.Thread(target=watch, daemon=True)
            started = time.perf_counter()
            for t in threads:
                t.start()
            watcher.start()
            for t in threads:
                t.join(args.seconds + 180)
            time.sleep(1.5)
            rows = service.stats()[before:]
            # retard perçu du client : (réception - heure de la voix) de chaque événement du flux
            delays = []
            for number, run in runs.items():
                for message, arrived in zip(run.messages, run.arrivals, strict=True):
                    if message["type"] in ("CANDIDATES", "LOCKED"):
                        delays.append((arrived - run.started_at) - message["t"])
            points.append(
                {
                    "streams": count,
                    "completed": len(runs),
                    "errors": errors[:3],
                    "wall_s": round(time.perf_counter() - started, 1),
                    "max_lag_s": spread([r["max_lag_s"] for r in rows]),
                    "rtf": spread([r["rtf"] for r in rows]),
                    "degraded_blocks": sum(r["degraded_blocks"] for r in rows),
                    "event_delay_s": spread(delays),
                    "memory_peak_mb": round(peak[0]),
                }
            )
            print(json.dumps(points[-1], ensure_ascii=False), flush=True)
    finally:
        service.stop()
    return {"service_startup_s": round(service.startup_s, 1), "idle_memory_mb": idle_mb and round(idle_mb), "points": points}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("overhead", "latency", "capacity"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--out", type=Path, required=True)
        cmd.add_argument("--work-dir", default=os.environ.get("TMP", "."))
        cmd.add_argument("--audio", action="append", default=[])
        cmd.add_argument("--threads", type=int, default=1)
        cmd.add_argument("--max-seconds", type=int, default=0)
        cmd.add_argument("--streams", default="1,4,8,12,16")
        cmd.add_argument("--seconds", type=int, default=90)
    args = parser.parse_args()
    result = {"overhead": cmd_overhead, "latency": cmd_latency, "capacity": cmd_capacity}[args.command](args)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
