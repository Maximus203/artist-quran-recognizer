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
