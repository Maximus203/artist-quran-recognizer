"""Racine d'assemblage du service du direct (`aqr live-serve`) : un processus, un modèle chargé.

Le modèle (Muno FastConformer ONNX), l'index du Coran et le corpus sont chargés UNE fois au
démarrage (7 à 9 s mesurés à l'étape 2) ; chaque flux ouvre ensuite sa propre session (ses caches),
son propre suivi d'hypothèses et sa propre horloge. Couches : transport `adapters/ws` -> `LiveHub`
(quotas, jetons, reprise) -> `LiveStream` -> `LivePipeline` -> ports du domaine.

`make_stream_factory` ne connaît que des ports : les tests y branchent un faux ASR, la production
y branche `MunoIncrementalASR` (`load_engine`).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import signal
import sys
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, TextIO

from aqr.domain.ports import CorpusRepository, StreamingAsr, TranslationRepository
from aqr.live.access import AccessPolicy
from aqr.live.budget import BudgetConfig
from aqr.live.config import LiveConfig
from aqr.live.confirmation import (
    ConfirmationConfig,
    ConfirmationWorker,
    Recognize,
    SegmentConfirmer,
    warm_clip,
)
from aqr.live.content import LiveContent
from aqr.live.final import FinalDocumentBuilder
from aqr.live.hub import LiveHub, StreamFactory
from aqr.live.journal import journal
from aqr.live.pipeline import LivePipeline
from aqr.live.prefix_index import PrefixIndex
from aqr.live.presenter import LivePresenter
from aqr.live.service_config import LiveServiceConfig
from aqr.live.stream import LiveStream
from aqr.pipeline.result import EngineInfo
from aqr.rendering.home_renderer import HomeRenderer

if TYPE_CHECKING:
    from aqr.adapters.ws.server import LiveWebSocketServer

SEGMENTER_NOTE = "aucun (flux continu, ADR-0011)"
MATCHER_NOTE = "suivi d'hypothèses de position (ADR-0011)"
DECODER_NOTE = "direct aqr.live/1"


@dataclass(frozen=True)
class LiveEngine:
    """Tout ce qui est lourd et partagé entre les flux."""

    asr: StreamingAsr
    index: PrefixIndex
    skeleton: Callable[[str], str]
    corpus: CorpusRepository
    renderer: HomeRenderer
    live: LiveConfig = field(default_factory=LiveConfig)
    budget: BudgetConfig = field(default_factory=BudgetConfig)
    confirm: Recognize | None = None
    """Le moteur du lot, appelé sur chaque passage clos (ADR-0016) ; None = pas de confirmation."""
    confirmation: ConfirmationConfig = field(default_factory=ConfirmationConfig)


def make_stream_factory(engine: LiveEngine, config: LiveServiceConfig) -> StreamFactory:
    content = LiveContent(engine.index, engine.corpus, engine.renderer)
    info = EngineInfo(
        asr=engine.asr.engine,
        segmenter=SEGMENTER_NOTE,
        matcher=MATCHER_NOTE,
        decoder=DECODER_NOTE,
    )
    limits = config.stream_limits()
    guided_indexes: dict[int, PrefixIndex] = {}
    worker = ConfirmationWorker(engine.confirm) if engine.confirm is not None else None

    def index_for(surah: int | None) -> PrefixIndex:
        """Écoute classique : l'index du Coran entier. Récitation guidée : celui de la sourate
        annoncée, construit une fois puis partagé (immuable)."""
        if surah is None:
            return engine.index
        if surah not in guided_indexes:
            guided_indexes[surah] = engine.index.restricted_to_surah(surah)
        return guided_indexes[surah]

    def factory(
        session_id: str,
        translation: str | None,
        technical: bool,
        surah: int | None = None,
    ) -> LiveStream:
        origin = time.perf_counter()

        def clock() -> float:
            return time.perf_counter() - origin

        pipeline = LivePipeline(
            engine.asr,
            index_for(surah),
            engine.skeleton,
            config=engine.live.guided() if surah is not None else engine.live,
            budget=engine.budget,
            clock=clock,
        )
        return LiveStream(
            session_id,
            pipeline,
            LivePresenter(content, translation, technical=technical),
            FinalDocumentBuilder(
                content,
                engine.renderer,
                info,
                corpus_version=engine.corpus.version,
                translation_id=translation,
            ),
            limits,
            clock=clock,
            confirmer=(
                SegmentConfirmer(worker, session_id, engine.confirmation) if worker else None
            ),
        )

    return factory


# --------------------------------------------------------------------------- moteur réel
@dataclass(frozen=True)
class ServiceOptions:
    models_dir: Path | None = None
    lock_path: Path = Path("models/LOCK.json")
    corpus_dir: Path = Path("data/corpus")
    cache_dir: Path | None = None
    segments_dir: Path | None = None
    asr_threads: int = 1
    """Fils ONNX par appel. Le modèle est partagé : avec N flux, 1 fil par appel évite la
    sur-souscription (mesuré à l'étape 2) ; un flux unique va un peu plus vite à 4."""
    settle_s: float = 1.5
    device: str = "cpu"
    warm_up: bool = True
    confirm: bool = True
    """Charger le moteur du lot pour confirmer les passages (ADR-0016) ; plus lent au démarrage."""
    warm_translations: tuple[str, ...] = ()


def load_engine(options: ServiceOptions, env: Mapping[str, str]) -> LiveEngine:  # pragma: no cover
    """Charge le vrai moteur (imports lourds paresseux)."""
    from aqr.adapters.muno_incremental import MunoIncrementalASR, MunoIncrementalConfig
    from aqr.adapters.quranenc import QuranEncTranslationRepository
    from aqr.corpus.tanzil_repository import TanzilCorpusRepository
    from aqr.live.corpus_flow import load_prefix_index
    from aqr.pipeline.factory import RecognizeOptions, options_from_env
    from aqr.rendering.translation_segments import SegmentLibrary

    resolved = options_from_env(
        RecognizeOptions(
            models_dir=options.models_dir,
            corpus_dir=options.corpus_dir,
            cache_dir=options.cache_dir,
            segments_dir=options.segments_dir,
        ),
        env,
    )
    if resolved.models_dir is None:
        raise RuntimeError(
            "Variable d'environnement manquante : AQR_MODELS_DIR (ou --models-dir) ; "
            "télécharger les modèles avec `python scripts/fetch_models.py`"
        )
    corpus = TanzilCorpusRepository(options.corpus_dir)
    index, skeleton = load_prefix_index(options.corpus_dir)
    translations: TranslationRepository = QuranEncTranslationRepository(
        resolved.cache_dir or Path(".")
    )
    segments = SegmentLibrary(resolved.segments_dir) if resolved.segments_dir else None
    asr = MunoIncrementalASR(
        MunoIncrementalConfig(
            models_dir=resolved.models_dir,
            lock_path=options.lock_path,
            device=options.device,
            intra_op_threads=options.asr_threads,
            settle_s=options.settle_s,
        )
    )
    engine = LiveEngine(
        asr=asr,
        index=index,
        skeleton=skeleton,
        corpus=corpus,
        renderer=HomeRenderer(corpus, translations, segments),
        confirm=load_batch_recognizer(options, env) if options.confirm else None,
    )
    if options.warm_up:
        warm_up(engine)
    if options.warm_translations:
        threading.Thread(
            target=warm_translations,
            args=(translations, corpus, options.warm_translations),
            daemon=True,
            name="aqr-live-translations",
        ).start()
    return engine


def load_batch_recognizer(
    options: ServiceOptions, env: Mapping[str, str]
) -> Recognize:  # pragma: no cover
    """Le moteur du lot (cascade, vérification acoustique) pour confirmer les passages clos."""
    from aqr.pipeline.factory import CASCADE, RecognizeOptions, build_recognizer

    started = time.perf_counter()
    recognizer = build_recognizer(
        RecognizeOptions(
            asr=CASCADE,
            models_dir=options.models_dir,
            lock_path=options.lock_path,
            corpus_dir=options.corpus_dir,
            translation_id=None,
            device=options.device,
        ),
        env,
    )
    built = time.perf_counter()
    warmed = recognizer.pipeline.warm_up(warm_clip())
    journal.info(
        "service.confirm_ready",
        build_s=round(built - started, 1),
        warm_up_s=round(warmed, 1),
    )
    return recognizer.pipeline.run_clip


def warm_up(engine: LiveEngine) -> float:
    """Un flux à blanc : charge le modèle et compile ses graphes avant le premier vrai flux."""
    started = time.perf_counter()
    session = engine.asr.open()
    silence = [0.0] * 16000
    session.feed(silence)
    session.feed(silence)
    session.finish()
    elapsed = time.perf_counter() - started
    journal.info("service.warm_up", seconds=round(elapsed, 2))
    return elapsed


def warm_translations(
    translations: TranslationRepository, corpus: CorpusRepository, ids: tuple[str, ...]
) -> None:  # pragma: no cover - réseau
    """Charge dans le cache local la traduction de chaque sourate, hors du chemin d'un verrou."""
    seen: set[int] = set()
    for ref in corpus.all_refs():
        if ref.surah in seen:
            continue
        seen.add(ref.surah)
        for translation_id in ids:
            try:
                translations.get(ref, translation_id)
            except Exception as error:  # le réseau peut manquer : on réessaiera au premier verrou
                journal.warning(
                    "translation.warm_failed", surah=ref.surah, error=type(error).__name__
                )
    journal.info("service.translations_ready", surahs=len(seen))


# --------------------------------------------------------------------------- exécution
def build_service(
    engine: LiveEngine, config: LiveServiceConfig, env: Mapping[str, str]
) -> tuple[LiveHub, LiveWebSocketServer]:
    from aqr.adapters.ws.hmac_tokens import HmacTokenCodec, resolve_key
    from aqr.adapters.ws.server import LiveWebSocketServer

    hub = LiveHub(config, HmacTokenCodec(resolve_key(env)), make_stream_factory(engine, config))
    server = LiveWebSocketServer(config, hub, AccessPolicy.from_env(env))
    return hub, server


async def serve(
    engine: LiveEngine, config: LiveServiceConfig, env: Mapping[str, str], out: TextIO
) -> None:
    _hub, server = build_service(engine, config, env)
    await server.start()
    print(
        f"Service du direct à l'écoute sur ws://{config.host}:{server.port}{config.path} "
        f"({config.max_streams} flux au plus, {config.max_streams_per_account} par compte). "
        "Ctrl+C pour arrêter.",
        file=out,
        flush=True,
    )
    loop = asyncio.get_running_loop()
    stop = asyncio.Event()
    for name in ("SIGTERM", "SIGINT"):
        with contextlib.suppress(NotImplementedError, ValueError, RuntimeError):
            loop.add_signal_handler(getattr(signal, name), stop.set)
    serving = asyncio.create_task(server.serve_forever())
    waiting = asyncio.create_task(stop.wait())
    try:
        await asyncio.wait({serving, waiting}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        await server.stop()
        serving.cancel()
        waiting.cancel()
        print("Service du direct arrêté.", file=out, flush=True)


def run(
    config: LiveServiceConfig,
    options: ServiceOptions,
    env: Mapping[str, str],
    out: TextIO,
    err: TextIO,
) -> int:  # pragma: no cover - lance le vrai service
    """`aqr live-serve` : charge le moteur une fois, puis sert jusqu'à Ctrl+C. 2 = utilisation
    impossible (extra [live] absent, variable manquante, poids ou corpus introuvables)."""
    logging.basicConfig(
        level=getattr(logging, str(env.get("AQR_LIVE_LOG_LEVEL", "INFO")).upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stderr,
    )
    try:
        import websockets  # noqa: F401
    except ImportError:
        print(
            "ERREUR le service du direct a besoin de `websockets` : "
            'installer avec `pip install -e ".[live]"`',
            file=err,
        )
        return 2
    from aqr.adapters.ws.hmac_tokens import resolve_key
    from aqr.corpus.checksums import CorpusChecksumError

    try:
        resolve_key(
            env
        )  # une clé inutilisable se dit tout de suite, pas après le chargement du modèle
        if config.host not in ("127.0.0.1", "localhost", "::1"):
            journal.warning("service.non_loopback", host=config.host)
            print(
                f"ATTENTION le service écoute sur {config.host}, pas seulement sur la machine "
                "locale : les hôtes restent limités par AQR_ALLOWED_HOSTS ; exposez-le derrière "
                "un proxy de confiance.",
                file=err,
            )
        started = time.perf_counter()
        engine = load_engine(options, env)
        print(f"Moteur chargé en {time.perf_counter() - started:.1f} s.", file=out, flush=True)
        asyncio.run(serve(engine, config, env, out))
    except (RuntimeError, OSError, ValueError, KeyError, CorpusChecksumError) as exc:
        print(f"ERREUR {exc}", file=err)
        return 2
    except KeyboardInterrupt:
        print("Service du direct arrêté.", file=out)
    return 0
