"""Serveur WebSocket du direct (`aqr.live/1`) : le transport, rien d'autre (ADR-0011 étape 3).

Bibliothèque : `websockets` (asyncio). Python pur, sans dépendance, même comportement sous Windows
et Linux, vérifie les trames, gère `ping`/`pong`, la taille maximale d'un message et la fermeture
propre. `aiohttp` ou un serveur ASGI auraient apporté bien plus de code pour le même service.

Rôle de chaque pièce :

- `process_request` : refuse AVANT la poignée de main WebSocket l'hôte (`Host`, DNS rebinding),
  l'origine et le chemin hors politique (`AccessPolicy`) ; `/health` répond sans ouvrir de flux ;
- `_handle` : une connexion = `START` (jeton) -> `READY` -> blocs binaires -> `END` -> `FINAL` ;
- un `_Runner` par session : file d'attente d'audio, tâche qui passe chaque bloc au `LiveStream`
  dans un fil (le calcul ne bloque jamais la boucle réseau) et envoie les messages. Il survit à la
  connexion : après une coupure, les messages produits restent dans l'anneau du flux et sont
  rejoués à la reprise ;
- contre-pression : au-delà de `max_backlog_s` d'audio en attente, le service cesse de lire la
  connexion (TCP freine l'émetteur) ; au-delà de `stall_timeout_s` d'arrêt, il refuse le flux
  (`server_busy`) plutôt que de prendre un retard sans fin ;
- aucun audio n'est écrit, journalisé ou gardé après son traitement.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from collections import deque
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from http import HTTPStatus
from typing import Any

from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed
from websockets.http11 import Request, Response

from aqr.adapters.quranenc import TRANSLATION_METADATA
from aqr.live.access import AccessPolicy
from aqr.live.hub import LiveHub, LiveSession
from aqr.live.journal import journal, pseudonym
from aqr.live.protocol import (
    ERROR_CODES,
    SAMPLE_RATE,
    EndMessage,
    ProtocolError,
    StartMessage,
    envelope,
    error_message,
    parse_client_text,
)
from aqr.live.service_config import LiveServiceConfig

HEALTH_PATH = "/health"
CLOSE_NORMAL = 1000
CLOSE_GOING_AWAY = 1001
CLOSE_POLICY = 1008
CLOSE_INTERNAL = 1011
CLOSE_TRY_LATER = 1013
_REAP_EVERY_S = 1.0
_TOMBSTONES_MAX = 64
_METRIC_SAMPLES = 100_000


def dumps(message: dict[str, Any]) -> str:
    return json.dumps(message, ensure_ascii=False, separators=(",", ":"))


@dataclass
class ServiceMetrics:
    """Ce que le service ajoute, mesuré de l'intérieur (secondes, `perf_counter`)."""

    ingress_wait_s: deque[float] = field(default_factory=lambda: deque(maxlen=_METRIC_SAMPLES))
    """Trame reçue -> début du traitement (file d'attente)."""
    compute_s: deque[float] = field(default_factory=lambda: deque(maxlen=_METRIC_SAMPLES))
    """Durée du traitement d'un bloc (le moteur lui-même)."""
    egress_s: deque[float] = field(default_factory=lambda: deque(maxlen=_METRIC_SAMPLES))
    """Fin du traitement -> messages écrits sur la connexion."""
    max_backlog_s: float = 0.0
    paused_reads: int = 0
    blocks: int = 0


@dataclass(frozen=True)
class _Audio:
    pcm: bytes
    received_at_s: float
    frame_at: float


@dataclass(frozen=True)
class _Fail:
    code: str


@dataclass(frozen=True)
class _End:
    pass


@dataclass(frozen=True)
class _Expire:
    """La session est restée sans connexion trop longtemps : on garde son résultat un moment."""


_Item = _Audio | _Fail | _End | _Expire


@dataclass
class _Runner:
    session: LiveSession
    ws: ServerConnection | None = None
    sent_seq: int = 0
    queue: asyncio.Queue[_Item] = field(default_factory=asyncio.Queue)
    queued_samples: int = 0
    drained: asyncio.Event = field(default_factory=asyncio.Event)
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    done: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task[None] | None = None

    def __post_init__(self) -> None:
        self.drained.set()

    @property
    def backlog_s(self) -> float:
        return self.queued_samples / SAMPLE_RATE


class LiveWebSocketServer:
    def __init__(
        self,
        config: LiveServiceConfig,
        hub: LiveHub,
        access: AccessPolicy,
        *,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._config = config
        self._hub = hub
        self._access = access
        self._clock = clock
        self._server: Server | None = None
        self._runners: dict[str, _Runner] = {}
        self._tombstones: dict[str, tuple[str, float, list[dict[str, Any]], bool]] = {}
        self._pool = ThreadPoolExecutor(
            max_workers=config.max_streams, thread_name_prefix="aqr-live"
        )
        self._unauthenticated = 0
        self._reaper: asyncio.Task[None] | None = None
        self._stopping = False
        self.metrics = ServiceMetrics()

    # ------------------------------------------------------------------ cycle de vie
    async def start(self) -> None:
        config = self._config
        self._server = await serve(
            self._handle,
            config.host,
            config.port,
            process_request=self._process_request,
            compression=None,  # du PCM ne se comprime pas : de la CPU pour rien
            max_size=max(config.max_block_bytes, config.max_start_bytes) + 1024,
            max_queue=8,
            ping_interval=config.ping_interval_s,
            ping_timeout=config.ping_timeout_s,
            open_timeout=config.start_timeout_s,
            close_timeout=2,
            server_header=None,
            logger=_NullLogger(),
        )
        self._reaper = asyncio.create_task(self._reap())
        journal.info(
            "service.start", host=config.host, port=self.port, max_streams=config.max_streams
        )

    @property
    def port(self) -> int:
        assert self._server is not None
        return int(self._server.sockets[0].getsockname()[1])

    async def stop(self) -> None:
        """Arrêt propre : plus de nouvelle connexion, les flux en cours sont prévenus et fermés."""
        self._stopping = True
        if self._reaper is not None:
            self._reaper.cancel()
        runners = list(self._runners.values())
        # d'abord dire pourquoi à TOUS les flux, ensuite seulement fermer (fermer le serveur coupe
        # les connexions d'un coup, avant que la phrase ne parte)
        await asyncio.gather(
            *(self._send_error(r.ws, "service_stopping") for r in runners), return_exceptions=True
        )
        if self._server is not None:
            self._server.close()
        for runner in runners:
            if runner.ws is not None:
                with contextlib.suppress(Exception):
                    await runner.ws.close(CLOSE_GOING_AWAY, "arret_du_service")
            if runner.task is not None:
                runner.task.cancel()
        if self._server is not None:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self._server.wait_closed(), timeout=5)
        self._pool.shutdown(wait=False, cancel_futures=True)
        journal.info("service.stop", sessions=len(self._runners))

    async def serve_forever(self) -> None:
        assert self._server is not None
        await self._server.serve_forever()

    # ------------------------------------------------------------------ poignée de main
    def _process_request(self, connection: ServerConnection, request: Request) -> Response | None:
        headers = request.headers
        path = request.path.split("?", 1)[0]
        if self._stopping:
            return connection.respond(HTTPStatus.SERVICE_UNAVAILABLE, "Service en arrêt.\n")
        try:
            host, origin, forwarded = (
                headers.get("Host"),
                headers.get("Origin"),
                headers.get("X-Forwarded-Host"),
            )
        except Exception:  # un en-tête présent deux fois est ambigu (jamais accepté)
            journal.warning("handshake.refused", reason="duplicate_header")
            return connection.respond(HTTPStatus.BAD_REQUEST, "En-têtes en double.\n")
        if not self._access.allows(host, origin, forwarded):
            journal.warning("handshake.refused", reason="host_or_origin")
            return connection.respond(HTTPStatus.FORBIDDEN, "Hôte ou origine refusés.\n")
        if path == HEALTH_PATH:
            body = {
                "status": "ok",
                "streams": self._hub.active_count,
                "capacity": self._config.max_streams,
            }
            response = connection.respond(HTTPStatus.OK, dumps(body) + "\n")
            response.headers["Content-Type"] = "application/json"
            return response
        if path != self._config.path:
            return connection.respond(HTTPStatus.NOT_FOUND, "Chemin inconnu.\n")
        return None

    # ------------------------------------------------------------------ connexion
    async def _handle(self, ws: ServerConnection) -> None:
        if self._unauthenticated >= self._config.max_unauthenticated:
            await self._send_error(ws, "server_busy")
            await ws.close(CLOSE_TRY_LATER, "serveur_occupe")
            return
        self._unauthenticated += 1
        counted = True
        runner: _Runner | None = None
        generation = 0
        try:
            start = await self._read_start(ws)
            now = self._clock()
            claims = self._hub.authenticate(start.token, now)
            if start.resume is not None:
                resumed = await self._resume(ws, claims, start, now)
                if resumed is None:
                    return  # session expirée : son résultat a été rendu, la connexion est fermée
                runner, generation = resumed
            else:
                session = self._hub.open_session(claims, start, now)
                runner = self._runner_for(session)
                generation = session.generation
                async with runner.send_lock:
                    runner.ws = ws
                    await ws.send(dumps(self._ready(runner, resumed=False, replay_from=None)))
            self._unauthenticated -= 1
            counted = False
            await self._read_audio(ws, runner, generation)
        except ProtocolError as error:
            await self._refuse(ws, error)
        except ConnectionClosed:
            if (
                runner is not None
                and ws.protocol.close_rcvd_then_sent is True
                and not runner.done.is_set()
            ):
                # le client a fermé (page quittée, fermeture voulue) : le flux est fini et la place
                # rendue. Une coupure SANS trame de fermeture (réseau perdu) reste reprenable.
                await runner.queue.put(_End())
        except asyncio.CancelledError:
            raise
        except Exception as error:
            journal.error("connection.failed", error=type(error).__name__)
            await self._refuse(ws, ProtocolError("internal"), close=CLOSE_INTERNAL)
        finally:
            if counted:
                self._unauthenticated -= 1
            if runner is not None and runner.ws is ws:
                runner.ws = None
                if not runner.done.is_set():
                    self._hub.detach(runner.session, self._clock())

    async def _read_start(self, ws: ServerConnection) -> StartMessage:
        config = self._config
        try:
            first = await asyncio.wait_for(ws.recv(), timeout=config.start_timeout_s)
        except TimeoutError as error:
            raise ProtocolError("start_timeout") from error
        if not isinstance(first, str):
            raise ProtocolError("bad_message", "le premier message doit être START")
        message = parse_client_text(
            first, max_bytes=config.max_start_bytes, translations=frozenset(TRANSLATION_METADATA)
        )
        if isinstance(message, EndMessage):
            raise ProtocolError("bad_message", "END avant START")
        return message

    async def _resume(
        self, ws: ServerConnection, claims: Any, start: StartMessage, now: float
    ) -> tuple[_Runner, int] | None:
        assert start.resume is not None
        request = start.resume
        runner = self._runners.get(request.session_id)
        if runner is None:
            tomb = self._tombstones.get(request.session_id)
            if tomb is not None and tomb[0] == claims.subject and tomb[1] > now:
                # le résultat d'une session expirée (ou terminée sans que le client l'ait reçu)
                # est rendu une fois
                if tomb[3]:
                    await ws.send(dumps(error_message("session_expired")))
                for message in tomb[2]:
                    await ws.send(dumps(message))
                del self._tombstones[request.session_id]
                await ws.close(CLOSE_NORMAL, "session_expiree")
                return None
            raise ProtocolError("session_expired")
        async with runner.send_lock:
            session, replay = self._hub.resume_session(claims, request, now)
            previous = runner.ws
            runner.ws = ws
            runner.sent_seq = request.last_seq
            await ws.send(
                dumps(
                    self._ready(
                        runner,
                        resumed=True,
                        replay_from=replay[0]["seq"] if replay else None,
                    )
                )
            )
            for message in replay:
                await ws.send(dumps(message))
                runner.sent_seq = message["seq"]
        if previous is not None and previous is not ws:
            with contextlib.suppress(Exception):
                await previous.close(CLOSE_POLICY, "remplacee_par_une_reprise")
        return runner, session.generation

    def _ready(self, runner: _Runner, *, resumed: bool, replay_from: int | None) -> dict[str, Any]:
        stream = runner.session.stream
        config = self._config
        return envelope(
            "READY",
            0,
            session_id=runner.session.id,
            resumed=resumed,
            last_seq=stream.seq,
            replay_from=replay_from,
            audio_received_s=round(stream.audio_received_s, 3),
            audio_received_samples=stream.audio_received_samples,
            degraded=list(stream.degradation()),
            technical=stream.technical,
            resume_ttl_s=config.resume_ttl_s,
            limits={
                "max_block_bytes": config.max_block_bytes,
                "max_stream_s": config.max_stream_s,
                "max_silence_s": config.max_silence_s,
                "idle_timeout_s": config.idle_timeout_s,
                "resume_ttl_s": config.resume_ttl_s,
                "recommended_block_ms": [20, 100],
            },
        )

    # ------------------------------------------------------------------ lecture
    def _runner_for(self, session: LiveSession) -> _Runner:
        runner = _Runner(session)
        self._runners[session.id] = runner
        runner.task = asyncio.create_task(self._work(runner))
        return runner

    async def _read_audio(self, ws: ServerConnection, runner: _Runner, generation: int) -> None:
        config = self._config
        stream = runner.session.stream
        while True:
            if runner.session.generation != generation or runner.done.is_set():
                return
            if not await self._wait_capacity(runner):
                return
            try:
                frame = await asyncio.wait_for(ws.recv(), timeout=config.idle_timeout_s)
            except TimeoutError:
                await self._send_error(ws, "idle_timeout")
                await ws.close(CLOSE_NORMAL, "inactivite")
                return
            if runner.session.generation != generation:
                return
            if isinstance(frame, str):
                try:
                    message = parse_client_text(frame, max_bytes=config.max_start_bytes)
                except ProtocolError as error:
                    await runner.queue.put(_Fail(error.code))
                    await runner.done.wait()
                    return
                if isinstance(message, EndMessage):
                    await runner.queue.put(_End())
                    await runner.done.wait()
                    return
                await runner.queue.put(_Fail("bad_message"))  # un second START
                await runner.done.wait()
                return
            size = len(frame)
            if size == 0 or size % 2 or size > config.max_block_bytes:
                await runner.queue.put(_Fail("bad_audio_block"))
                await runner.done.wait()
                return
            runner.queued_samples += size // 2
            runner.drained.clear()
            self.metrics.max_backlog_s = max(self.metrics.max_backlog_s, runner.backlog_s)
            await runner.queue.put(_Audio(bytes(frame), stream.now(), time.perf_counter()))

    async def _wait_capacity(self, runner: _Runner) -> bool:
        """Contre-pression : tant que trop d'audio attend, on ne lit plus la connexion. Rend False
        si le service est resté dépassé trop longtemps : le flux est alors refusé et terminé."""
        config = self._config
        if runner.backlog_s < config.max_backlog_s:
            return True
        self.metrics.paused_reads += 1
        try:
            await asyncio.wait_for(self._until_below(runner), timeout=config.stall_timeout_s)
        except TimeoutError:
            journal.warning("backpressure.stall", session=runner.session.id)
            await runner.queue.put(_Fail("server_busy"))
            await runner.done.wait()
            return False
        return True

    async def _until_below(self, runner: _Runner) -> None:
        while runner.backlog_s >= self._config.max_backlog_s:
            runner.drained.clear()
            await runner.drained.wait()

    # ------------------------------------------------------------------ traitement
    async def _work(self, runner: _Runner) -> None:
        loop = asyncio.get_running_loop()
        stream = runner.session.stream
        try:
            while True:
                item = await runner.queue.get()
                if isinstance(item, _Audio):
                    started = time.perf_counter()
                    try:
                        messages = await loop.run_in_executor(
                            self._pool, _push, stream, item.pcm, item.received_at_s
                        )
                    except ProtocolError as error:
                        await self._fail(runner, loop, error.code)
                        return
                    finished = time.perf_counter()
                    runner.queued_samples -= len(item.pcm) // 2
                    if runner.backlog_s < self._config.max_backlog_s:
                        runner.drained.set()
                    await self._send_new(runner, messages)
                    sent = time.perf_counter()
                    metrics = self.metrics
                    metrics.blocks += 1
                    metrics.ingress_wait_s.append(started - item.frame_at)
                    metrics.compute_s.append(finished - started)
                    if messages:
                        metrics.egress_s.append(sent - finished)
                elif isinstance(item, _End):
                    await self._finish(runner, loop, error=None)
                    return
                elif isinstance(item, _Expire):
                    messages = await loop.run_in_executor(self._pool, _end, stream, stream.now())
                    self._remember(runner.session, messages, self._clock())
                    self._log_stats(runner, "expired")
                    self._release(runner)
                    return
                else:
                    await self._fail(runner, loop, item.code)
                    return
        except asyncio.CancelledError:
            raise
        except Exception as error:
            journal.error("worker.failed", session=runner.session.id, error=type(error).__name__)
            await self._send_error(runner.ws, "internal")
            self._hub.finish(runner.session)
            self._release(runner)
            await self._close(runner, CLOSE_INTERNAL, "interne")

    async def _fail(self, runner: _Runner, loop: asyncio.AbstractEventLoop, code: str) -> None:
        """Erreur fatale du flux : on le dit, puis on rend ce qui a été décidé (`FINAL`)."""
        await self._finish(runner, loop, error=code)

    async def _finish(
        self, runner: _Runner, loop: asyncio.AbstractEventLoop, *, error: str | None
    ) -> None:
        stream = runner.session.stream
        messages = await loop.run_in_executor(self._pool, _end, stream, stream.now())
        if error is not None:
            await self._send_error(runner.ws, error)
        await self._send_new(runner, messages)
        # le client a pu partir (réseau perdu) avant d'avoir reçu son résultat, sans que le service
        # le sache encore : le résultat reste disponible pour une reprise (mémoire, `final_keep_s`)
        self._remember(runner.session, messages, self._clock(), expired=False)
        self._hub.finish(runner.session)
        self._log_stats(runner, error or "end")
        self._release(runner)
        await self._close(runner, CLOSE_NORMAL if error is None else CLOSE_POLICY, error or "fin")

    def _log_stats(self, runner: _Runner, outcome: str) -> None:
        """Le bilan d'un flux, en nombres seulement : mesurer la charge sans rien révéler."""
        stats = runner.session.stream.pipeline.stats
        journal.info(
            "session.stats",
            session=runner.session.id,
            outcome=outcome,
            audio_s=round(stats.audio_s, 1),
            blocks=stats.blocks,
            compute_s=round(stats.compute_s, 2),
            rtf=round(stats.realtime_factor, 4),
            max_lag_s=round(stats.max_lag_s, 3),
            degraded_blocks=stats.degraded_blocks,
        )

    def _release(self, runner: _Runner) -> None:
        runner.done.set()
        runner.drained.set()
        self._runners.pop(runner.session.id, None)

    async def _close(self, runner: _Runner, code: int, reason: str) -> None:
        """Ferme en continuant de LIRE : fermer un socket qui a encore des données non lues les
        détruit (réinitialisation TCP) et le client perdrait l'erreur et le résultat."""
        ws = runner.ws
        if ws is None:
            return
        drain = asyncio.create_task(_discard(ws))
        try:
            with contextlib.suppress(Exception):
                await ws.close(code, reason[:100])
        finally:
            drain.cancel()

    async def _send_new(self, runner: _Runner, messages: list[dict[str, Any]]) -> bool:
        """Envoie sur la connexion actuelle ce qu'elle n'a pas déjà reçu (jamais deux fois).
        Rend False si la connexion n'a pas reçu tout."""
        async with runner.send_lock:
            ws = runner.ws
            if ws is None:
                return not messages
            try:
                for message in messages:
                    if message["seq"] > runner.sent_seq:
                        await ws.send(dumps(message))
                        runner.sent_seq = message["seq"]
            except ConnectionClosed:
                runner.ws = None
                self._hub.detach(runner.session, self._clock())
                return False
            return True

    # ------------------------------------------------------------------ erreurs
    async def _send_error(self, ws: ServerConnection | None, code: str) -> None:
        if ws is None:
            return
        retry = 5 if code == "server_busy" else None
        with contextlib.suppress(ConnectionClosed):
            await ws.send(dumps(error_message(code, retry_after_s=retry)))

    async def _refuse(
        self, ws: ServerConnection, error: ProtocolError, *, close: int = CLOSE_POLICY
    ) -> None:
        code = error.code if error.code in ERROR_CODES else "internal"
        journal.info("connection.refused", code=code)
        await self._send_error(ws, code)
        busy = code in ("server_busy", "too_many_streams")
        with contextlib.suppress(Exception):
            await ws.close(CLOSE_TRY_LATER if busy else close, code)

    # ------------------------------------------------------------------ session sans connexion
    async def _reap(self) -> None:
        while True:
            await asyncio.sleep(_REAP_EVERY_S)
            now = self._clock()
            for session in self._hub.expire(now):
                runner = self._runners.get(session.id)
                if runner is not None:
                    await runner.queue.put(_Expire())  # après l'audio déjà reçu, dans l'ordre
            self._tombstones = {k: v for k, v in self._tombstones.items() if v[1] > now}

    def _remember(
        self,
        session: LiveSession,
        messages: list[dict[str, Any]],
        now: float,
        *,
        expired: bool = True,
    ) -> None:
        finals = [m for m in messages if m["type"] == "FINAL"]
        if finals:
            if len(self._tombstones) >= _TOMBSTONES_MAX:
                self._tombstones.pop(next(iter(self._tombstones)))
            self._tombstones[session.id] = (
                session.subject,
                now + self._config.final_keep_s,
                finals,
                expired,
            )
            journal.info(
                "session.final_kept", session=session.id, account=pseudonym(session.subject)
            )


async def _discard(ws: ServerConnection) -> None:
    """Lit et jette ce que le client envoie encore pendant la fermeture."""
    with contextlib.suppress(Exception):
        while True:
            await ws.recv()


def _push(stream: Any, pcm: bytes, received_at_s: float) -> list[dict[str, Any]]:
    return stream.push(pcm, received_at_s=received_at_s)  # type: ignore[no-any-return]


def _end(stream: Any, received_at_s: float) -> list[dict[str, Any]]:
    return stream.end(received_at_s=received_at_s)  # type: ignore[no-any-return]


class _NullLogger:
    """Les journaux de la bibliothèque (URL de chaque connexion) n'ont rien à faire ici : le
    journal du service décrit les événements sans donnée sensible."""

    def __getattr__(self, _name: str) -> Any:
        return self._noop

    @staticmethod
    def _noop(*_args: Any, **_kwargs: Any) -> None:
        return None

    def isEnabledFor(self, _level: int) -> bool:
        return False
