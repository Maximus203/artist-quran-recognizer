"""Client Python d'`aqr.live/1` (synchrone) : tests d'intégration, banc de mesure, outils.

Ce n'est PAS le client de production (l'écran « En direct » de l'atelier parlera au service depuis
le navigateur, étape 4) : c'est la référence exécutable du contrat. Il garde l'heure d'arrivée de
chaque message (`perf_counter`, la même horloge que le service s'il est sur la même machine) pour
mesurer le
délai que le service ajoute.
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from websockets.exceptions import ConnectionClosed
from websockets.sync.client import ClientConnection, connect

from aqr.live.protocol import CHANNELS, ENCODING, SAMPLE_RATE, SCHEMA


@dataclass
class Received:
    message: dict[str, Any]
    arrived_at: float


@dataclass
class LiveClient:
    url: str
    origin: str | None = None
    headers: dict[str, str] = field(default_factory=dict)
    received: list[Received] = field(default_factory=list)
    _conn: ClientConnection | None = None
    close_code: int | None = None
    close_reason: str = ""

    # ------------------------------------------------------------------ connexion
    def open(self, *, timeout: float = 5.0) -> LiveClient:
        """Ouvre la connexion. Un refus HTTP (origine, hôte, chemin) lève
        `websockets.exceptions.InvalidStatus`."""
        self._conn = connect(
            self.url,
            origin=self.origin,
            additional_headers=self.headers or None,
            open_timeout=timeout,
            compression=None,
            proxy=None,
            max_size=8 * 1024 * 1024,
        )
        return self

    @property
    def connection(self) -> ClientConnection:
        if self._conn is None:
            raise RuntimeError("connexion non ouverte")
        return self._conn

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._remember_close()

    def drop(self) -> None:
        """Coupure brutale (sans `END`, sans fermeture propre) : la session reste reprenable."""
        if self._conn is not None:
            self._conn.socket.close()

    def _remember_close(self) -> None:
        conn = self._conn
        if conn is not None and conn.protocol.close_code is not None:
            self.close_code = conn.protocol.close_code
            self.close_reason = conn.protocol.close_reason or ""

    def __enter__(self) -> LiveClient:
        return self.open() if self._conn is None else self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    # ------------------------------------------------------------------ envoi
    def start(
        self,
        token: str,
        *,
        translation: str | None = "french_hameedullah",
        technical: bool = False,
        resume: tuple[str, int] | None = None,
        audio: dict[str, Any] | None = None,
        schema: str = SCHEMA,
    ) -> None:
        body: dict[str, Any] = {
            "type": "START",
            "schema": schema,
            "token": token,
            "audio": audio
            or {"encoding": ENCODING, "sample_rate": SAMPLE_RATE, "channels": CHANNELS},
            "options": {"translation": translation or "none", "technical": technical},
        }
        if resume is not None:
            body["resume"] = {"session_id": resume[0], "last_seq": resume[1]}
        self.send_text(json.dumps(body))

    def send_text(self, text: str) -> None:
        self.connection.send(text)

    def send_audio(self, pcm: bytes) -> None:
        self.connection.send(pcm)

    def end(self) -> None:
        self.send_text('{"type":"END"}')

    # ------------------------------------------------------------------ réception
    def recv(self, timeout: float = 5.0) -> dict[str, Any] | None:
        """Le message suivant, ou None si rien n'arrive dans `timeout`. Lève `ConnectionClosed`
        (le code de fermeture est alors dans `close_code`)."""
        try:
            raw = self.connection.recv(timeout=timeout)
        except TimeoutError:
            return None
        except ConnectionClosed:
            self._remember_close()
            raise
        arrived = time.perf_counter()
        assert isinstance(raw, str), "le service n'envoie que du texte"
        message: dict[str, Any] = json.loads(raw)
        self.received.append(Received(message, arrived))
        return message

    def recv_until(
        self, stop: Callable[[dict[str, Any]], bool], timeout: float = 20.0
    ) -> list[dict[str, Any]]:
        """Reçoit jusqu'au premier message qui satisfait `stop` (inclus) ; lève `TimeoutError`."""
        deadline = time.monotonic() + timeout
        out: list[dict[str, Any]] = []
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                raise TimeoutError(f"message attendu non reçu ; vus : {[m['type'] for m in out]}")
            message = self.recv(timeout=left)
            if message is None:
                continue
            out.append(message)
            if stop(message):
                return out

    def listen(self) -> threading.Thread:
        """Reçoit en tâche de fond jusqu'à `FINAL` ou la fermeture : l'heure d'arrivée de chaque
        message est alors celle du réseau, pas celle où l'on appelle `recv` (mesure du délai)."""

        def loop() -> None:
            try:
                while True:
                    message = self.recv(timeout=0.5)
                    if message is not None and message["type"] == "FINAL":
                        return
            except ConnectionClosed:
                return

        thread = threading.Thread(target=loop, daemon=True, name="aqr-live-client")
        thread.start()
        return thread

    def drain(self, timeout: float = 5.0) -> list[dict[str, Any]]:
        """Tout jusqu'à la fermeture de la connexion (ou `timeout`)."""
        out: list[dict[str, Any]] = []
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                message = self.recv(timeout=max(0.01, deadline - time.monotonic()))
            except ConnectionClosed:
                break
            if message is not None:
                out.append(message)
        return out

    @property
    def last_seq(self) -> int:
        """Plus grand `seq` d'événement reçu (READY et ERROR portent 0 et ne comptent pas)."""
        return max((r.message["seq"] for r in self.received), default=0)

    def of_type(self, kind: str) -> list[dict[str, Any]]:
        return [r.message for r in self.received if r.message["type"] == kind]

    # ------------------------------------------------------------------ audio
    def stream(
        self,
        pcm: bytes,
        *,
        block_ms: int = 100,
        realtime: bool = False,
        offset_samples: int = 0,
        on_block: Callable[[int, float], None] | None = None,
    ) -> float:
        """Envoie `pcm` par blocs ; en temps réel (`realtime`) chaque bloc part à l'heure où son
        audio aurait fini d'être dit. Rend l'heure (perf_counter) du premier bloc envoyé."""
        size = SAMPLE_RATE * block_ms // 1000 * 2
        origin = time.perf_counter()
        start = offset_samples * 2
        for number, i in enumerate(range(start, len(pcm), size), start=1):
            block = pcm[i : i + size]
            if realtime:
                wait = origin + number * block_ms / 1000 - time.perf_counter()
                if wait > 0:
                    time.sleep(wait)
            sent_at = time.perf_counter()
            self.send_audio(block)
            if on_block is not None:
                on_block(number, sent_at)
        return origin


def pcm_from_floats(samples: Sequence[float]) -> bytes:
    """[-1, 1] -> PCM s16le (pour rejouer un audio chargé en flottants)."""
    from array import array

    ints = array("h", (max(-32768, min(32767, round(v * 32767))) for v in samples))
    return ints.tobytes()
