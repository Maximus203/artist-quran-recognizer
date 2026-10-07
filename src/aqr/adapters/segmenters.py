"""B2 `SpeechSegmenter` : `obadx/recitation-segmenter-v2` (principal) et Silero VAD (repli).

Les deux rendent la même chose : des intervalles de parole en secondes, triés, disjoints, bornés
au clip. Le segmenteur de récitation coupe aux pauses de récitation (un segment ≈ un verset ou une
fin de waqf) ; Silero ne fait que détecter la voix — plus rapide à installer, moins fin sur les
pauses. `FallbackSegmenter` bascule sur le second si le premier est indisponible (modèle absent,
GPU saturé…), mais ne masque jamais une erreur de logique (`ValueError`).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aqr.domain.models import TimeSpan
from aqr.domain.ports import AudioClip, SpeechSegmenter
from aqr.models.lock import ModelsLock, verify_model_files

SAMPLE_RATE = 16000


def intervals_to_spans(
    intervals: Iterable[tuple[float, float]], duration_s: float
) -> list[TimeSpan]:
    """Trie, borne à [0, durée], écarte les vides et fusionne les chevauchements."""
    bounded = sorted(
        (max(0.0, float(a)), min(float(b), duration_s))
        for a, b in intervals
        if min(float(b), duration_s) > max(0.0, float(a))
    )
    merged: list[list[float]] = []
    for start, end in bounded:
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [TimeSpan(start, end) for start, end in merged]


def _require_16k(clip: AudioClip) -> None:
    if clip.sample_rate != SAMPLE_RATE:
        raise ValueError(f"{SAMPLE_RATE} Hz requis, reçu {clip.sample_rate} Hz")


def _duration(clip: AudioClip) -> float:
    return len(clip.samples) / clip.sample_rate


@dataclass(frozen=True)
class RecitationSegmenterConfig:
    models_dir: Path | None = None
    lock_path: Path = Path("models/LOCK.json")
    model_key: str = "recitation-segmenter"
    device: str = "auto"
    dtype: str = "bfloat16"
    batch_size: int = 8
    min_silence_ms: int = 200
    """Pause minimale pour couper deux segments."""
    min_speech_ms: int = 100
    """Parole plus courte : écartée."""
    pad_ms: int = 50
    """Marge ajoutée de part et d'autre de chaque segment."""
    verify_on_load: bool = True


class RecitationSegmenterV2:
    def __init__(self, config: RecitationSegmenterConfig | None = None) -> None:
        self._config = config or RecitationSegmenterConfig()
        self._model: Any = None
        self._processor: Any = None
        self._device: Any = None
        self._dtype: Any = None

    def _load(self) -> None:
        import torch
        from transformers import AutoFeatureExtractor, AutoModelForAudioFrameClassification

        cfg = self._config
        if cfg.models_dir is None:
            raise RuntimeError("RecitationSegmenterConfig.models_dir requis (AQR_MODELS_DIR)")
        if cfg.verify_on_load:
            verify_model_files(cfg.models_dir, cfg.model_key, ModelsLock.load(cfg.lock_path))
        directory = str(cfg.models_dir / cfg.model_key)
        device = (
            ("cuda" if torch.cuda.is_available() else "cpu") if cfg.device == "auto" else cfg.device
        )
        self._device = torch.device(device)
        self._dtype = getattr(torch, cfg.dtype) if device != "cpu" else torch.float32
        self._processor = AutoFeatureExtractor.from_pretrained(directory, local_files_only=True)
        model = AutoModelForAudioFrameClassification.from_pretrained(
            directory, local_files_only=True
        )
        self._model = model.to(self._device, dtype=self._dtype).eval()

    def segment(self, clip: AudioClip) -> list[TimeSpan]:
        _require_16k(clip)
        if not len(clip.samples):
            return []
        if self._model is None:
            self._load()
        import numpy as np
        import torch
        from recitations_segmenter import (
            NoSpeechIntervals,
            TooHighMinSpeechDuration,
            clean_speech_intervals,
            segment_recitations,
        )

        cfg = self._config
        wave = torch.tensor(np.asarray(clip.samples, dtype=np.float32))
        out = segment_recitations(
            [wave],
            self._model,
            self._processor,
            batch_size=cfg.batch_size,
            device=self._device,
            dtype=self._dtype,
        )[0]
        try:
            cleaned = clean_speech_intervals(
                out.speech_intervals,
                out.is_complete,
                min_silence_duration_ms=cfg.min_silence_ms,
                min_speech_duration_ms=cfg.min_speech_ms,
                pad_duration_ms=cfg.pad_ms,
                return_seconds=True,
            )
        except (NoSpeechIntervals, TooHighMinSpeechDuration):
            return []
        pairs = [(float(a), float(b)) for a, b in cleaned.clean_speech_intervals.tolist()]
        return intervals_to_spans(pairs, _duration(clip))


@dataclass(frozen=True)
class SileroVadConfig:
    threshold: float = 0.5
    min_speech_ms: int = 250
    min_silence_ms: int = 100
    speech_pad_ms: int = 30


class SileroVadSegmenter:
    """Détection de voix Silero. **Repli non fiable par défaut pour la récitation.**

    Mesuré (docs/evaluation/silero-fallback.md) : sur un extrait de 3 min de récitation à pauses
    longues, la config par défaut (`min_silence_ms=100`) découpe en 30 fragments dont 53 % durent
    moins d'une seconde (quasi un mot chacun), contre 7 segments de 11 à 28 s pour
    recitation-segmenter-v2. Aucune valeur de `min_silence_ms` testée ne convient aux deux
    extraits mesurés. Le comportement par défaut n'est pas modifié : sans vérité terrain, aucun
    réglage n'est calibré. Voir le document avant de s'appuyer sur ce segmenteur.
    """

    RELIABLE_BY_DEFAULT = False
    """Garde-fou documentaire, vérifié par test : ne passe à True qu'après mesure avec vérité
    terrain consignée dans docs/evaluation/silero-fallback.md."""

    def __init__(self, config: SileroVadConfig | None = None) -> None:
        self._config = config or SileroVadConfig()
        self._vad: Any = None

    def segment(self, clip: AudioClip) -> list[TimeSpan]:
        _require_16k(clip)
        if not len(clip.samples):
            return []
        import numpy as np
        import torch
        from silero_vad import get_speech_timestamps, load_silero_vad

        if self._vad is None:
            self._vad = load_silero_vad()
        cfg = self._config
        stamps = get_speech_timestamps(
            torch.tensor(np.asarray(clip.samples, dtype=np.float32)),
            self._vad,
            sampling_rate=clip.sample_rate,
            threshold=cfg.threshold,
            min_speech_duration_ms=cfg.min_speech_ms,
            min_silence_duration_ms=cfg.min_silence_ms,
            speech_pad_ms=cfg.speech_pad_ms,
            return_seconds=True,
        )
        return intervals_to_spans([(s["start"], s["end"]) for s in stamps], _duration(clip))


class FallbackSegmenter:
    """Essaie `primary` ; si indisponible (RuntimeError, OSError, ImportError), bascule.

    **Avertissement** : le repli par défaut (`SileroVadSegmenter`) fragmente la récitation à pauses
    longues en segments d'environ un mot (limite mesurée, docs/evaluation/silero-fallback.md).
    Une bascule dégrade donc fortement la détection en aval : inspecter `last_used` et ne pas
    présenter ses résultats comme équivalents à ceux du segmenteur principal.
    """

    FALLBACK_RELIABLE_BY_DEFAULT = False
    """Reflet de `SileroVadSegmenter.RELIABLE_BY_DEFAULT` pour le repli par défaut."""

    def __init__(self, primary: SpeechSegmenter, fallback: SpeechSegmenter) -> None:
        self._primary = primary
        self._fallback = fallback
        self.last_used = "primary"
        self.last_error = ""

    def segment(self, clip: AudioClip) -> list[TimeSpan]:
        try:
            spans = self._primary.segment(clip)
        except (RuntimeError, OSError, ImportError) as error:
            self.last_used, self.last_error = "fallback", f"{type(error).__name__}: {error}"
            return self._fallback.segment(clip)
        self.last_used, self.last_error = "primary", ""
        return spans
