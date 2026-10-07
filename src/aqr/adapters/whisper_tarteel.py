"""B4 `QuranASR` challenger : Whisper-base fine-tuné Coran (`tarteel-ai/whisper-base-ar-quran`).

Mesuré sur EveryAyah : une sortie **toujours entièrement vocalisée** (là où le FastConformer omet
parfois les voyelles), mais des **horodatages par mot inutilisables** — la DTW sur les attentions
croisées (3 jeux de têtes d'alignement essayés) entasse tous les mots dans la première fraction de
seconde et laisse le dernier absorber le reste du segment. Cet adapter ne les présente donc pas
comme mesurés : le **texte** vient de Whisper, les **temps des mots sont estimés** au prorata des
lettres dans le segment (`engine` se termine par `/times-estimated`). La seule mesure de temps
fiable reste celle du segment (B2) ; pour des mots horodatés, utiliser le FastConformer.

Le checkpoint est un `pytorch_model.bin` (pickle) : épinglé par SHA-256, vérifié avant chargement,
chargé par `transformers` avec `weights_only`.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from aqr.corpus.normalize import normalize_arabic
from aqr.domain.models import Riwaya, TimeSpan
from aqr.domain.ports import AudioClip, TranscribedWord, Transcript
from aqr.models.lock import ModelsLock, verify_model_files

_CONTROL_TOKEN = re.compile(r"<\|[^<>|]*\|>")


def strip_control_tokens(text: str) -> str:
    """Retire tout jeton de contrôle Whisper de la forme `<|...|>`.

    Avec ce checkpoint, `batch_decode(skip_special_tokens=True)` laisse passer
    `<|startoftranscript|><|ar|><|transcribe|><|notimestamps|>` (jetons ajoutés non « spéciaux »).
    Fonction pure : seul ce motif est supprimé, le texte arabe n'est jamais modifié (I1).
    """
    return _CONTROL_TOKEN.sub("", text)


@dataclass(frozen=True)
class WhisperTarteelConfig:
    models_dir: Path | None = None
    lock_path: Path = Path("models/LOCK.json")
    model_key: str = "whisper-base-quran"
    device: str = "auto"
    batch_size: int = 8
    max_new_tokens: int = 200
    """Plafond de jetons générés par segment (limite du modèle : 448 au total)."""
    max_segment_s: float = 30.0
    """Fenêtre d'entrée de Whisper : un segment plus long doit être découpé en amont (B2)."""
    min_segment_s: float = 0.08
    silence_rms: float = 1e-4
    """Segment d'énergie inférieure : jamais envoyé (hallucination sur silence numérique)."""
    verify_on_load: bool = True


class WhisperBackend(Protocol):
    def generate(self, audios: Sequence[Any]) -> list[tuple[str, float]]:
        """(texte, confiance de séquence dans [0, 1]) par segment audio (float32, 16 kHz)."""
        ...


class HfWhisperBackend:  # pragma: no cover - GPU / modèle réel (tests `slow`)
    def __init__(self, config: WhisperTarteelConfig) -> None:
        self._config = config
        self._model: Any = None
        self._processor: Any = None
        self.revision: str | None = None

    def _load(self) -> None:
        import warnings

        import torch
        from transformers import WhisperForConditionalGeneration, WhisperProcessor

        cfg = self._config
        if cfg.models_dir is None:
            raise RuntimeError("WhisperTarteelConfig.models_dir requis (AQR_MODELS_DIR)")
        lock = ModelsLock.load(cfg.lock_path)
        if cfg.verify_on_load:
            verify_model_files(cfg.models_dir, cfg.model_key, lock)
        self.revision = lock.models[cfg.model_key].revision
        directory = str(cfg.models_dir / cfg.model_key)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            device = (
                ("cuda" if torch.cuda.is_available() else "cpu")
                if cfg.device == "auto"
                else cfg.device
            )
            model: Any = WhisperForConditionalGeneration.from_pretrained(
                directory, local_files_only=True
            )
            self._processor = WhisperProcessor.from_pretrained(directory, local_files_only=True)
        # La generation_config du dépôt est ancienne (sans langue/tâche) : on la complète avec les
        # identifiants lus dans le tokenizer, jamais écrits en dur.
        tok = self._processor.tokenizer
        generation: Any = model.generation_config
        generation.is_multilingual = True
        generation.lang_to_id = {"<|ar|>": tok.convert_tokens_to_ids("<|ar|>")}
        generation.task_to_id = {
            "transcribe": tok.convert_tokens_to_ids("<|transcribe|>"),
            "translate": tok.convert_tokens_to_ids("<|translate|>"),
        }
        generation.no_timestamps_token_id = tok.convert_tokens_to_ids("<|notimestamps|>")
        self._model = model.eval().to(device)
        self._device = device

    def generate(self, audios: Sequence[Any]) -> list[tuple[str, float]]:
        import torch

        if self._model is None:
            self._load()
        results: list[tuple[str, float]] = []
        step = self._config.batch_size
        for offset in range(0, len(audios), step):
            batch = list(audios[offset : offset + step])
            features = self._processor(
                batch, sampling_rate=16000, return_tensors="pt"
            ).input_features.to(self._device)
            with torch.no_grad():
                out = self._model.generate(
                    features,
                    language="ar",
                    task="transcribe",
                    max_new_tokens=self._config.max_new_tokens,
                    return_dict_in_generate=True,
                    output_scores=True,
                )
                transitions = self._model.compute_transition_scores(
                    out.sequences, out.scores, normalize_logits=True
                )
            generated = out.sequences[:, -transitions.shape[1] :]
            mask = (generated != self._model.config.pad_token_id).float()
            mean_logprob = (transitions * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1.0)
            texts = self._processor.batch_decode(out.sequences, skip_special_tokens=True)
            for text, logprob in zip(texts, mean_logprob.tolist(), strict=True):
                results.append((text.strip(), float(torch.exp(torch.tensor(logprob)))))
        return results


class WhisperTarteelASR:
    riwaya = Riwaya.HAFS

    def __init__(
        self,
        config: WhisperTarteelConfig | None = None,
        *,
        backend: WhisperBackend | None = None,
        revision: str | None = None,
    ) -> None:
        self._config = config or WhisperTarteelConfig()
        self._backend: WhisperBackend = backend or HfWhisperBackend(self._config)
        self._revision = revision

    @property
    def engine(self) -> str:
        revision = self._revision or getattr(self._backend, "revision", None) or "inconnue"
        return f"{self._config.model_key}@{revision[:12]}/times-estimated"

    def transcribe(self, clip: AudioClip, span: TimeSpan) -> Transcript:
        return self.transcribe_batch(clip, [span])[0]

    def transcribe_batch(self, clip: AudioClip, spans: Sequence[TimeSpan]) -> list[Transcript]:
        duration = len(clip.samples) / clip.sample_rate
        for span in spans:
            if span.end_s > duration + 1e-6:
                raise ValueError(f"segment {span} hors du clip ({duration:.2f} s)")
            if span.end_s - span.start_s > self._config.max_segment_s:
                raise ValueError(
                    f"segment {span} plus long que la fenêtre du modèle "
                    f"({self._config.max_segment_s:.0f} s) : à découper en amont"
                )

        import numpy as np

        samples = np.asarray(clip.samples, dtype=np.float32)
        rate = clip.sample_rate
        jobs: list[tuple[int, Any]] = []
        for index, span in enumerate(spans):
            segment = samples[round(span.start_s * rate) : round(span.end_s * rate)]
            if len(segment) < round(self._config.min_segment_s * rate):
                continue
            if float(np.sqrt(np.mean(np.square(segment)))) < self._config.silence_rms:
                continue
            jobs.append((index, segment))

        results: dict[int, Transcript] = {}
        if jobs:
            outputs = self._backend.generate([segment for _i, segment in jobs])
            for (index, _segment), (text, confidence) in zip(jobs, outputs, strict=True):
                results[index] = self._to_transcript(text, confidence, spans[index])
        return [results.get(i, Transcript(words=(), engine=self.engine)) for i in range(len(spans))]

    def _to_transcript(self, text: str, confidence: float, span: TimeSpan) -> Transcript:
        tokens = strip_control_tokens(text).split()
        if not tokens:
            return Transcript(words=(), engine=self.engine)
        weights = [max(1, len(normalize_arabic(t))) for t in tokens]
        total, length = sum(weights), span.end_s - span.start_s
        bounded = min(1.0, max(0.0, confidence))
        words: list[TranscribedWord] = []
        consumed = 0
        for token, weight in zip(tokens, weights, strict=True):
            start = span.start_s + length * consumed / total
            consumed += weight
            end = span.start_s + length * consumed / total
            words.append(TranscribedWord(text=token, time=TimeSpan(start, end), confidence=bounded))
        return Transcript(words=tuple(words), engine=self.engine)
