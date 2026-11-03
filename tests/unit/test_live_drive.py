"""Rejeu d'un fichier comme un flux : temps simulé et vitesse réelle (ADR-0011, étape 2)."""

from __future__ import annotations

from array import array

import pytest
from tests.support.live_toy import toy_index
from tests.support.streaming_fakes import FakeStreamingASR

from aqr.live.clocks import ManualClock, SimulatedClock, WallClock
from aqr.live.drive import blocks_of, replay_realtime, replay_simulated
from aqr.live.events import DegradationChanged, Locked
from aqr.live.pipeline import LivePipeline

RATE = 16000
WORDS = [
    (w, 0.2 + i * 0.5, 0.65 + i * 0.5)
    for i, w in enumerate(["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"])
]


def audio(seconds: float) -> array[float]:
    return array("f", [0.3] * round(seconds * RATE))


def pipeline(clock: ManualClock | WallClock | SimulatedClock, cost_s: float = 0.0, advance=None):  # type: ignore[no-untyped-def]
    asr = FakeStreamingASR(WORDS, on_feed=(lambda _t: advance(cost_s)) if advance else None)
    return LivePipeline(asr, toy_index(), lambda w: w, clock=clock)


def test_blocks_are_cut_to_the_requested_duration_and_keep_every_sample() -> None:
    samples = audio(1.05)
    parts = blocks_of(samples, 0.1, RATE)
    assert [len(p) for p in parts] == [1600] * 10 + [800]
    assert sum(len(p) for p in parts) == len(samples)


def test_a_block_duration_must_be_positive() -> None:
    with pytest.raises(ValueError):
        blocks_of(audio(1.0), 0.0, RATE)


def test_the_simulated_replay_does_not_wait_and_names_the_verse() -> None:
    clock = ManualClock()
    result = replay_simulated(pipeline(clock), clock, audio(5.0), block_s=0.1)
    locked = [e for e in result.emissions if isinstance(e.event, Locked)]
    assert len(locked) == 1
    assert result.stats.blocks == 50
    assert result.duration_s == pytest.approx(5.0)


def test_when_compute_is_faster_than_the_audio_a_block_leaves_when_it_arrives() -> None:
    clock = ManualClock()
    result = replay_simulated(pipeline(clock, 0.02, clock.advance), clock, audio(3.0), block_s=0.1)
    assert result.stats.max_lag_s == pytest.approx(0.02, abs=1e-6)
    assert all(e.lag_s < 0.05 for e in result.emissions)


def test_when_compute_is_slower_the_blocks_queue_and_the_lag_grows_by_the_difference() -> None:
    clock = ManualClock()
    result = replay_simulated(pipeline(clock, 0.25, clock.advance), clock, audio(4.0), block_s=0.1)
    # chaque bloc coûte 0,25 s pour 0,1 s d'audio : le retard gagne 0,15 s par bloc
    assert result.stats.max_lag_s == pytest.approx(0.25 + 0.15 * 39, abs=1e-6)
    assert any(isinstance(e.event, DegradationChanged) for e in result.emissions)
    assert result.finished_at_s > result.duration_s + 5.0


def test_the_real_compute_time_is_measured_in_the_simulation() -> None:
    ticks = iter(i * 0.01 for i in range(10_000))  # chaque lecture de l'horloge coûte 10 ms
    clock = SimulatedClock(perf=lambda: next(ticks))
    result = replay_simulated(pipeline(clock), clock, audio(1.0), block_s=0.5)
    assert result.stats.max_lag_s > 0.0


def test_the_realtime_replay_sleeps_until_each_block_is_due() -> None:
    now = {"t": 100.0}
    slept: list[float] = []

    def sleep(seconds: float) -> None:
        slept.append(seconds)
        now["t"] += seconds

    wall = WallClock(now=lambda: now["t"], sleep=sleep)
    result = replay_realtime(pipeline(wall), wall, audio(1.0), block_s=0.1)
    assert sum(slept) == pytest.approx(1.0, abs=1e-6)
    assert len(slept) == 10
    assert result.stats.blocks == 10


def test_the_realtime_replay_does_not_sleep_when_it_is_behind() -> None:
    now = {"t": 0.0}
    slept: list[float] = []

    def sleep(seconds: float) -> None:
        slept.append(seconds)
        now["t"] += seconds

    wall = WallClock(now=lambda: now["t"], sleep=sleep)

    def slow(_t: float) -> None:
        now["t"] += 0.3  # chaque bloc de 0,1 s coûte 0,3 s

    asr = FakeStreamingASR(WORDS, on_feed=slow)
    behind = LivePipeline(asr, toy_index(), lambda w: w, clock=wall)
    result = replay_realtime(behind, wall, audio(1.0), block_s=0.1)
    assert slept == [pytest.approx(0.1)]  # il n'a attendu que le premier bloc
    assert result.stats.max_lag_s > 1.5


def test_simulated_and_realtime_replays_give_the_same_events_when_nothing_lags() -> None:
    clock = ManualClock()
    simulated = replay_simulated(pipeline(clock), clock, audio(5.0), block_s=0.1)
    now = {"t": 0.0}
    wall = WallClock(now=lambda: now["t"], sleep=lambda s: now.__setitem__("t", now["t"] + s))
    real = replay_realtime(pipeline(wall), wall, audio(5.0), block_s=0.1)
    assert [e.event for e in simulated.emissions] == [e.event for e in real.emissions]
