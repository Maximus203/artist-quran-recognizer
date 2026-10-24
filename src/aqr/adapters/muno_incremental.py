"""B4 incrémental : Muno FastConformer streaming, caches gardés d'un bloc à l'autre (ADR-0011).

Port `StreamingAsr`. Là où `muno_streaming.MunoStreamingQuranASR` reçoit une fenêtre entière et
remet les caches à zéro, cet adaptateur consomme l'audio au fil de l'eau : les trames mel sont
calculées dès que leur fenêtre est complète (96 échantillons d'avance sur le morceau de 1,12 s),
chaque morceau de 112 trames passe dans le modèle avec les caches rendus par le précédent, et les
mots sont livrés une fois **stables** (suivis d'un autre mot, ou `settle_s` sans pièce de plus). Le
texte reste celui du modèle : brut, jamais affiché comme « passage entendu » (I1) ; la
normalisation et la mise en face du Coran sont l'affaire du suivi.

Le temps d'un mot est celui de l'audio : trame `j` du morceau `c` = `c x 1,12 s + j x 0,08 s` (le
modèle rend 13 trames de 80 ms pour 1,12 s, voir `aqr.live.replay.stream_time`).
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from aqr.adapters.muno_streaming import (
    BLANK_ID,
    CHUNK_MEL_FRAMES,
    HOP_LENGTH,
    MIN_CHUNK_MEL_FRAMES,
    MODEL_KEY,
    OUTPUT_FRAME_S,
    SAMPLE_RATE,
    new_caches,
    normalize_log_mel,
    open_muno_assets,
)
from aqr.domain.models import Riwaya, TimeSpan
from aqr.domain.ports import (
    AsrUpdate,
    PartialText,
    StableWord,
    StreamingAsrSession,
    TranscribedWord,
)

N_FFT = 512
PAD_SAMPLES = N_FFT // 2
PREEMPHASIS = 0.97
CHUNK_SAMPLES = CHUNK_MEL_FRAMES * HOP_LENGTH
CHUNK_S = CHUNK_SAMPLES / SAMPLE_RATE
"""Durée d'un morceau de 112 trames mel de 10 ms : 1,12 s."""
LOOKAHEAD_SAMPLES = PAD_SAMPLES - HOP_LENGTH
"""Échantillons à recevoir AU-DELÀ d'un morceau pour que la fenêtre de sa dernière trame soit
complète (96 = 6 ms)."""
MIN_STREAM_SAMPLES = 512
"""En dessous, le modèle hors ligne ne rend rien non plus (`MunoStreamingQuranASR`)."""

MelFn = Callable[[Any], Any]
"""Tranche d'échantillons déjà pré-accentués ET complétés -> log-mel normalisé `(80, trames)`,
sans complétion (`center=False`)."""


@dataclass(frozen=True)
class MunoIncrementalConfig:
    models_dir: Path | None = None
    lock_path: Path = Path("models/LOCK.json")
    device: str = "cpu"
    """`cpu` ou `cuda` (fournisseur ONNX CUDA, puis CPU en repli ; exige `onnxruntime-gpu`)."""
    cmvn_kind: str = "tlog"
    verify_on_load: bool = True
    intra_op_threads: int = 0
    settle_s: float = 0.8
    """Un mot est stable quand un autre mot commence, ou quand cette durée de sortie s'est écoulée
    après sa dernière pièce sans qu'une autre vienne le prolonger. Mesuré le 2026-10-24 sur 6 clips
    EveryAyah (65 mots, 3 récitants) : le CTC espace parfois les pièces d'un même mot de plus de
    0,5 s (récitation lente, allongements) ; à 80 ms un mot sur trois était coupé en deux (21 pièces
    tardives), à 0,48 s encore 3, à 0,8 s aucune et les mots sont ceux du hors ligne. Coût : la
    livraison du dernier mot d'un morceau attend ce délai (médiane fin du mot -> livraison 1,08 s
    contre 0,58 s à 80 ms). Un mot coupé en deux est un mot faux pour le suivi (I3) : la
    précision d'abord."""

    def __post_init__(self) -> None:
        if self.device not in ("cpu", "cuda"):
            raise ValueError(f"device doit être cpu ou cuda (reçu {self.device})")
        if self.settle_s < 0:
            raise ValueError("settle_s doit être >= 0")


def preemphasis(raw: Any) -> Any:
    """Filtre de pré-accentuation du modèle : `y[0] = x[0]`, `y[i] = x[i] - 0,97 x[i-1]`."""
    import numpy as np

    out = np.array(raw, dtype=np.float32, copy=True)
    if len(out) > 1:
        out[1:] -= PREEMPHASIS * np.asarray(raw, dtype=np.float32)[:-1]
    return out


class MelStream:
    """Trames mel au fil des échantillons, identiques à celles du fichier entier.

    Hors ligne, le signal pré-accentué est complété de 256 échantillons par réflexion de chaque
    côté, puis découpé en fenêtres de 512 pas de 160. Ici la complétion de gauche se fait une
    fois, celle de droite à la fin du flux ; entre les deux, un morceau de 112 trames sort dès que
    ses fenêtres sont complètes. Le tampon ne garde que ce dont les morceaux à venir ont besoin.
    """

    def __init__(self, mel_fn: MelFn) -> None:
        import numpy as np

        self._np = np
        self._mel_fn = mel_fn
        self._buf = np.zeros(0, dtype=np.float32)
        self._base = 0  # indice (flux brut) du premier échantillon du tampon
        self._total = 0
        self._previous = 0.0
        self._chunk = 0
        self._flushed = False

    @property
    def buffered_samples(self) -> int:
        return len(self._buf)

    @property
    def total_samples(self) -> int:
        return self._total

    def push(self, samples: Any) -> None:
        if self._flushed:
            raise ValueError("flux déjà terminé")
        np = self._np
        raw = np.asarray(samples, dtype=np.float32)
        if raw.size == 0:
            return
        if self._total == 0:
            emphasized = preemphasis(raw)
        else:
            emphasized = raw.copy()
            emphasized[0] -= PREEMPHASIS * self._previous
            if raw.size > 1:
                emphasized[1:] -= PREEMPHASIS * raw[:-1]
        self._previous = float(raw[-1])
        self._buf = np.concatenate((self._buf, emphasized))
        self._total += raw.size

    def _slice(self, first_frame: int, frames: int) -> Any:
        """Fenêtres des `frames` trames à partir de `first_frame`, complétées par réflexion."""
        np = self._np
        lo = first_frame * HOP_LENGTH - PAD_SAMPLES
        hi = lo + (frames - 1) * HOP_LENGTH + N_FFT
        parts: list[Any] = []
        if lo < 0:
            parts.append(self._at(1, -lo + 1)[::-1])
        parts.append(self._at(max(lo, 0), min(hi, self._total)))
        if hi > self._total:
            missing = hi - self._total
            parts.append(self._at(self._total - 1 - missing, self._total - 1)[::-1])
        return np.concatenate(parts)

    def _at(self, start: int, stop: int) -> Any:
        if start < self._base:
            raise RuntimeError("échantillons déjà abandonnés par le tampon")
        return self._buf[start - self._base : stop - self._base]

    def _make(self, frames: int) -> Any:
        np = self._np
        features = np.asarray(self._mel_fn(self._slice(self._chunk * CHUNK_MEL_FRAMES, frames)))
        if features.shape[1] != frames:
            raise RuntimeError(f"{frames} trames attendues, {features.shape[1]} calculées")
        missing = MIN_CHUNK_MEL_FRAMES - frames
        if missing > 0:
            features = np.pad(features, ((0, 0), (0, missing)))
        return features[None]

    def _trim(self) -> None:
        keep_from = max(0, self._chunk * CHUNK_SAMPLES - PAD_SAMPLES - 1)
        if keep_from > self._base:
            self._buf = self._buf[keep_from - self._base :]
            self._base = keep_from

    def ready(self) -> Iterator[Any]:
        """Morceaux pleins que les échantillons reçus permettent déjà de calculer."""
        while self._total >= (self._chunk + 1) * CHUNK_SAMPLES + LOOKAHEAD_SAMPLES:
            chunk = self._make(CHUNK_MEL_FRAMES)
            self._chunk += 1
            self._trim()
            yield chunk

    def flush(self) -> Iterator[Any]:
        """Fin du flux : les trames restantes, la complétion de droite comprise ; le dernier morceau
        peut être court (complété à ce que le modèle accepte)."""
        if self._flushed:
            return
        self._flushed = True
        if self._total < MIN_STREAM_SAMPLES:
            return
        total_frames = 1 + self._total // HOP_LENGTH
        while self._chunk * CHUNK_MEL_FRAMES < total_frames:
            frames = min(CHUNK_MEL_FRAMES, total_frames - self._chunk * CHUNK_MEL_FRAMES)
            chunk = self._make(frames)
            self._chunk += 1
            yield chunk


@dataclass(slots=True)
class _Word:
    ids: list[int]
    start_s: float
    end_s: float  # fin de la dernière pièce
    scores: list[float] = field(default_factory=list)


class MunoIncrementalSession:
    """Un flux : caches du modèle, tampon mel et mots en cours."""

    def __init__(self, owner: MunoIncrementalASR) -> None:
        self._owner = owner
        assert owner.mel_fn is not None
        self._mel = MelStream(owner.mel_fn)
        self._caches = new_caches(owner.np)
        self._chunk = 0
        self._previous = -1
        self._open: _Word | None = None
        self._received = 0
        self._processed_s = 0.0
        self._covered_s = 0.0
        self._finished = False
        self._outbox: list[StableWord] = []
        self._delivered_any = False
        self.late_pieces = 0
        """Pièces arrivées après la livraison du mot qu'elles prolongeaient : devenues un mot."""

    @property
    def received_s(self) -> float:
        return self._received / SAMPLE_RATE

    # ------------------------------------------------------------------ port
    def feed(self, samples: Sequence[float]) -> AsrUpdate:
        if self._finished:
            raise ValueError("flux déjà terminé")
        before = self._mel.total_samples
        self._mel.push(samples)
        self._received += self._mel.total_samples - before
        for chunk in self._mel.ready():
            self._run(chunk)
        return self._update()

    def finish(self) -> AsrUpdate:
        if self._finished:
            return AsrUpdate(received_s=self.received_s, processed_s=self._processed_s)
        self._finished = True
        for chunk in self._mel.flush():
            self._run(chunk)
        self._deliver(self._open, next_start_s=None)
        self._open = None
        return self._update()

    # ------------------------------------------------------------------ modèle
    def _run(self, chunk: Any) -> None:
        owner = self._owner
        np = owner.np
        cache_channel, cache_time, cache_len = self._caches
        length = np.asarray([chunk.shape[2]], dtype=np.int64)
        logprobs, encoded, cache_channel, cache_time, cache_len = owner.session.run(
            None,
            {
                "audio_signal": chunk,
                "length": length,
                "cache_last_channel": cache_channel,
                "cache_last_time": cache_time,
                "cache_last_channel_len": cache_len,
            },
        )
        self._caches = (cache_channel, cache_time, cache_len)
        frames = int(encoded[0])
        base_s = self._chunk * CHUNK_S
        for j, row in enumerate(logprobs[0, :frames]):
            token = int(np.argmax(row))
            if token != self._previous and token != BLANK_ID:
                self._token(token, base_s + j * OUTPUT_FRAME_S, float(np.exp(row[token])))
            self._previous = token
        self._chunk += 1
        self._processed_s = min(self._chunk * CHUNK_S, self.received_s)
        self._covered_s = base_s + frames * OUTPUT_FRAME_S
        self._settle()

    def _token(self, token: int, start_s: float, confidence: float) -> None:
        piece = self._owner.tokenizer.id_to_piece(token)
        end_s = start_s + OUTPUT_FRAME_S
        current = self._open
        if piece.startswith("▁") or current is None:
            if current is not None:
                self._deliver(current, next_start_s=start_s)
            elif not piece.startswith("▁") and self._delivered_any:
                self.late_pieces += 1
            self._open = _Word([token], start_s, end_s, [confidence])
        else:
            current.ids.append(token)
            current.end_s = end_s
            current.scores.append(confidence)

    def _settle(self) -> None:
        current = self._open
        if current is not None and self._covered_s >= current.end_s + self._owner.settle_s - 1e-9:
            self._deliver(current, next_start_s=None)
            self._open = None

    def _deliver(self, word: _Word | None, *, next_start_s: float | None) -> None:
        if word is None:
            return
        self._delivered_any = True
        text = self._owner.tokenizer.decode(word.ids).strip()
        if not text:
            return
        ceiling = self.received_s if next_start_s is None else min(next_start_s, self.received_s)
        start = min(max(word.start_s, 0.0), ceiling)
        end = min(max(word.end_s, start + OUTPUT_FRAME_S), ceiling)
        if end <= start:
            return
        self._outbox.append(
            StableWord(
                TranscribedWord(
                    text=text,
                    time=TimeSpan(start, end),
                    confidence=min(1.0, max(0.0, sum(word.scores) / len(word.scores))),
                ),
                arrival_s=self.received_s,
            )
        )

    def _update(self) -> AsrUpdate:
        stable = tuple(self._outbox)
        self._outbox.clear()
        partial = None
        current = self._open
        if current is not None:
            text = self._owner.tokenizer.decode(current.ids).strip()
            if text:
                partial = PartialText(current.start_s, current.end_s, text)
        return AsrUpdate(
            stable=stable,
            partial=partial,
            received_s=self.received_s,
            processed_s=self._processed_s,
        )


class MunoIncrementalASR:
    """Fabrique de flux : le modèle est chargé une fois, chaque `open()` a ses propres caches."""

    riwaya = Riwaya.HAFS
    sample_rate = SAMPLE_RATE

    def __init__(
        self,
        config: MunoIncrementalConfig | None = None,
        *,
        session: Any = None,
        tokenizer: Any = None,
        mel_fn: MelFn | None = None,
        revision: str | None = None,
    ) -> None:
        import numpy as np

        self.config = config or MunoIncrementalConfig()
        self.np = np
        self.session = session
        self.tokenizer = tokenizer
        self.mel_fn = mel_fn
        self._revision = revision

    @property
    def settle_s(self) -> float:
        return self.config.settle_s

    @property
    def engine(self) -> str:
        revision = (self._revision or "inconnue")[:12]
        return f"{MODEL_KEY}@{revision}/ctc-q8/incremental-{self.config.device}"

    def _load(self) -> None:  # pragma: no cover - dépendances et poids réels
        import torch
        import torchaudio

        cfg = self.config
        if cfg.models_dir is None:
            raise RuntimeError("MunoIncrementalConfig.models_dir requis (AQR_MODELS_DIR)")
        providers = (
            ("CUDAExecutionProvider", "CPUExecutionProvider")
            if cfg.device == "cuda"
            else ("CPUExecutionProvider",)
        )
        assets = open_muno_assets(
            cfg.models_dir,
            cfg.lock_path,
            verify_on_load=cfg.verify_on_load,
            providers=providers,
            intra_op_threads=cfg.intra_op_threads,
        )
        transform = torchaudio.transforms.MelSpectrogram(
            sample_rate=SAMPLE_RATE,
            n_fft=N_FFT,
            win_length=400,
            hop_length=HOP_LENGTH,
            n_mels=80,
            power=2.0,
            window_fn=torch.hann_window,
            norm="slaney",
            mel_scale="slaney",
            center=False,
        )
        np, cmvn, kind = self.np, assets.cmvn, cfg.cmvn_kind

        def mel_fn(padded: Any) -> Any:
            with torch.inference_mode():
                mel = transform(torch.from_numpy(np.ascontiguousarray(padded)))
            return normalize_log_mel(torch.log(mel + 2**-24).numpy().astype(np.float32), cmvn, kind)

        self.session, self.tokenizer, self.mel_fn = assets.session, assets.tokenizer, mel_fn
        self._revision = assets.revision

    def open(self) -> StreamingAsrSession:
        if self.session is None or self.tokenizer is None or self.mel_fn is None:
            self._load()
        return MunoIncrementalSession(self)
