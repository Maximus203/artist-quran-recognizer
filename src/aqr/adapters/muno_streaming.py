"""B4 Quran ASR : Muno FastConformer streaming quantisé (ONNX, CPU).

Le modèle ne fournit que la transcription. Les mots sont localisés par trame CTC à 80 ms,
puis le matcher du domaine décide s'ils correspondent au Mushaf. Le texte affiché vient toujours
du corpus. Poids et tokenizer sont épinglés dans `models/LOCK.json` et restent hors Git.
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aqr.domain.models import Riwaya, TimeSpan
from aqr.domain.ports import AudioClip, QuranASR, TranscribedWord, Transcript
from aqr.models.lock import ModelsLock, verify_model_files

MODEL_KEY = "muno-fastconformer-quran-streaming"
SAMPLE_RATE = 16_000
HOP_LENGTH = 160
CHUNK_MEL_FRAMES = 112
MIN_CHUNK_MEL_FRAMES = 10
"""En dessous, le sous-échantillonnage du modèle ne laisse aucune trame et l'ONNX échoue."""
OUTPUT_FRAME_S = 0.08
BLANK_ID = 1024
VOCAB_SIZE = 1025


@dataclass(frozen=True)
class MunoStreamingConfig:
    models_dir: Path | None = None
    lock_path: Path = Path("models/LOCK.json")
    device: str = "cpu"
    cmvn_kind: str = "tlog"
    verify_on_load: bool = True


def mel_chunks(features: Any) -> Iterator[Any]:
    """Morceaux successifs `(1, n_mels, ≤ CHUNK_MEL_FRAMES)` pour le modèle streaming. Un dernier
    morceau trop court est complété par des trames nulles (la moyenne CMVN, donc neutres)."""
    import numpy as np

    for offset in range(0, features.shape[1], CHUNK_MEL_FRAMES):
        chunk = features[:, offset : offset + CHUNK_MEL_FRAMES]
        missing = MIN_CHUNK_MEL_FRAMES - chunk.shape[1]
        if missing > 0:
            chunk = np.pad(chunk, ((0, 0), (0, missing)))
        yield chunk[None]


def words_from_tokens(
    tokens: Sequence[tuple[int, int, float]],
    tokenizer: Any,
    span: TimeSpan,
    frame_duration_s: float = OUTPUT_FRAME_S,
) -> tuple[TranscribedWord, ...]:
    """Regroupe les pièces SentencePiece en mots horodatés et bornés au segment."""
    groups: list[tuple[list[int], float, float, list[float]]] = []
    for token, frame, confidence in tokens:
        piece = tokenizer.id_to_piece(token)
        if piece.startswith("▁") or not groups:
            start = span.start_s + frame * frame_duration_s
            groups.append(
                ([token], start, span.start_s + (frame + 1) * frame_duration_s, [confidence])
            )
        else:
            ids, start, _end, scores = groups[-1]
            end = span.start_s + (frame + 1) * frame_duration_s
            groups[-1] = ([*ids, token], start, end, [*scores, confidence])

    words: list[TranscribedWord] = []
    for index, (ids, start, token_end, scores) in enumerate(groups):
        next_start = groups[index + 1][1] if index + 1 < len(groups) else span.end_s
        start = min(max(start, span.start_s), span.end_s)
        end = min(max(token_end, start + frame_duration_s), next_start, span.end_s)
        if end <= start:
            continue
        text = tokenizer.decode(ids).strip()
        if not text:
            continue
        words.append(
            TranscribedWord(
                text=text,
                time=TimeSpan(start, end),
                confidence=min(1.0, max(0.0, sum(scores) / len(scores))),
            )
        )
    return tuple(words)


@dataclass(frozen=True)
class MunoAssets:
    """Ce que charge le modèle, commun à l'adaptateur par fenêtres et à l'incrémental."""

    session: Any
    tokenizer: Any
    cmvn: Any
    revision: str


def open_muno_assets(
    models_dir: Path,
    lock_path: Path,
    *,
    verify_on_load: bool = True,
    providers: Sequence[str] = ("CPUExecutionProvider",),
    intra_op_threads: int = 0,
) -> MunoAssets:  # pragma: no cover - dépendances et poids réels
    """Session ONNX, tokenizer et CMVN épinglés dans `models/LOCK.json`."""
    import numpy as np
    import onnxruntime as ort
    import sentencepiece as spm

    lock = ModelsLock.load(lock_path)
    if verify_on_load:
        verify_model_files(models_dir, MODEL_KEY, lock)
    model_dir = models_dir / MODEL_KEY
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = intra_op_threads
    session = ort.InferenceSession(
        str(model_dir / "model.q8.onnx"), sess_options=opts, providers=list(providers)
    )
    return MunoAssets(
        session=session,
        tokenizer=spm.SentencePieceProcessor(model_file=str(model_dir / "tokenizer.model")),
        cmvn=np.load(model_dir / "streaming_global_cmvn.npz", allow_pickle=False),
        revision=lock.models[MODEL_KEY].revision,
    )


def normalize_log_mel(log_mel: Any, cmvn: Any, cmvn_kind: str) -> Any:
    """Moyenne et écart-type globaux du modèle sur un log-mel `(80, trames)`."""
    import numpy as np

    mean_key, std_key = f"{cmvn_kind}_mean", f"{cmvn_kind}_std"
    if mean_key not in cmvn or std_key not in cmvn:
        raise RuntimeError(f"CMVN Muno incomplet pour {cmvn_kind}")
    mean = cmvn[mean_key][:, None]
    std = cmvn[std_key][:, None]
    return ((log_mel - mean) / (std + 1e-5)).astype(np.float32, copy=False)


def new_caches(np: Any) -> tuple[Any, Any, Any]:
    """Caches du modèle streaming au début d'un flux."""
    return (
        np.zeros((1, 17, 70, 512), dtype=np.float32),
        np.zeros((1, 17, 512, 8), dtype=np.float32),
        np.zeros((1,), dtype=np.int64),
    )


class MunoStreamingQuranASR(QuranASR):
    """Adaptateur ONNX conforme au port QuranASR, avec caches streaming remis à chaque fenêtre."""

    riwaya = Riwaya.HAFS

    def __init__(
        self,
        config: MunoStreamingConfig | None = None,
        *,
        session: Any = None,
        tokenizer: Any = None,
        cmvn: Any = None,
        mel_transform: Any = None,
        torch_module: Any = None,
        numpy_module: Any = None,
        revision: str | None = None,
    ) -> None:
        self._config = config or MunoStreamingConfig()
        self._session = session
        self._tokenizer = tokenizer
        self._cmvn = cmvn
        self._mel_transform = mel_transform
        self._torch = torch_module
        self._np = numpy_module
        self._revision = revision

    @property
    def engine(self) -> str:
        revision = (self._revision or "inconnue")[:12]
        return f"{MODEL_KEY}@{revision}/ctc-q8"

    def _load(self) -> None:  # pragma: no cover - dépendances et poids réels
        import numpy as np
        import torch
        import torchaudio

        cfg = self._config
        if cfg.models_dir is None:
            raise RuntimeError("MunoStreamingConfig.models_dir requis (AQR_MODELS_DIR)")
        assets = open_muno_assets(cfg.models_dir, cfg.lock_path, verify_on_load=cfg.verify_on_load)
        self._session = assets.session
        self._tokenizer = assets.tokenizer
        self._cmvn = assets.cmvn
        self._torch = torch
        self._np = np
        self._mel_transform = torchaudio.transforms.MelSpectrogram(
            sample_rate=SAMPLE_RATE,
            n_fft=512,
            win_length=400,
            hop_length=HOP_LENGTH,
            n_mels=80,
            power=2.0,
            window_fn=torch.hann_window,
            norm="slaney",
            mel_scale="slaney",
        )
        self._revision = assets.revision

    def _ensure_loaded(self) -> None:
        if self._session is None or self._tokenizer is None:
            self._load()

    def transcribe(self, clip: AudioClip, span: TimeSpan) -> Transcript:
        if span.end_s > len(clip.samples) / clip.sample_rate + 1e-6:
            raise ValueError(f"segment {span} hors du clip")
        if clip.sample_rate != SAMPLE_RATE:
            raise ValueError(f"Muno exige {SAMPLE_RATE} Hz, reçu {clip.sample_rate} Hz")
        self._ensure_loaded()
        np, torch = self._np, self._torch
        start = round(span.start_s * SAMPLE_RATE)
        end = round(span.end_s * SAMPLE_RATE)
        signal = np.asarray(clip.samples[start:end], dtype=np.float32)
        if signal.size < 512:
            return Transcript(words=(), engine=self.engine)

        waveform = torch.from_numpy(signal)
        emphasized = torch.cat((waveform[:1], waveform[1:] - 0.97 * waveform[:-1]))
        mel = self._mel_transform(emphasized)
        features = torch.log(mel + 2**-24).numpy().astype(np.float32, copy=False)
        features = normalize_log_mel(features, self._cmvn, self._config.cmvn_kind)

        cache_channel, cache_time, cache_len = new_caches(np)
        observed: list[tuple[int, int, float]] = []
        previous = -1
        output_frame = 0
        for chunk in mel_chunks(features):
            chunk_length = np.asarray([chunk.shape[2]], dtype=np.int64)
            logprobs, encoded_lengths, cache_channel, cache_time, cache_len = self._session.run(
                None,
                {
                    "audio_signal": chunk,
                    "length": chunk_length,
                    "cache_last_channel": cache_channel,
                    "cache_last_time": cache_time,
                    "cache_last_channel_len": cache_len,
                },
            )
            frame_count = int(encoded_lengths[0])
            for index, row in enumerate(logprobs[0, :frame_count]):
                token = int(np.argmax(row))
                confidence = float(np.exp(row[token]))
                if token != previous and token != BLANK_ID:
                    observed.append((token, output_frame + index, confidence))
                previous = token
            output_frame += frame_count

        words = words_from_tokens(observed, self._tokenizer, span)
        return Transcript(words=words, engine=self.engine)
