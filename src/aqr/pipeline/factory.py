"""Assemblage des composants réels (imports lourds paresseux) pour `aqr recognize`.

Aucun repli silencieux : le segmenteur de récitation est le défaut ; Silero n'est utilisé que sur
demande explicite (`--segmenter silero`) ou avec `--allow-fallback-segmenter`, et son usage est
toujours signalé dans `warnings` (limite mesurée : docs/evaluation/silero-fallback.md).
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from aqr.domain.models import VerseRef
from aqr.domain.ports import QuranASR, SpeechSegmenter, Translation
from aqr.models.lock import ModelsLock
from aqr.pipeline.pipeline import PipelineConfig, RecognitionPipeline
from aqr.pipeline.result import EngineInfo
from aqr.rendering.home_renderer import HomeRenderer

SILERO_WARNING = (
    "segmenteur Silero VAD utilisé : non fiable par défaut sur la récitation à pauses longues "
    "(docs/evaluation/silero-fallback.md)"
)
CONSTRAINED_UNAVAILABLE = (
    "--constrained indisponible : l'ASR choisi n'expose pas son treillis CTC (ADR-0005 : le "
    "branchement du FastConformer exige NeMo et un GPU et n'est pas validé)"
)


class RecognizerUnavailable(RuntimeError):
    """Utilisation impossible (variable manquante, option non disponible) : code de sortie 2."""


@dataclass(frozen=True)
class RecognizeOptions:
    asr: str = "whisper"
    segmenter: str = "recitation"
    allow_fallback_segmenter: bool = False
    models_dir: Path | None = None
    lock_path: Path = Path("models/LOCK.json")
    corpus_dir: Path = Path("data/corpus")
    translation_id: str | None = "french_hameedullah"
    cache_dir: Path | None = None
    device: str = "auto"
    batch_size: int = 8
    constrained: bool = False


@dataclass(frozen=True)
class Recognizer:
    pipeline: RecognitionPipeline
    renderer: HomeRenderer


class _NoTranslations:
    def get(self, ref: VerseRef, translation_id: str) -> Translation:
        raise RecognizerUnavailable("aucune traduction configurée")


def options_from_env(options: RecognizeOptions, env: Mapping[str, str]) -> RecognizeOptions:
    from dataclasses import replace

    updated = options
    if updated.models_dir is None and env.get("AQR_MODELS_DIR"):
        updated = replace(updated, models_dir=Path(env["AQR_MODELS_DIR"]))
    if updated.cache_dir is None:
        base = env.get("AQR_CACHE_DIR") or os.path.join(os.path.expanduser("~"), ".cache", "aqr")
        updated = replace(updated, cache_dir=Path(base) / "translations")
    return updated


def build_recognizer(options: RecognizeOptions, env: Mapping[str, str]) -> Recognizer:
    options = options_from_env(options, env)
    if options.constrained:
        raise RecognizerUnavailable(CONSTRAINED_UNAVAILABLE)
    if options.models_dir is None:
        raise RecognizerUnavailable(
            "Variable d'environnement manquante : AQR_MODELS_DIR (ou --models-dir) ; "
            "télécharger les modèles avec `python scripts/fetch_models.py`"
        )
    if options.asr not in ("whisper", "fastconformer"):
        raise RecognizerUnavailable(f"ASR inconnu : {options.asr!r} (whisper | fastconformer)")
    if options.segmenter not in ("recitation", "silero"):
        raise RecognizerUnavailable(f"segmenteur inconnu : {options.segmenter!r}")

    from aqr.adapters.ffmpeg_extractor import FfmpegAudioExtractor
    from aqr.adapters.quranenc import QuranEncTranslationRepository
    from aqr.corpus.imlai_corrections import build_word_corrections, load_simple_clean_words
    from aqr.corpus.tanzil_repository import TanzilCorpusRepository
    from aqr.matching.flow_matcher import FlowVerseMatcher

    lock = ModelsLock.load(options.lock_path)
    corpus = TanzilCorpusRepository(options.corpus_dir)
    corrections = build_word_corrections(corpus, load_simple_clean_words(options.corpus_dir))
    matcher = FlowVerseMatcher(corpus, word_corrections=corrections)

    warnings: list[str] = []
    segmenter, segmenter_name = _segmenter(options, lock, warnings)
    asr, asr_name = _asr(options, lock)
    engine = EngineInfo(
        asr=asr_name,
        segmenter=segmenter_name,
        matcher="flow-matcher (ADR-0004)",
        decoder="viterbi-decoder-v2",
        constrained=False,
        corpus=f"tanzil.net hafs ({corpus.version})",
    )
    pipeline = RecognitionPipeline(
        FfmpegAudioExtractor(),
        segmenter,
        asr,
        matcher,
        corpus,
        engine,
        config=PipelineConfig(batch_size=options.batch_size),
        warnings=tuple(warnings),
    )
    translations = (
        QuranEncTranslationRepository(options.cache_dir)
        if options.translation_id and options.cache_dir
        else _NoTranslations()
    )
    return Recognizer(pipeline, HomeRenderer(corpus, translations))


def _segmenter(
    options: RecognizeOptions, lock: ModelsLock, warnings: list[str]
) -> tuple[SpeechSegmenter, str]:
    from aqr.adapters.segmenters import (
        FallbackSegmenter,
        RecitationSegmenterConfig,
        RecitationSegmenterV2,
        SileroVadSegmenter,
    )

    revision = lock.models["recitation-segmenter"].revision[:12]
    if options.segmenter == "silero":
        warnings.append(SILERO_WARNING)
        return SileroVadSegmenter(), "silero-vad (non fiable par défaut)"
    primary = RecitationSegmenterV2(
        RecitationSegmenterConfig(
            models_dir=options.models_dir, lock_path=options.lock_path, device=options.device
        )
    )
    name = f"recitation-segmenter-v2@{revision}"
    if options.allow_fallback_segmenter:
        warnings.append("repli Silero autorisé : " + SILERO_WARNING)
        return FallbackSegmenter(primary, SileroVadSegmenter()), name + " (repli Silero autorisé)"
    return primary, name


def _asr(options: RecognizeOptions, lock: ModelsLock) -> tuple[QuranASR, str]:
    if options.asr == "whisper":
        from aqr.adapters.whisper_tarteel import WhisperTarteelASR, WhisperTarteelConfig

        key = "whisper-base-quran"
        whisper = WhisperTarteelASR(
            WhisperTarteelConfig(
                models_dir=options.models_dir,
                lock_path=options.lock_path,
                device=options.device,
                batch_size=options.batch_size,
            )
        )
        return whisper, f"{key}@{lock.models[key].revision[:12]}/times-estimated"
    from aqr.adapters.fastconformer import FastConformerConfig, FastConformerQuranASR

    key = "fastconformer-quran"
    fastconformer = FastConformerQuranASR(
        FastConformerConfig(
            models_dir=options.models_dir,
            lock_path=options.lock_path,
            device=options.device,
            batch_size=options.batch_size,
        )
    )
    return fastconformer, f"{key}@{lock.models[key].revision[:12]}"
