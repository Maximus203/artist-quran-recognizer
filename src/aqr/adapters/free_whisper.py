"""Transcripteur de parole libre : Whisper (faster-whisper) sur le passage, langue détectée.

Sert UNIQUEMENT aux zones arabes hors Coran (ADR-0027) : jamais à nommer un verset. La langue est
détectée par le modèle (pas imposée) pour pouvoir refuser ce qui n'est pas de l'arabe ; la confiance
est la moyenne des log-probabilités des segments, pondérée par leur durée, ramenée dans [0, 1].
Sortie déterministe (`temperature=0`, pas de texte précédent, pas de VAD qui déplacerait les temps).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from aqr.domain.models import TimeSpan
from aqr.domain.ports import AudioClip
from aqr.freespeech.ports import SpeechTranscript


@dataclass(frozen=True)
class FreeWhisperConfig:
    model: str = "large-v3"
    """Nom faster-whisper (dépôt Systran) ou dossier local."""
    device: str = "auto"
    compute_type: str = "default"
    beam_size: int = 5
    download_root: str | None = None
    local_files_only: bool = True
    """Pas de téléchargement implicite : les poids viennent du cache ou de `AQR_MODELS_DIR`."""


def confidence_of(avg_logprobs: list[tuple[float, float]]) -> float:
    """exp(moyenne pondérée par la durée des log-probabilités moyennes) ; 0 sans segment."""
    total = sum(weight for _lp, weight in avg_logprobs)
    if total <= 0:
        return 0.0
    mean = sum(lp * weight for lp, weight in avg_logprobs) / total
    return max(0.0, min(1.0, math.exp(mean)))


class FreeWhisperTranscriber:  # pragma: no cover - modèle réel (banc et tests `slow`)
    def __init__(self, config: FreeWhisperConfig | None = None) -> None:
        self._config = config or FreeWhisperConfig()
        self._model: Any = None

    @property
    def engine(self) -> str:
        return f"faster-whisper/{self._config.model}"

    def _load(self) -> Any:
        if self._model is None:
            from faster_whisper import WhisperModel

            cfg = self._config
            self._model = WhisperModel(
                cfg.model,
                device=cfg.device,
                compute_type=cfg.compute_type,
                download_root=cfg.download_root,
                local_files_only=cfg.local_files_only,
            )
        return self._model

    def transcribe(self, clip: AudioClip, span: TimeSpan) -> SpeechTranscript:
        import numpy as np

        first = int(span.start_s * clip.sample_rate)
        last = int(span.end_s * clip.sample_rate)
        audio = np.asarray(clip.samples[first:last], dtype=np.float32)
        model = self._load()
        segments, info = model.transcribe(
            audio,
            language=None,
            task="transcribe",
            beam_size=self._config.beam_size,
            temperature=0.0,
            condition_on_previous_text=False,
            vad_filter=False,
        )
        pieces = list(segments)
        text = " ".join(s.text.strip() for s in pieces).strip()
        weighted = [(s.avg_logprob, max(1e-3, s.end - s.start)) for s in pieces]
        return SpeechTranscript(
            text=text,
            language=str(info.language),
            language_prob=float(info.language_probability),
            confidence=confidence_of(weighted),
            engine=self.engine,
        )
