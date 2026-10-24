"""Horloges du direct : une seule échelle, le temps du flux (ADR-0011).

Le pipeline lit `clock()` pour mesurer son calcul et son retard. Trois horloges :

- `ManualClock` : temps scripté, pour les tests (le « calcul » est un `advance`) ;
- `SimulatedClock` : temps simulé + calcul RÉEL mesuré, pour rejouer un fichier sans attendre
  (chaque bloc arrive à l'heure où il aurait été dit, le calcul qui suit est le vrai) ;
- `WallClock` : l'horloge murale, pour rejouer à vitesse réelle (le rejeu dort jusqu'à l'heure
  du bloc).

Toutes rendent des secondes depuis le début du flux.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Protocol


class StreamClock(Protocol):
    def __call__(self) -> float: ...

    def begin(self, at_s: float) -> None:
        """Le traitement du bloc suivant commence à l'heure `at_s` du flux."""
        ...


class ManualClock:
    def __init__(self, start_s: float = 0.0) -> None:
        self._now = start_s

    def __call__(self) -> float:
        return self._now

    def begin(self, at_s: float) -> None:
        self._now = at_s

    def advance(self, seconds: float) -> None:
        if seconds < 0:
            raise ValueError("le temps ne recule pas")
        self._now += seconds


class SimulatedClock:
    """`begin(t)` pose l'heure simulée ; ensuite le temps avance au rythme réel du calcul."""

    def __init__(self, perf: Callable[[], float] = time.perf_counter) -> None:
        self._perf = perf
        self._base = 0.0
        self._mark = perf()

    def begin(self, at_s: float) -> None:
        self._base = at_s
        self._mark = self._perf()

    def __call__(self) -> float:
        return self._base + (self._perf() - self._mark)


class WallClock:
    """Horloge murale depuis `start()` ; `sleep_until` attend l'heure du flux demandée."""

    def __init__(
        self,
        now: Callable[[], float] = time.perf_counter,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._now = now
        self._sleep = sleep
        self._origin = now()

    def start(self) -> None:
        self._origin = self._now()

    def __call__(self) -> float:
        return self._now() - self._origin

    def begin(self, at_s: float) -> None:  # le temps mural ne se pose pas : il s'écoule
        del at_s

    def sleep_until(self, at_s: float) -> None:
        wait = at_s - self()
        if wait > 0:
            self._sleep(wait)
