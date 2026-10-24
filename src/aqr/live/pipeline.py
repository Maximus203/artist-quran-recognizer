"""Pipeline du direct : blocs audio -> ASR incrémental -> suivi d'hypothèses (ADR-0011, étape 2).

`LivePipeline` orchestre UN flux (couche application) : il passe chaque bloc PCM à l'ASR incrémental
(`StreamingAsr`), normalise les mots stabilisés comme le flux du Coran, les donne à
`HypothesisTracker`, et rend des `Emission` : l'événement (`aqr.live/1` à l'étape 3) avec l'heure à
laquelle il sort, retard compris.

Budget (§7) : après l'ASR de chaque bloc, le retard (heure de fin de calcul - heure de réception du
bloc) est confié à `LiveBudget`. S'il change de palier, le pipeline le DIT (`DegradationChanged`) et
durcit la règle de verrou du suivi (jamais en dessous du réglage de base, I3) avant de lui donner
les mots du bloc. Les contrôles branchés (`VerseCheck`) ne tournent qu'au palier qui les permet, sur
l'audio gardé en mémoire (jamais écrit) pour eux seuls.

Aucune horloge murale ici : `clock` est injectée (voir `aqr.live.clocks`).
"""

from __future__ import annotations

import time
from array import array
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

from aqr.domain.models import VerseRef
from aqr.domain.ports import AsrUpdate, HeardWord, StreamingAsr, StreamingAsrSession
from aqr.live.budget import BudgetChange, BudgetConfig, LiveBudget, Tier, VerseCheck
from aqr.live.config import LiveConfig
from aqr.live.events import (
    Continue,
    DegradationChanged,
    LiveEvent,
    PartialTranscript,
    Revision,
)
from aqr.live.prefix_index import PrefixIndex
from aqr.live.tracker import HypothesisTracker

Clock = Callable[[], float]


@dataclass(frozen=True)
class Emission:
    """Un événement et l'instant où le pipeline le rend."""

    event: LiveEvent
    emitted_at_s: float
    """Heure du flux (horloge du pipeline) à la fin du traitement du bloc qui l'a produit."""
    lag_s: float
    """Retard de ce bloc : fin de traitement - heure de réception."""


@dataclass
class PipelineStats:
    blocks: int = 0
    audio_s: float = 0.0
    asr_s: float = 0.0
    tracker_s: float = 0.0
    checks_s: float = 0.0
    max_lag_s: float = 0.0
    degraded_blocks: int = 0
    stable_words: int = 0
    checks_run: dict[str, int] = field(default_factory=dict)
    checks_skipped: dict[str, int] = field(default_factory=dict)
    windows_lost: int = 0
    block_compute_s: list[float] = field(default_factory=list)

    @property
    def compute_s(self) -> float:
        return self.asr_s + self.tracker_s + self.checks_s

    @property
    def realtime_factor(self) -> float:
        """Calcul / durée de l'audio : < 1 suit le temps réel, > 1 prend du retard."""
        return self.compute_s / self.audio_s if self.audio_s else 0.0


class AudioRing:
    """Les dernières `max_s` secondes de l'audio d'un flux, en mémoire, pour les contrôles."""

    def __init__(self, max_s: float, sample_rate: int) -> None:
        self._rate = sample_rate
        self._max = round(max_s * sample_rate)
        self._samples: array[float] = array("f")
        self._dropped = 0

    @property
    def seconds(self) -> float:
        return len(self._samples) / self._rate

    def extend(self, samples: Sequence[float]) -> None:
        self._samples.extend(samples)
        extra = len(self._samples) - self._max
        if extra > 0:
            del self._samples[:extra]
            self._dropped += extra

    def window(self, start_s: float, end_s: float) -> Sequence[float] | None:
        """Les échantillons de [start, end[, ou None si le début est déjà sorti de la mémoire."""
        a = round(start_s * self._rate) - self._dropped
        b = round(end_s * self._rate) - self._dropped
        if a < 0 or b > len(self._samples):
            return None
        return self._samples[a:b]


class LivePipeline:
    def __init__(
        self,
        asr: StreamingAsr,
        index: PrefixIndex,
        skeleton: Callable[[str], str],
        *,
        config: LiveConfig | None = None,
        budget: BudgetConfig | None = None,
        checks: Sequence[VerseCheck] = (),
        clock: Clock = time.perf_counter,
    ) -> None:
        self._session: StreamingAsrSession = asr.open()
        self._sample_rate = asr.sample_rate
        self._skeleton = skeleton
        self._config = config or LiveConfig()
        self._tracker = HypothesisTracker(index, self._config)
        self._clock = clock
        self._checks = tuple(checks)
        available = max((c.tier for c in self._checks), default=Tier.ESSENTIAL)
        self._budget = LiveBudget(budget, available=available)
        self._ring = (
            AudioRing((budget or BudgetConfig()).ring_s, asr.sample_rate) if self._checks else None
        )
        self._stats = PipelineStats()
        self._last_partial: tuple[float, float, str] | None = None
        self._closed = False

    # ------------------------------------------------------------------ état
    @property
    def stats(self) -> PipelineStats:
        return self._stats

    @property
    def sample_rate(self) -> int:
        return self._sample_rate

    @property
    def lock_rule(self) -> tuple[int, float]:
        return self._tracker.lock_rule

    @property
    def tier(self) -> Tier:
        return self._budget.tier

    @property
    def retained_audio_s(self) -> float:
        return self._ring.seconds if self._ring is not None else 0.0

    # ------------------------------------------------------------------ flux
    def feed(
        self, samples: Sequence[float], *, received_at_s: float | None = None
    ) -> list[Emission]:
        """Un bloc de PCM 16 kHz mono. `received_at_s` : heure (horloge du pipeline) à laquelle le
        bloc a été reçu ; par défaut maintenant (le retard de file d'attente n'est alors pas vu)."""
        if self._closed:
            raise ValueError("flux déjà terminé")
        started = self._clock()
        received_at = started if received_at_s is None else received_at_s
        if self._ring is not None:
            self._ring.extend(samples)
        update = self._session.feed(samples)
        after_asr = self._clock()
        self._stats.asr_s += after_asr - started
        out: list[LiveEvent] = []
        lag = max(0.0, after_asr - received_at)
        change = self._budget.observe(lag)
        if change is not None:
            out.append(self._apply(change, update.received_s, lag))
        out.extend(self._partial(update))
        tracker_started = self._clock()
        out.extend(self._track(update))
        self._stats.tracker_s += self._clock() - tracker_started
        out.extend(self._run_checks(out, update.received_s))
        self._stats.blocks += 1
        self._stats.audio_s = update.received_s
        return self._emit(out, started, received_at, degraded=self._degraded())

    def finish(self, *, received_at_s: float | None = None) -> list[Emission]:
        """Fin du flux : l'ASR vide ses tampons, le suivi clôt le passage ouvert."""
        if self._closed:
            return []
        self._closed = True
        started = self._clock()
        received_at = started if received_at_s is None else received_at_s
        update = self._session.finish()
        after_asr = self._clock()
        self._stats.asr_s += after_asr - started
        out = list(self._track(update))
        out.extend(self._tracker.tick(update.received_s))
        out.extend(self._tracker.finish(update.received_s))
        out.extend(self._run_checks(out, update.received_s))
        self._stats.audio_s = update.received_s
        return self._emit(out, started, received_at, degraded=self._degraded())

    # ------------------------------------------------------------------ étapes
    def _track(self, update: AsrUpdate) -> list[LiveEvent]:
        events: list[LiveEvent] = []
        for stable in update.stable:
            text = self._skeleton(stable.word.text)
            if not text:
                continue
            word = HeardWord(
                text=text,
                start_s=stable.word.time.start_s,
                end_s=stable.word.time.end_s,
                arrival_s=stable.arrival_s,
                confidence=stable.word.confidence,
            )
            events.extend(self._tracker.tick(word.arrival_s))
            events.extend(self._tracker.feed(word))
            self._stats.stable_words += 1
        events.extend(self._tracker.tick(update.received_s))
        return events

    def _partial(self, update: AsrUpdate) -> list[LiveEvent]:
        partial = update.partial
        if partial is None:
            self._last_partial = None
            return []
        key = (partial.start_s, partial.end_s, partial.text)
        if key == self._last_partial:
            return []
        self._last_partial = key
        return [PartialTranscript(update.received_s, partial.start_s, partial.end_s, partial.text)]

    def _apply(self, change: BudgetChange, t: float, lag: float) -> LiveEvent:
        rule = self._budget.lock_rule(self._config)
        self._tracker.set_lock_rule(rule.min_words_lock, rule.tau_lock)
        return DegradationChanged(
            t=t,
            tier=int(change.tier),
            overloaded=change.overloaded,
            lag_s=lag,
            skipped=change.skipped,
            reason=change.reason,
            min_words_lock=rule.min_words_lock,
            tau_lock=rule.tau_lock,
        )

    def _degraded(self) -> bool:
        return self._budget.overloaded or bool(self._budget.skipped())

    def _run_checks(self, events: Sequence[LiveEvent], now_s: float) -> list[LiveEvent]:
        if not self._checks or self._ring is None:
            return []
        revisions: list[LiveEvent] = []
        for event in events:
            if not isinstance(event, Continue):
                continue
            for check in self._checks:
                revisions.extend(self._one_check(check, event, now_s))
        return revisions

    def _one_check(self, check: VerseCheck, event: Continue, now_s: float) -> list[LiveEvent]:
        stats = self._stats
        if check.tier > self._budget.tier:
            stats.checks_skipped[check.name] = stats.checks_skipped.get(check.name, 0) + 1
            return []
        assert self._ring is not None
        window = self._ring.window(event.start_s, event.end_s)
        if window is None:
            stats.checks_skipped[check.name] = stats.checks_skipped.get(check.name, 0) + 1
            stats.windows_lost += 1
            return []
        started = self._clock()
        verdict = check.check(event.ref, event.status, window, event.start_s, event.end_s)
        stats.checks_s += self._clock() - started
        stats.checks_run[check.name] = stats.checks_run.get(check.name, 0) + 1
        if verdict.accepted:
            return []
        return [_revision(now_s, event.ref, check.name, verdict.reason)]

    def _emit(
        self, events: Sequence[LiveEvent], started: float, received_at: float, *, degraded: bool
    ) -> list[Emission]:
        done = self._clock()
        lag = max(0.0, done - received_at)
        stats = self._stats
        stats.max_lag_s = max(stats.max_lag_s, lag)
        stats.block_compute_s.append(done - started)
        if degraded:
            stats.degraded_blocks += 1
        return [Emission(event, emitted_at_s=done, lag_s=lag) for event in events]


def _revision(t: float, ref: VerseRef, name: str, reason: str) -> Revision:
    return Revision(t, ref, f"check:{name}:{reason}" if reason else f"check:{name}")
