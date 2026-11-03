"""Fakes du port `StreamingAsr` (ADR-0011, étape 2) : sans modèle, sans horloge murale."""

from __future__ import annotations

from array import array
from collections.abc import Callable, Sequence

from aqr.domain.models import Riwaya, TimeSpan
from aqr.domain.ports import AsrUpdate, PartialText, StableWord, TranscribedWord

SAMPLE_RATE = 16000


class FakeStreamingASR:
    """Des mots scénarisés (texte, début, fin) que le « modèle » n'entend que s'il y a du son à cet
    endroit du flux, et livre `delay_s` après leur fin (tous, à `finish`).

    `on_feed(received_s)` est appelé à chaque bloc : les tests s'en servent pour faire avancer une
    horloge simulée (coût de calcul) sans dormir.
    """

    riwaya = Riwaya.HAFS
    sample_rate = SAMPLE_RATE
    engine = "fake-streaming-asr"

    def __init__(
        self,
        script: Sequence[tuple[str, float, float]],
        *,
        delay_s: float = 0.2,
        confidence: float = 0.9,
        on_feed: Callable[[float], None] | None = None,
    ) -> None:
        self.script = sorted(script, key=lambda w: w[1])
        self.delay_s = delay_s
        self.confidence = confidence
        self.on_feed = on_feed

    def open(self) -> FakeStreamingSession:
        return FakeStreamingSession(self)


class FakeStreamingSession:
    def __init__(self, owner: FakeStreamingASR) -> None:
        self._owner = owner
        self._samples: array[float] = array("f")
        self._delivered = 0
        self._finished = False

    @property
    def received_s(self) -> float:
        return len(self._samples) / SAMPLE_RATE

    def _audible(self, start_s: float, end_s: float) -> bool:
        a, b = round(start_s * SAMPLE_RATE), round(end_s * SAMPLE_RATE)
        return max((abs(x) for x in self._samples[a:b]), default=0.0) >= 1e-3

    def _update(self, *, flush: bool) -> AsrUpdate:
        owner = self._owner
        received = self.received_s
        stable: list[StableWord] = []
        while self._delivered < len(owner.script):
            text, start, end = owner.script[self._delivered]
            if end > received + 1e-9 or (not flush and end > received - owner.delay_s + 1e-9):
                break
            self._delivered += 1
            if self._audible(start, end):
                stable.append(
                    StableWord(
                        TranscribedWord(text, TimeSpan(start, end), owner.confidence),
                        arrival_s=received,
                    )
                )
        partial = None
        if not flush and self._delivered < len(owner.script):
            text, start, end = owner.script[self._delivered]
            if start < received and self._audible(start, min(end, received)):
                partial = PartialText(start, min(end, received), text[:1])
        return AsrUpdate(
            stable=tuple(stable), partial=partial, received_s=received, processed_s=received
        )

    def feed(self, samples: Sequence[float]) -> AsrUpdate:
        if self._finished:
            raise ValueError("flux déjà terminé")
        self._samples.extend(samples)
        if self._owner.on_feed is not None:
            self._owner.on_feed(self.received_s)
        return self._update(flush=False)

    def finish(self) -> AsrUpdate:
        if self._finished:
            return AsrUpdate(received_s=self.received_s, processed_s=self.received_s)
        self._finished = True
        return self._update(flush=True)
