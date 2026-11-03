#!/usr/bin/env python3
"""Banc du moteur incrémental du direct (ADR-0011, étape 2) : calcul réel, retard, latence.

Rejoue les entrées du banc de l'étape 1 (`measure_live_sim.py` : montages EveryAyah et mixages à
vérité calculée, extraits réels en lecture seule) dans `LivePipeline` avec le VRAI modèle (Muno
incrémental) et mesure ce que l'étape 1 ne pouvait pas mesurer : le temps de calcul.

    python scripts/measure_live_engine.py run         --inputs-dir I --work-dir W --threads 4
    python scripts/measure_live_engine.py report      --inputs-dir I --work-dir W --out rapport.json
    python scripts/measure_live_engine.py realtime    --inputs-dir I --work-dir W --input NOM
    python scripts/measure_live_engine.py threads     --inputs-dir I --work-dir W --input NOM
    python scripts/measure_live_engine.py concurrency --inputs-dir I --work-dir W --input NOM

`run` est reprenable (un résultat existant n'est pas refait). Trois lectures du même rejeu :
temps du flux (comme l'étape 1, sans calcul), temps de sortie (calcul et file d'attente compris :
la latence de bout en bout) et facteur temps réel (calcul / durée audio). Aucun texte coranique
n'est écrit : des références et des nombres. Les audios sont lus, jamais écrits.
Variables : AQR_MODELS_DIR. Dans un worktree, lancer avec `PYTHONPATH=<worktree>/src`.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import math
import os
import pickle
import sys
import threading
import time
from array import array
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if (ROOT / "src").is_dir() and str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import measure_live_sim as sim  # noqa: E402

from aqr.adapters.muno_incremental import MunoIncrementalASR, MunoIncrementalConfig  # noqa: E402
from aqr.data.mixer import read_wav  # noqa: E402
from aqr.domain.models import VerseRef  # noqa: E402
from aqr.domain.ports import AsrUpdate, HeardWord  # noqa: E402
from aqr.live.clocks import SimulatedClock, WallClock  # noqa: E402
from aqr.live.config import LiveConfig  # noqa: E402
from aqr.live.corpus_flow import load_prefix_index  # noqa: E402
from aqr.live.drive import replay_realtime, replay_simulated  # noqa: E402
from aqr.live.events import DegradationChanged, LiveEvent, PartialTranscript  # noqa: E402
from aqr.live.pipeline import Emission, LivePipeline  # noqa: E402
from aqr.live.simulation import (  # noqa: E402
    Scenario,
    ScenarioResult,
    TruthVerse,
    TruthZone,
    distribution,
    evaluate,
    summarize,
)

SAMPLE_RATE = 16000
BLOCK_S = 0.1
"""Taille de bloc d'un client typique (un navigateur envoie 20 à 100 ms)."""


# --------------------------------------------------------------------------- petits outils
def spread(values: Sequence[float]) -> dict[str, Any]:
    """Effectif, médiane, p90, p99 et maximum (None si vide)."""
    if not values:
        return {"count": 0, "median": None, "p90": None, "p99": None, "max": None}
    ordered = sorted(values)
    n = len(ordered)

    def pct(q: float) -> float:
        return ordered[min(n - 1, max(0, math.ceil(q * n) - 1))]

    median = ordered[n // 2] if n % 2 else (ordered[n // 2 - 1] + ordered[n // 2]) / 2
    return {
        "count": n,
        "median": round(median, 4),
        "p90": round(pct(0.9), 4),
        "p99": round(pct(0.99), 4),
        "max": round(ordered[-1], 4),
    }


class _Counters(ctypes.Structure):
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


def memory_mb() -> tuple[float, float]:
    """(mémoire résidente actuelle, pic) du processus, en Mio."""
    if os.name == "nt":
        counters = _Counters()
        counters.cb = ctypes.sizeof(_Counters)
        handle = ctypes.windll.kernel32.GetCurrentProcess()  # type: ignore[attr-defined]
        ctypes.windll.psapi.GetProcessMemoryInfo(  # type: ignore[attr-defined]
            ctypes.c_void_p(handle), ctypes.byref(counters), counters.cb
        )
        return counters.WorkingSetSize / 2**20, counters.PeakWorkingSetSize / 2**20
    import resource

    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    with open("/proc/self/status", encoding="utf-8") as status:
        current = next(int(line.split()[1]) / 1024 for line in status if line.startswith("VmRSS:"))
    return current, peak


class MemorySampler:
    """Relève la mémoire résidente toutes les `every_s` secondes pendant un rejeu."""

    def __init__(self, every_s: float = 1.0) -> None:
        self._every = every_s
        self._stop = threading.Event()
        self.samples: list[float] = []
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        while not self._stop.wait(self._every):
            self.samples.append(memory_mb()[0])

    def __enter__(self) -> MemorySampler:
        self.samples.append(memory_mb()[0])
        self._thread.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self._stop.set()
        self._thread.join()
        self.samples.append(memory_mb()[0])


def tracker_events(emissions: Sequence[Emission]) -> list[LiveEvent]:
    """Événements du suivi (sans le texte provisoire ni la dégradation) en temps du flux."""
    return [
        e.event
        for e in emissions
        if not isinstance(e.event, PartialTranscript | DegradationChanged)
    ]


def reclock(emissions: Sequence[Emission]) -> list[LiveEvent]:
    """Les événements du suivi, datés de leur SORTIE (calcul et file d'attente compris) :
    `evaluate` mesure alors la latence de bout en bout au lieu de la latence du flux."""
    return [
        replace(e.event, t=e.emitted_at_s)  # type: ignore[type-var]
        for e in emissions
        if not isinstance(e.event, PartialTranscript | DegradationChanged)
    ]


class RecordingAsr:
    """Enveloppe un `StreamingAsr` et garde les mots stabilisés (normalisés) : le banc de l'étape 1
    s'en sert pour dire ce qui a été entendu autour d'un verrou."""

    def __init__(self, inner: MunoIncrementalASR, skeleton: Any) -> None:
        self._inner = inner
        self._skeleton = skeleton
        self.riwaya = inner.riwaya
        self.sample_rate = inner.sample_rate
        self.heard: list[HeardWord] = []
        self.late_pieces = 0

    @property
    def engine(self) -> str:
        return self._inner.engine

    def open(self) -> RecordingSession:
        return RecordingSession(self, self._inner.open())


class RecordingSession:
    def __init__(self, owner: RecordingAsr, inner: Any) -> None:
        self._owner = owner
        self._inner = inner

    @property
    def received_s(self) -> float:
        return float(self._inner.received_s)

    def _keep(self, update: AsrUpdate) -> AsrUpdate:
        for stable in update.stable:
            text = self._owner._skeleton(stable.word.text)
            if text:
                self._owner.heard.append(
                    HeardWord(
                        text,
                        stable.word.time.start_s,
                        stable.word.time.end_s,
                        stable.arrival_s,
                        stable.word.confidence,
                    )
                )
        return update

    def feed(self, samples: Sequence[float]) -> AsrUpdate:
        return self._keep(self._inner.feed(samples))

    def finish(self) -> AsrUpdate:
        update = self._keep(self._inner.finish())
        self._owner.late_pieces += int(getattr(self._inner, "late_pieces", 0))
        return update


# --------------------------------------------------------------------------- entrées
def load_entries(inputs_dir: Path) -> list[dict[str, Any]]:
    entries = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(inputs_dir.glob("*.json"))]
    if not entries:
        sys.exit(f"aucune entrée dans {inputs_dir} (voir measure_live_sim.py --stage build)")
    real = [e["id"].split("-", 2)[2] for e in entries if e["kind"].startswith("real")]
    sim.check_dev_only(real)
    return entries


def load_samples(entry: dict[str, Any], max_s: float | None = None) -> array[float]:
    data = read_wav(Path(entry["audio"]), SAMPLE_RATE)
    limit = len(data) if max_s is None else min(len(data), round(max_s * SAMPLE_RATE))
    return array("f", (x / 32768.0 for x in data[:limit]))


def scenario_of(entry: dict[str, Any], words: Sequence[HeardWord], duration_s: float) -> Scenario:
    truth = entry["truth"]
    return Scenario(
        entry["id"],
        entry["kind"],
        tuple(words),
        duration_s,
        tuple(TruthVerse(VerseRef.parse(r), a, b) for r, a, b in truth["verses"]),
        tuple(TruthZone(a, b, k) for a, b, k in truth["zones"]),
    )


@dataclass
class Run:
    entry: dict[str, Any]
    duration_s: float
    audio_wall_s: float
    stats: dict[str, Any]
    result_stream: ScenarioResult
    result_emit: ScenarioResult
    stream_events: list[LiveEvent]
    scenario: Scenario
    degradations: list[dict[str, Any]]
    memory_mb: dict[str, float]
    late_pieces: int
    first_verse_start_s: float | None
    extra: dict[str, Any] = field(default_factory=dict)


def make_asr(args: argparse.Namespace) -> MunoIncrementalASR:
    models = Path(args.models_dir or os.environ["AQR_MODELS_DIR"])
    return MunoIncrementalASR(
        MunoIncrementalConfig(
            models_dir=models,
            lock_path=ROOT / "models" / "LOCK.json",
            device=args.device,
            intra_op_threads=args.threads,
            settle_s=args.settle_s,
            chunk_frames=args.chunk_frames,
        )
    )


def stats_summary(stats: Any, duration_s: float) -> dict[str, Any]:
    heavy = [c for c in stats.block_compute_s if c > 0.02]
    return {
        "blocks": stats.blocks,
        "audio_s": round(stats.audio_s, 3),
        "compute_s": round(stats.compute_s, 3),
        "asr_s": round(stats.asr_s, 3),
        "tracker_s": round(stats.tracker_s, 3),
        "realtime_factor": round(stats.realtime_factor, 4),
        "asr_realtime_factor": round(stats.asr_s / duration_s, 4) if duration_s else 0.0,
        "tracker_realtime_factor": round(stats.tracker_s / duration_s, 4) if duration_s else 0.0,
        "max_lag_s": round(stats.max_lag_s, 3),
        "lag_s": spread(stats.block_lag_s),
        "blocks_lag_over_1s": sum(1 for x in stats.block_lag_s if x > 1.0),
        "blocks_lag_over_5s": sum(1 for x in stats.block_lag_s if x > 5.0),
        "degraded_blocks": stats.degraded_blocks,
        "stable_words": stats.stable_words,
        "block_compute_s": spread(stats.block_compute_s),
        "heavy_block_compute_s": spread(heavy),
        "word_delay_s": spread(stats.word_delay_s),
        "first_partial_at_s": stats.first_partial_at_s,
        "first_word_at_s": stats.first_word_at_s,
    }


def run_one(
    entry: dict[str, Any],
    asr: MunoIncrementalASR,
    index: Any,
    skeleton: Any,
    config: LiveConfig,
    block_s: float,
) -> Run:
    samples = load_samples(entry)
    recorder = RecordingAsr(asr, skeleton)
    clock = SimulatedClock()
    pipeline = LivePipeline(recorder, index, skeleton, config=config, clock=clock)
    started = time.perf_counter()
    with MemorySampler() as memory:
        result = replay_simulated(pipeline, clock, samples, block_s)
    wall = time.perf_counter() - started
    duration = result.duration_s
    scenario = scenario_of(entry, recorder.heard, duration)
    stream = tracker_events(result.emissions)
    emit = reclock(result.emissions)
    verses = scenario.verses
    return Run(
        entry=entry,
        duration_s=duration,
        audio_wall_s=wall,
        stats=stats_summary(result.stats, duration),
        result_stream=evaluate(scenario, stream, index),
        result_emit=evaluate(scenario, emit, index),
        stream_events=stream,
        scenario=scenario,
        degradations=[
            {
                "t": e.event.t,
                "tier": e.event.tier,
                "overloaded": e.event.overloaded,
                "lag_s": round(e.event.lag_s, 2),
                "reason": e.event.reason,
            }
            for e in result.emissions
            if isinstance(e.event, DegradationChanged)
        ],
        memory_mb={
            "start": round(memory.samples[0], 1),
            "end": round(memory.samples[-1], 1),
            "max": round(max(memory.samples), 1),
        },
        late_pieces=recorder.late_pieces,
        first_verse_start_s=min((v.start_s for v in verses), default=None),
    )


def runs_dir(work: Path, tag: str) -> Path:
    return work / f"runs-{tag}"


def stage_run(args: argparse.Namespace) -> int:
    entries = load_entries(args.inputs_dir)
    if args.only:
        entries = [e for e in entries if any(token in e["id"] for token in args.only)]
    if args.limit:
        entries = entries[: args.limit]
    out = runs_dir(args.work_dir, args.tag)
    out.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    index, skeleton = load_prefix_index(args.corpus)
    asr = make_asr(args)
    asr.open()  # charge le modèle une fois ; mesure du démarrage à froid
    print(f"démarrage à froid : {time.perf_counter() - started:.1f} s", flush=True)
    config = LiveConfig()
    for entry in entries:
        target = out / f"{entry['id']}.pkl"
        if target.exists():
            continue
        run = run_one(entry, asr, index, skeleton, config, args.block_s)
        target.write_bytes(pickle.dumps(run))
        s = run.stats
        print(
            f"{entry['id']}: {run.duration_s:.0f} s, calcul {s['compute_s']:.1f} s "
            f"(x{s['realtime_factor']:.3f} dont ASR x{s['asr_realtime_factor']:.3f}, suivi "
            f"x{s['tracker_realtime_factor']:.3f}), retard max {s['max_lag_s']:.2f} s, "
            f"verrous {sum(1 for v in run.result_emit.verses if v.locked_correct)}"
            f"/{len(run.result_emit.verses)}, faux {len(run.result_emit.false_locks)}, "
            f"mémoire {run.memory_mb['max']:.0f} Mio",
            flush=True,
        )
    return 0


def load_runs(work: Path, tag: str) -> list[Run]:
    runs = [pickle.loads(p.read_bytes()) for p in sorted(runs_dir(work, tag).glob("*.pkl"))]
    if not runs:
        sys.exit(f"aucun rejeu dans {runs_dir(work, tag)} (étape run)")
    return runs


def stage_report(args: argparse.Namespace) -> int:
    runs = load_runs(args.work_dir, args.tag)
    index, _ = load_prefix_index(args.corpus)
    truth = [r for r in runs if r.entry["kind"] in ("sequence", "mix")]
    real = [r for r in runs if r.entry["kind"].startswith("real")]

    def first_latency(key: str) -> list[float]:
        values = []
        for r in truth:
            at = r.stats.get(key)
            if at is not None and r.first_verse_start_s is not None:
                values.append(at - r.first_verse_start_s)
        return values

    def aggregate(group: Sequence[Run]) -> dict[str, Any]:
        if not group:
            return {"inputs": 0}
        audio = sum(r.duration_s for r in group)
        return {
            "inputs": len(group),
            "audio_s": round(audio, 1),
            "compute_s": round(sum(r.stats["compute_s"] for r in group), 1),
            "asr_s": round(sum(r.stats["asr_s"] for r in group), 1),
            "tracker_s": round(sum(r.stats["tracker_s"] for r in group), 1),
            "realtime_factor": round(sum(r.stats["compute_s"] for r in group) / audio, 4),
            "asr_realtime_factor": round(sum(r.stats["asr_s"] for r in group) / audio, 4),
            "tracker_realtime_factor": round(sum(r.stats["tracker_s"] for r in group) / audio, 4),
            "per_input_realtime_factor": spread([r.stats["realtime_factor"] for r in group]),
            "max_lag_s": spread([r.stats["max_lag_s"] for r in group]),
            "heavy_block_compute_s": spread(
                [
                    r.stats["heavy_block_compute_s"]["p99"]
                    for r in group
                    if r.stats["heavy_block_compute_s"]["p99"] is not None
                ]
            ),
            "degraded_blocks": sum(r.stats["degraded_blocks"] for r in group),
            "inputs_degraded": sum(1 for r in group if r.degradations),
            "late_pieces": sum(r.late_pieces for r in group),
            "stable_words": sum(r.stats["stable_words"] for r in group),
            "memory_max_mb": max((r.memory_mb["max"] for r in group), default=0.0),
        }

    def word_delays(group: Sequence[Run]) -> dict[str, Any]:
        # les médianes par entrée suffisent : les mots bruts ne sont pas gardés
        return spread(
            [
                r.stats["word_delay_s"]["median"]
                for r in group
                if r.stats["word_delay_s"]["median"] is not None
            ]
        )

    report: dict[str, Any] = {
        "engine_settings": {
            "block_s": args.block_s,
            "device": args.device,
            "threads": args.threads,
            "settle_s": args.settle_s,
            "chunk_frames": args.chunk_frames,
            "config": LiveConfig().as_dict(),
        },
        "compute": {"all": aggregate(runs), "truth": aggregate(truth), "real": aggregate(real)},
        "word_delay_median_per_input_s": word_delays(runs),
        "first_partial_after_verse_start_s": spread(first_latency("first_partial_at_s")),
        "first_word_after_verse_start_s": spread(first_latency("first_word_at_s")),
        "truth_stream_time": summarize([r.result_stream for r in truth]),
        "truth_end_to_end": summarize([r.result_emit for r in truth]),
        "real": {},
        "false_lock_detail": [
            {"scenario": r.entry["id"], **sim.lock_evidence(index, r.scenario, r.stream_events, f)}
            for r in truth
            for f in r.result_stream.false_locks
        ],
    }
    for r in real:
        report["real"][r.entry["id"]] = {
            **sim.real_summary(r.entry, r.scenario, r.stream_events, r.result_stream, index),
            "end_to_end_t_locked_s": distribution(
                [v.t_locked for v in r.result_emit.verses if v.t_locked is not None]
            ),
            "end_to_end_t_first_candidates_s": distribution(
                [
                    v.t_first_candidates
                    for v in r.result_emit.verses
                    if v.t_first_candidates is not None
                ]
            ),
            "compute": {k: r.stats[k] for k in ("realtime_factor", "max_lag_s", "degraded_blocks")},
            "memory_mb": r.memory_mb,
        }
    report["by_group"] = {}
    groups: dict[str, list[Run]] = {}
    for r in truth:
        groups.setdefault(sim.group_name(r.entry), []).append(r)
    for name, group in sorted(groups.items()):
        report["by_group"][name] = {
            "locked": sum(1 for r in group for v in r.result_emit.verses if v.locked_correct),
            "verses": sum(len(r.result_emit.verses) for r in group),
            "false_locks": sum(len(r.result_emit.false_locks) for r in group),
            "realtime_factor": aggregate(group)["realtime_factor"],
        }
    report["per_input"] = [
        {
            "id": r.entry["id"],
            "duration_s": round(r.duration_s, 1),
            "realtime_factor": r.stats["realtime_factor"],
            "max_lag_s": r.stats["max_lag_s"],
            "locked": sum(1 for v in r.result_emit.verses if v.locked_correct),
            "verses": len(r.result_emit.verses),
            "false_locks": len(r.result_emit.false_locks),
            "memory_mb": r.memory_mb["max"],
        }
        for r in runs
    ]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("compute", "truth_end_to_end")}, indent=1)[:6000])
    print(f"rapport : {args.out}")
    return 0


# --------------------------------------------------------------------------- vitesse réelle
def stage_realtime(args: argparse.Namespace) -> int:
    entries = {e["id"]: e for e in load_entries(args.inputs_dir)}
    entry = entries[args.input]
    samples = load_samples(entry, args.max_seconds)
    index, skeleton = load_prefix_index(args.corpus)
    asr = make_asr(args)
    asr.open()
    config = LiveConfig()

    clock = SimulatedClock()
    simulated_pipe = LivePipeline(asr, index, skeleton, config=config, clock=clock)
    simulated = replay_simulated(simulated_pipe, clock, samples, args.block_s)

    wall = WallClock()
    real_pipe = LivePipeline(asr, index, skeleton, config=config, clock=wall)
    started = time.perf_counter()
    real = replay_realtime(real_pipe, wall, samples, args.block_s)
    wall_s = time.perf_counter() - started

    def key(e: Emission) -> tuple[str, str]:
        ev = e.event
        return type(ev).__name__, str(getattr(ev, "ref", ""))

    sim_by = {}
    for e in simulated.emissions:
        sim_by.setdefault(key(e), []).append(e)
    pairs = []
    for e in real.emissions:
        mates = sim_by.get(key(e), [])
        if mates:
            mate = mates.pop(0)
            pairs.append((e.emitted_at_s - mate.emitted_at_s, e.event.t - mate.event.t))
    diffs = [abs(d) for d, _ in pairs]
    out = {
        "input": entry["id"],
        "audio_s": round(real.duration_s, 2),
        "wall_s": round(wall_s, 2),
        "simulated": stats_summary(simulated.stats, real.duration_s),
        "realtime": stats_summary(real.stats, real.duration_s),
        "events_simulated": len(simulated.emissions),
        "events_realtime": len(real.emissions),
        "paired_events": len(pairs),
        "emission_time_gap_s": spread(diffs),
        "stream_time_gap_s": spread([abs(t) for _, t in pairs]),
    }
    print(json.dumps(out, indent=1))
    (args.work_dir / f"realtime-{entry['id']}.json").write_text(
        json.dumps(out, indent=1), encoding="utf-8"
    )
    return 0


# --------------------------------------------------------------------------- fils de calcul
def stage_threads(args: argparse.Namespace) -> int:
    entries = {e["id"]: e for e in load_entries(args.inputs_dir)}
    entry = entries[args.input]
    samples = load_samples(entry, args.max_seconds)
    index, skeleton = load_prefix_index(args.corpus)
    rows = []
    for threads in args.thread_list:
        args.threads = threads
        asr = make_asr(args)
        asr.open()
        providers = list(asr.session.get_providers())
        clock = SimulatedClock()
        pipe = LivePipeline(asr, index, skeleton, config=LiveConfig(), clock=clock)
        res = replay_simulated(pipe, clock, samples, args.block_s)
        s = res.stats
        rows.append(
            {
                "providers": providers,
                "threads": threads,
                "audio_s": round(res.duration_s, 1),
                "asr_realtime_factor": round(s.asr_s / res.duration_s, 4),
                "tracker_realtime_factor": round(s.tracker_s / res.duration_s, 4),
                "realtime_factor": round(s.realtime_factor, 4),
                "max_lag_s": round(s.max_lag_s, 3),
            }
        )
        print(rows[-1], flush=True)
    (args.work_dir / f"threads-{entry['id']}-{args.device}.json").write_text(
        json.dumps(rows, indent=1), encoding="utf-8"
    )
    return 0


# --------------------------------------------------------------------------- flux simultanés
def stage_concurrency(args: argparse.Namespace) -> int:
    """`--streams` flux rejoués EN MÊME TEMPS sur la même machine (un modèle chargé, une session
    par flux, un fil par flux) : le retard dit combien de flux tiennent."""
    entries = {e["id"]: e for e in load_entries(args.inputs_dir)}
    samples = load_samples(entries[args.input], args.max_seconds)
    index, skeleton = load_prefix_index(args.corpus)
    asr = make_asr(args)
    asr.open()
    results: list[dict[str, Any]] = []

    def one(number: int) -> None:
        clock = SimulatedClock()
        pipe = LivePipeline(asr, index, skeleton, config=LiveConfig(), clock=clock)
        res = replay_simulated(pipe, clock, samples, args.block_s)
        results.append(stats_summary(res.stats, res.duration_s) | {"stream": number})

    for streams in args.stream_list:
        results.clear()
        started = time.perf_counter()
        workers = [threading.Thread(target=one, args=(n,)) for n in range(streams)]
        for w in workers:
            w.start()
        for w in workers:
            w.join()
        wall = time.perf_counter() - started
        row = {
            "streams": streams,
            "threads_per_stream_session": args.threads,
            "audio_s_each": round(len(samples) / SAMPLE_RATE, 1),
            "wall_s": round(wall, 1),
            "aggregate_realtime_factor": round(wall / (len(samples) / SAMPLE_RATE), 3),
            "max_lag_s": spread([r["max_lag_s"] for r in results]),
            "degraded_blocks": sum(r["degraded_blocks"] for r in results),
        }
        print(row, flush=True)
        (args.work_dir / f"concurrency-{streams}.json").write_text(
            json.dumps(row, indent=1), encoding="utf-8"
        )
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("stage", choices=("run", "report", "realtime", "threads", "concurrency"))
    parser.add_argument("--inputs-dir", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--models-dir", type=Path, default=None)
    parser.add_argument("--corpus", type=Path, default=ROOT / "data" / "corpus")
    parser.add_argument("--tag", default="base", help="nom du jeu de rejeux (runs-<tag>)")
    parser.add_argument("--block-s", type=float, default=BLOCK_S)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--threads", type=int, default=0, help="fils ONNX (0 = tous)")
    parser.add_argument("--settle-s", type=float, default=0.8)
    parser.add_argument("--chunk-frames", type=int, default=112)
    parser.add_argument("--only", nargs="*", default=None, help="sous-chaînes d'identifiants")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--input", default=None, help="realtime/threads : identifiant d'entrée")
    parser.add_argument("--max-seconds", type=float, default=None)
    parser.add_argument("--stream-list", type=int, nargs="*", default=[1, 2, 4, 8, 16])
    parser.add_argument("--thread-list", type=int, nargs="*", default=[1, 2, 4, 8, 0])
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args(argv)
    args.work_dir.mkdir(parents=True, exist_ok=True)
    if args.out is None:
        args.out = args.work_dir / f"report-{args.tag}.json"
    if args.stage in ("realtime", "threads", "concurrency") and not args.input:
        parser.error("--input requis")
    return {
        "run": stage_run,
        "report": stage_report,
        "realtime": stage_realtime,
        "threads": stage_threads,
        "concurrency": stage_concurrency,
    }[args.stage](args)


if __name__ == "__main__":
    raise SystemExit(main())
