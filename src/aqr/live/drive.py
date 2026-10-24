"""Rejeu d'un enregistrement comme un flux de blocs (ADR-0011, étape 2).

Deux modes, un seul pipeline :

- `replay_simulated` : temps simulé, sans attendre. Le bloc `k` « arrive » à l'heure où l'audio
  qu'il porte a fini d'être dit ; il est traité dès que le pipeline est libre (file d'attente : un
  calcul plus long que le bloc fait grandir le retard). Le calcul mesuré est le vrai
  (`SimulatedClock`), ce qui donne la latence de bout en bout sans durer autant que l'audio.
- `replay_realtime` : le rejeu dort jusqu'à l'heure de chaque bloc (horloge murale) ; ce qu'il
  mesure est ce que verrait un client. Plus long (autant que l'audio), il sert à valider le mode
  simulé et le facteur temps réel.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from aqr.live.clocks import StreamClock, WallClock
from aqr.live.pipeline import Emission, LivePipeline, PipelineStats


@dataclass(frozen=True)
class ReplayResult:
    emissions: list[Emission]
    stats: PipelineStats
    duration_s: float
    """Durée de l'audio rejoué."""
    finished_at_s: float
    """Heure (horloge du pipeline) à laquelle le dernier événement est sorti."""


def blocks_of(samples: Sequence[float], block_s: float, sample_rate: int) -> list[Sequence[float]]:
    """L'audio découpé en blocs de `block_s` secondes (le dernier peut être plus court)."""
    if block_s <= 0:
        raise ValueError("block_s doit être > 0")
    size = max(1, round(block_s * sample_rate))
    return [samples[i : i + size] for i in range(0, len(samples), size)]


def replay_simulated(
    pipeline: LivePipeline,
    clock: StreamClock,
    samples: Sequence[float],
    block_s: float,
) -> ReplayResult:
    rate = pipeline.sample_rate
    emissions: list[Emission] = []
    free_at = 0.0
    elapsed = 0
    for block in blocks_of(samples, block_s, rate):
        elapsed += len(block)
        arrives = elapsed / rate
        clock.begin(max(arrives, free_at))
        emissions.extend(pipeline.feed(block, received_at_s=arrives))
        free_at = clock()
    duration = len(samples) / rate
    clock.begin(max(duration, free_at))
    emissions.extend(pipeline.finish(received_at_s=duration))
    return ReplayResult(emissions, pipeline.stats, duration, clock())


def replay_realtime(
    pipeline: LivePipeline,
    wall: WallClock,
    samples: Sequence[float],
    block_s: float,
) -> ReplayResult:
    rate = pipeline.sample_rate
    emissions: list[Emission] = []
    wall.start()
    elapsed = 0
    for block in blocks_of(samples, block_s, rate):
        elapsed += len(block)
        arrives = elapsed / rate
        wall.sleep_until(arrives)
        emissions.extend(pipeline.feed(block, received_at_s=arrives))
    duration = len(samples) / rate
    emissions.extend(pipeline.finish(received_at_s=duration))
    return ReplayResult(emissions, pipeline.stats, duration, wall())
