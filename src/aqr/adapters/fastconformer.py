"""B4 `QuranASR` : FastConformer hybride RNNT/CTC fine-tuné sur le Coran (NeMo).

Modèle : `msyukriafifi/fastconformer-quran-ar` (CC-BY-4.0), checkpoint `phase3_full`, épinglé dans
`models/LOCK.json`. L'ASR ne sert qu'à *localiser* (invariant I1) : le texte renvoyé est celui du
modèle, brut (voyelles incluses, orthographe imla'i, parfois sans voyelles — mesuré), jamais
affiché ni corrigé ; la normalisation et la mise en correspondance avec le corpus sont le travail
du matcher (B6).

Les temps de chaque mot sont **absolus dans le clip** (origine du segment ajoutée). La résolution
est celle de la trame du modèle (80 ms) : une frontière de mot n'est pas plus précise.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aqr.domain.models import Riwaya, TimeSpan
from aqr.domain.ports import AudioClip, TranscribedWord, Transcript
from aqr.models.lock import ModelsLock, verify_model_files
from aqr.models.registry import MODELS


@dataclass(frozen=True)
class FastConformerConfig:
    models_dir: Path | None = None
    """Dossier des modèles (`$AQR_MODELS_DIR`) ; requis seulement pour charger le vrai modèle."""
    lock_path: Path = Path("models/LOCK.json")
    model_key: str = "fastconformer-quran"
    device: str = "auto"
    """`auto` = cuda si disponible, sinon cpu."""
    decoder_type: str = "ctc"
    """`ctc` (mots contigus) ou `rnnt` (mots plus courts, avec trous) ; provisoire : à trancher par
    le benchmark de la phase 6 sur des audios annotés."""
    batch_size: int = 8
    verify_on_load: bool = True
    """Recalcule les SHA-256 du checkpoint avant de le charger (un pickle altéré s'exécute)."""
    min_word_s: float = 0.08
    """Durée minimale d'un mot (une trame) : un mot de durée nulle reste exploitable."""
    confidence_method: str = "max_prob"
    context_pad_s: float = 0.0
    """Marge de contexte ajoutée de part et d'autre de chaque segment (contexte réel du clip s'il
    existe, sinon remplissage). **Désactivée par défaut, par mesure** : sur 216 versets EveryAyah,
    top-1 du matcher 97,2 % sans marge ; 96,8 % (0,3 s + bruit 1e-3), 94,9 % (0,3 s + 3e-3),
    94,0 % (0,5 s + 2e-3), 96,3 % (0,3 s de zéros). La marge corrige certaines troncatures de fin
    de mot (« النَّ » -> « النَّاسِ ») mais fait halluciner le modèle aux bords en provoquant
    d'autres erreurs ; à re-mesurer avec du vrai contexte audio (phase 5-6)."""
    pad_noise: float = 0.0
    """Amplitude (uniforme, graine fixe) du bruit qui remplit la marge manquante aux bords du clip.
    0 = zéros. Le silence NUMÉRIQUE fait halluciner le modèle (« الم », « موسوعية » : mesuré) ; un
    bruit très faible est plus proche d'un enregistrement réel."""
    silence_rms: float = 1e-4
    """Un segment dont l'énergie (RMS) est inférieure n'est PAS envoyé au modèle : sur du silence
    numérique il hallucine un mot coranique (« الم », mesuré). Ne protège que du silence absolu
    (remplissage) ; le bruit réel reste l'affaire de B2 (segmentation) et de B5 (QuranicityGate)."""


class FastConformerQuranASR:
    riwaya = Riwaya.HAFS

    def __init__(
        self,
        config: FastConformerConfig | None = None,
        *,
        model: Any = None,
        revision: str | None = None,
    ) -> None:
        self._config = config or FastConformerConfig()
        self._model = model
        self._revision = revision

    # --- chargement paresseux du vrai modèle ------------------------------------------------
    def _load(self) -> Any:  # pragma: no cover - GPU / modèle réel (tests `slow`)
        import logging
        import warnings

        import torch

        cfg = self._config
        if cfg.models_dir is None:
            raise RuntimeError("FastConformerConfig.models_dir requis (AQR_MODELS_DIR)")
        lock = ModelsLock.load(cfg.lock_path)
        if cfg.verify_on_load:
            verify_model_files(cfg.models_dir, cfg.model_key, lock)
        spec = MODELS[cfg.model_key]
        self._revision = lock.models[cfg.model_key].revision
        checkpoint = cfg.models_dir / cfg.model_key / spec.files[0]

        logging.getLogger("nemo_logger").setLevel(logging.ERROR)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            import nemo.collections.asr as nemo_asr
            from nemo.collections.asr.parts.utils.asr_confidence_utils import ConfidenceConfig
            from omegaconf import open_dict

            model = nemo_asr.models.EncDecHybridRNNTCTCBPEModel.restore_from(str(checkpoint))
            device = (
                ("cuda" if torch.cuda.is_available() else "cpu")
                if cfg.device == "auto"
                else cfg.device
            )
            model = model.eval().to(device)
            decoding = model.cfg.decoding
            with open_dict(decoding):
                decoding.confidence_cfg = ConfidenceConfig(
                    preserve_word_confidence=True,
                    preserve_token_confidence=True,
                    exclude_blank=True,
                    aggregation="mean",
                    method_cfg={"name": cfg.confidence_method},
                )
            model.change_decoding_strategy(decoding, decoder_type=cfg.decoder_type)
        return model

    def _ensure_model(self) -> Any:
        if self._model is None:
            self._model = self._load()
        return self._model

    @property
    def engine(self) -> str:
        revision = (self._revision or "inconnue")[:12]
        return f"{self._config.model_key}@{revision}/{self._config.decoder_type}"

    # --- port B4 -----------------------------------------------------------------------------
    def transcribe(self, clip: AudioClip, span: TimeSpan) -> Transcript:
        return self.transcribe_batch(clip, [span])[0]

    def transcribe_batch(self, clip: AudioClip, spans: Sequence[TimeSpan]) -> list[Transcript]:
        """Transcrit plusieurs segments en un seul appel au modèle (le coût dominant est le GPU)."""
        duration = len(clip.samples) / clip.sample_rate
        for span in spans:
            if span.end_s > duration + 1e-6:
                raise ValueError(f"segment {span} hors du clip ({duration:.2f} s)")

        import numpy as np

        samples = np.asarray(clip.samples, dtype=np.float32)
        rate = clip.sample_rate
        min_samples = round(self._config.min_word_s * rate)
        pad = round(self._config.context_pad_s * rate)

        jobs: list[tuple[int, Any, float]] = []
        for index, span in enumerate(spans):
            start, end = round(span.start_s * rate), round(span.end_s * rate)
            segment = samples[start:end]
            if len(segment) < min_samples:
                continue
            if float(np.sqrt(np.mean(np.square(segment)))) < self._config.silence_rms:
                continue  # silence numérique : jamais envoyé (la marge ne compte pas)
            left, right = min(pad, start), min(pad, len(samples) - end)
            fed = np.concatenate(
                (
                    self._filler(np, pad - left),
                    samples[start - left : end + right],
                    self._filler(np, pad - right),
                )
            )
            jobs.append((index, fed, pad / rate))

        results: dict[int, Transcript] = {}
        if jobs:
            hypotheses = self._ensure_model().transcribe(
                [fed for _i, fed, _lead in jobs],
                timestamps=True,
                verbose=False,
                batch_size=self._config.batch_size,
            )
            for (index, _fed, lead), hypothesis in zip(jobs, hypotheses, strict=True):
                results[index] = self._to_transcript(hypothesis, spans[index], lead)
        return [results.get(i, Transcript(words=(), engine=self.engine)) for i in range(len(spans))]

    def _filler(self, np: Any, count: int) -> Any:
        amplitude = self._config.pad_noise
        if amplitude <= 0.0 or count == 0:
            return np.zeros(count, dtype=np.float32)
        rng = np.random.default_rng(0)
        return rng.uniform(-amplitude, amplitude, count).astype(np.float32)

    def _to_transcript(self, hypothesis: Any, span: TimeSpan, lead: float) -> Transcript:
        timestamps = getattr(hypothesis, "timestamp", None) or {}
        raw_words = timestamps.get("word", [])
        confidences = getattr(hypothesis, "word_confidence", None)
        use_confidence = confidences is not None and len(confidences) == len(raw_words)
        scores: list[float] = list(confidences) if use_confidence and confidences else []
        length = span.end_s - span.start_s
        minimum = min(self._config.min_word_s, length)
        words: list[TranscribedWord] = []
        for index, item in enumerate(raw_words):
            raw_start, raw_end = float(item["start"]) - lead, float(item["end"]) - lead
            if raw_end <= 0.0 or raw_start >= length:
                continue  # entièrement dans la marge de contexte : hors du segment
            end = min(raw_end, length)
            start = min(max(raw_start, 0.0), end)
            if end - start < minimum:
                end = min(start + minimum, length)
                start = max(0.0, end - minimum)
            confidence = float(scores[index]) if scores else 0.0
            words.append(
                TranscribedWord(
                    text=str(item["word"]),
                    time=TimeSpan(span.start_s + start, span.start_s + end),
                    confidence=min(1.0, max(0.0, confidence)),
                )
            )
        return Transcript(words=tuple(words), engine=self.engine)
