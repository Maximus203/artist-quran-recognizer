"""Un vrai service WebSocket du direct, démarré dans le test, avec un faux ASR (sans modèle)."""

from __future__ import annotations

import asyncio
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aqr.adapters.ws.hmac_tokens import HmacTokenCodec
from aqr.adapters.ws.server import LiveWebSocketServer
from aqr.app.live_service import LiveEngine, make_stream_factory
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.domain.models import VerseRef
from aqr.domain.ports import Translation
from aqr.live.access import AccessPolicy
from aqr.live.budget import BudgetConfig
from aqr.live.corpus_flow import load_prefix_index
from aqr.live.hub import LiveHub
from aqr.live.service_config import LiveServiceConfig
from aqr.live.stream import LiveStream
from aqr.rendering.home_renderer import HomeRenderer
from tests.support.streaming_fakes import FakeStreamingASR

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"
KEY = "t" * 40
RATE = 16000


class FakeTranslations:
    def get(self, ref: VerseRef, translation_id: str) -> Translation:
        return Translation(ref, f"Traduction de {ref}.", translation_id, "v-test", "QuranEnc test")


@dataclass(frozen=True)
class World:
    corpus: TanzilCorpusRepository
    index: Any
    skeleton: Callable[[str], str]


_WORLD: World | None = None


def world() -> World:
    global _WORLD
    if _WORLD is None:
        index, skeleton = load_prefix_index(CORPUS_DIR)
        _WORLD = World(TanzilCorpusRepository(CORPUS_DIR), index, skeleton)
    return _WORLD


def script_of(ref: str, start: float = 0.2, step: float = 0.5) -> list[tuple[str, float, float]]:
    corpus = world().corpus
    verse = VerseRef.parse(ref)
    words = corpus.words(verse)
    words = words[4:] if ref.endswith(":1") and len(words) > 4 and verse.surah != 1 else words
    return [(w, start + i * step, start + (i + 1) * step - 0.05) for i, w in enumerate(words)]


def pcm_loud(seconds: float, level: float = 0.3) -> bytes:
    from array import array

    return array("h", [round(level * 32767)] * round(seconds * RATE)).tobytes()


def stream_factory(
    script: list[tuple[str, float, float]],
    *,
    cost_s: float = 0.0,
    budget: BudgetConfig | None = None,
    config: LiveServiceConfig,
) -> Callable[[str, str | None, bool], LiveStream]:
    """La vraie fabrique du service (`make_stream_factory`), avec un faux ASR."""
    w = world()

    def pace(_received_s: float) -> None:
        if cost_s:
            time.sleep(cost_s)

    engine = LiveEngine(
        asr=FakeStreamingASR(script, delay_s=0.2, on_feed=pace),
        index=w.index,
        skeleton=w.skeleton,
        corpus=w.corpus,
        renderer=HomeRenderer(w.corpus, FakeTranslations()),
        budget=budget or BudgetConfig(),
    )
    return make_stream_factory(engine, config)


class ServiceHarness:
    """Le service réel (WebSocket, jetons, quotas) sur un port libre de 127.0.0.1."""

    def __init__(
        self,
        *,
        script: list[tuple[str, float, float]] | None = None,
        cost_s: float = 0.0,
        budget: BudgetConfig | None = None,
        env: dict[str, str] | None = None,
        **config: Any,
    ) -> None:
        self.config = LiveServiceConfig(**{"port": 0, "max_streams": 4, **config})
        self.codec = HmacTokenCodec(KEY)
        self.hub = LiveHub(
            self.config,
            self.codec,
            stream_factory(
                script or script_of("112:1"), cost_s=cost_s, budget=budget, config=self.config
            ),
        )
        self.server = LiveWebSocketServer(self.config, self.hub, AccessPolicy.from_env(env or {}))
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._ready = threading.Event()
        self.port = 0

    def _run(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._boot())
        self._ready.set()
        self._loop.run_forever()

    async def _boot(self) -> None:
        await self.server.start()
        self.port = self.server.port

    def __enter__(self) -> ServiceHarness:
        self._thread.start()
        assert self._ready.wait(10), "le service n'a pas démarré"
        return self

    def __exit__(self, *_exc: object) -> None:
        self.stop()

    def stop(self) -> None:
        if self._loop.is_closed():
            return
        asyncio.run_coroutine_threadsafe(self.server.stop(), self._loop).result(10)
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join(5)
        self._loop.close()

    @property
    def url(self) -> str:
        return f"ws://127.0.0.1:{self.port}/live"

    @property
    def http(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def token(
        self,
        subject: str = "7",
        *,
        ttl_s: float = 60,
        technical: bool = False,
        now: float | None = None,
    ) -> str:
        return self.codec.issue(
            subject, ttl_s, now=time.time() if now is None else now, technical=technical
        )
