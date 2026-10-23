"""Rejeu d'un enregistrement comme un flux : quand chaque mot de l'ASR est-il livré ? (ADR-0011)

Le modèle streaming (Muno FastConformer) traite l'audio par blocs de 112 trames de 10 ms
(`muno_streaming.CHUNK_MEL_FRAMES`, soit 1,12 s) : un mot n'est connu qu'une fois le bloc qui le
contient entièrement traité. `ArrivalModel` en fait l'arrivée d'un mot, en temps du flux :

    arrivée = fin du premier bloc qui contient la fin du mot (+ une trame de garde) + calcul

Approximation assumée : l'ASR est exécuté une fois sur le fichier entier (les caches du modèle sont
bien reportés d'un bloc au suivant, comme en direct) et chaque mot reçoit ensuite l'heure de son
bloc. Le temps de calcul réel, la mise en mémoire tampon réseau et l'éventuelle révision d'un mot
par le bloc suivant ne sont pas simulés (étape 2).
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass

from aqr.domain.models import TimeSpan
from aqr.domain.ports import HeardWord, TranscribedWord
from aqr.live.corpus_flow import Skeleton


@dataclass(frozen=True)
class ArrivalModel:
    block_s: float = 1.12
    """Durée d'un bloc de l'ASR streaming (112 trames de 10 ms)."""
    settle_s: float = 0.08
    """Garde après la fin du mot : une pièce de plus (80 ms) peut encore le prolonger."""
    compute_s: float = 0.0
    """Temps de calcul simulé d'un bloc, ajouté à chaque arrivée (0 = calcul instantané)."""

    def __post_init__(self) -> None:
        if self.block_s <= 0 or self.settle_s < 0 or self.compute_s < 0:
            raise ValueError("block_s > 0, settle_s >= 0 et compute_s >= 0 requis")

    def arrival(self, end_s: float) -> float:
        blocks = math.ceil((end_s + self.settle_s) / self.block_s - 1e-9)
        return max(1, blocks) * self.block_s + self.compute_s


def heard_words(
    words: Iterable[TranscribedWord], skeleton: Skeleton, model: ArrivalModel
) -> list[HeardWord]:
    """Mots d'un ASR -> mots entendus par le suivi : normalisés comme le flux du Coran, datés de
    leur arrivée, dans l'ordre d'arrivée. Un mot vide après normalisation est écarté."""
    heard: list[HeardWord] = []
    for word in words:
        text = skeleton(word.text)
        if not text:
            continue
        heard.append(
            HeardWord(
                text=text,
                start_s=word.time.start_s,
                end_s=word.time.end_s,
                arrival_s=model.arrival(word.time.end_s),
            )
        )
    heard.sort(key=lambda w: (w.arrival_s, w.start_s))
    return heard


# --------------------------------------------------------------------------- axe du temps de l'ASR
MUNO_FRAMES_PER_CHUNK = 13
"""Trames de sortie que le modèle donne pour un bloc de 112 trames mel (mesuré le 2026-10-23 sur
`muno-fastconformer-quran-streaming` : 13 sur chaque bloc, et non 14)."""
OUTPUT_FRAME_S = 0.08


def stream_time(
    adapter_time_s: float,
    *,
    frames_per_chunk: int = MUNO_FRAMES_PER_CHUNK,
    chunk_s: float = 1.12,
    frame_s: float = OUTPUT_FRAME_S,
) -> float:
    """Temps réel de l'audio d'un instant de la chronologie de l'adaptateur Muno.

    L'adaptateur compte chaque trame de sortie pour 80 ms, comme si un bloc de 1,12 s en donnait
    14 ; il en donne 13 : ses temps se compriment de 13/14 (environ 1,2 s d'avance à 20 s). Les
    trames sont séquentielles, donc la trame `f` appartient au bloc `f // 13` et en est la
    `f % 13`-ième.
    """
    if frames_per_chunk < 1 or adapter_time_s < 0:
        raise ValueError("frames_per_chunk >= 1 et un temps positif requis")
    frame = adapter_time_s / frame_s
    chunk = math.floor(frame / frames_per_chunk)
    return chunk * chunk_s + (frame - chunk * frames_per_chunk) * frame_s


def restore_stream_times(
    words: Iterable[TranscribedWord],
    *,
    frames_per_chunk: int = MUNO_FRAMES_PER_CHUNK,
    chunk_s: float = 1.12,
) -> list[TranscribedWord]:
    """Les mêmes mots, datés sur l'axe réel de l'audio (voir `stream_time`)."""
    restored: list[TranscribedWord] = []
    for word in words:
        start = stream_time(word.time.start_s, frames_per_chunk=frames_per_chunk, chunk_s=chunk_s)
        end = stream_time(word.time.end_s, frames_per_chunk=frames_per_chunk, chunk_s=chunk_s)
        if end <= start:
            end = start + OUTPUT_FRAME_S
        restored.append(TranscribedWord(word.text, TimeSpan(start, end), word.confidence))
    return restored
