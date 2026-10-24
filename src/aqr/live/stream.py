"""Un flux du direct (couche application) : audio validé -> pipeline -> messages `aqr.live/1`.

`LiveStream` est indépendant du réseau : il reçoit des blocs d'octets PCM 16 bits little-endian,
vérifie qu'ils sont valides (jamais de plantage : une `ProtocolError` avec un code), les passe à
`LivePipeline`, numérote les messages produits (`seq` strictement croissant) et les garde dans un
anneau borné pour la reprise. L'anneau ne contient que des messages, jamais de l'audio. Rien n'est
écrit sur disque ni dans le journal : l'audio vit le temps d'un bloc.
"""

from __future__ import annotations

import hashlib
import math
import sys
import threading
import time
from array import array
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from aqr.live.final import FinalDocumentBuilder
from aqr.live.pipeline import Emission, LivePipeline
from aqr.live.presenter import LivePresenter
from aqr.live.protocol import SAMPLE_RATE, ProtocolError, envelope

_PCM_SCALE = 32768.0


@dataclass(frozen=True)
class StreamLimits:
    max_block_bytes: int = 32_000
    """Un bloc de 1 s au plus (les clients envoient 20 à 100 ms)."""
    max_stream_s: float = 3600.0
    max_silence_s: float = 120.0
    silence_rms: float = 0.002
    """Niveau (sur [-1, 1]) sous lequel un bloc compte comme silence."""
    ring_messages: int = 500
    """Messages gardés pour la reprise (jamais de l'audio)."""

    def __post_init__(self) -> None:
        if self.max_block_bytes < 2 or self.max_block_bytes % 2:
            raise ValueError("max_block_bytes doit être un nombre pair >= 2")
        if self.max_stream_s <= 0 or self.max_silence_s <= 0 or self.silence_rms < 0:
            raise ValueError("durées maximales > 0 et silence_rms >= 0 requis")
        if self.ring_messages < 1:
            raise ValueError("ring_messages doit être >= 1")


def decode_pcm(pcm: bytes) -> tuple[array[float], float]:
    """(échantillons normalisés [-1, 1], niveau RMS) d'un bloc PCM s16le déjà validé."""
    ints = array("h")
    ints.frombytes(pcm)
    if sys.byteorder == "big":
        ints.byteswap()
    energy = sum(v * v for v in ints) / len(ints)
    return array("f", (v / _PCM_SCALE for v in ints)), math.sqrt(energy) / _PCM_SCALE


class LiveStream:
    def __init__(
        self,
        session_id: str,
        pipeline: LivePipeline,
        presenter: LivePresenter,
        final: FinalDocumentBuilder,
        limits: StreamLimits | None = None,
        clock: Callable[[], float] = time.perf_counter,
    ) -> None:
        self.session_id = session_id
        self._clock = clock
        self.pipeline = pipeline
        self._presenter = presenter
        self._final = final
        self._limits = limits or StreamLimits()
        self._samples = 0
        self._silent_s = 0.0
        self._digest = hashlib.sha256()
        self._seq = 0
        self._ring: deque[dict[str, Any]] = deque(maxlen=self._limits.ring_messages)
        self._lock = threading.Lock()
        self._ended = False

    # ------------------------------------------------------------------ état
    @property
    def seq(self) -> int:
        return self._seq

    last_seq = seq

    @property
    def audio_received_samples(self) -> int:
        return self._samples

    @property
    def audio_received_s(self) -> float:
        return self._samples / SAMPLE_RATE

    @property
    def ended(self) -> bool:
        return self._ended

    def degradation(self) -> tuple[str, ...]:
        return self.pipeline.degradation

    def now(self) -> float:
        """Heure du flux (horloge du pipeline) : à donner comme `received_at_s` d'un bloc reçu."""
        return self._clock()

    # ------------------------------------------------------------------ flux
    def push(self, pcm: bytes, *, received_at_s: float | None = None) -> list[dict[str, Any]]:
        """Un bloc PCM 16 kHz mono s16le. `received_at_s` : heure de réception (horloge du
        pipeline), pour que la file d'attente et la gigue réseau se voient comme du retard."""
        limits = self._limits
        if self._ended:
            raise ProtocolError("bad_message", "audio reçu après la fin du flux")
        size = len(pcm)
        if size == 0 or size % 2 or size > limits.max_block_bytes:
            raise ProtocolError("bad_audio_block", f"bloc de {size} octets")
        count = size // 2
        if self._samples + count > limits.max_stream_s * SAMPLE_RATE:
            raise ProtocolError("stream_too_long", f"plus de {limits.max_stream_s:g} s")
        samples, level = decode_pcm(pcm)
        silent_s = self._silent_s + count / SAMPLE_RATE if level < limits.silence_rms else 0.0
        if silent_s > limits.max_silence_s:
            raise ProtocolError("silence_too_long", f"plus de {limits.max_silence_s:g} s")
        self._silent_s = silent_s
        self._samples += count
        self._digest.update(pcm)
        return self._wrap(self.pipeline.feed(samples, received_at_s=received_at_s))

    def end(self, *, received_at_s: float | None = None) -> list[dict[str, Any]]:
        """Fin du flux : vide les tampons, clôt le passage ouvert, rend `FINAL`. Idempotent."""
        if self._ended:
            return []
        self._ended = True
        messages = [self._emit("FINALIZING", self.audio_received_s, {"pending_s": None})]
        messages += self._wrap(self.pipeline.finish(received_at_s=received_at_s))
        stats = self.pipeline.stats
        document = self._final.build(
            session_id=self.session_id,
            duration_s=self.audio_received_s,
            sha256=self._digest.hexdigest(),
            timing={
                "asr_s": stats.asr_s,
                "match_s": stats.tracker_s,
                "total_s": stats.compute_s,
            },
        )
        messages.append(self._emit("FINAL", self.audio_received_s, {"document": document}))
        return messages

    # ------------------------------------------------------------------ messages
    def _wrap(self, emissions: list[Emission]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for emission in emissions:
            self._final.observe(emission.event)
            for item in self._presenter.present(emission.event):
                out.append(self._emit(item.type, item.t, item.fields))
        return out

    def _emit(self, kind: str, t: float, fields: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self._seq += 1
            message = envelope(kind, self._seq, t=round(t, 3), **fields)
            self._ring.append(message)
            return message

    def messages_after(self, last_seq: int) -> list[dict[str, Any]] | None:
        """Les messages de numéro > `last_seq`, pour la reprise. None si le client annonce un
        numéro que le service n'a jamais émis, ou si l'anneau borné n'en remonte plus assez loin."""
        with self._lock:
            if last_seq > self._seq or last_seq < 0:
                return None
            if last_seq == self._seq:
                return []
            oldest = self._ring[0]["seq"] if self._ring else self._seq + 1
            if last_seq + 1 < oldest:
                return None
            return [m for m in self._ring if m["seq"] > last_seq]
