"""Scénarios de simulation : vérité terrain calculée depuis les durées, mots d'ASR en cache.

Un scénario = des mots d'ASR datés (rejeu, voir `replay`) + ce qui a été réellement dit (versets
avec leur intervalle de parole, zones non coraniques). La vérité d'un montage (versets EveryAyah
mis bout à bout) est **calculée** : durée de chaque pièce, et début/fin de la parole mesurés sur
l'énergie du signal (indépendants de l'ASR), jamais lus dans la sortie du moteur.
"""

from __future__ import annotations

import json
import math
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aqr.domain.models import TimeSpan, VerseRef
from aqr.domain.ports import TranscribedWord
from aqr.live.corpus_flow import Skeleton
from aqr.live.replay import ArrivalModel, heard_words
from aqr.live.simulation import Scenario, TruthVerse, TruthZone

WORDS_SCHEMA = "aqr.live-asr-words/1"
SPEECH_FRAME_S = 0.02
SPEECH_RATIO = 0.08
"""Une trame est de la parole si son énergie dépasse ce rapport de la plus forte trame du clip."""


def speech_bounds(
    samples: Sequence[float],
    sample_rate: int,
    *,
    frame_s: float = SPEECH_FRAME_S,
    ratio: float = SPEECH_RATIO,
) -> tuple[float, float] | None:
    """(début, fin) de la parole en secondes, d'après l'énergie par trame ; None si muet."""
    size = max(1, round(frame_s * sample_rate))
    energies: list[float] = []
    for offset in range(0, len(samples), size):
        chunk = samples[offset : offset + size]
        energies.append(math.sqrt(sum(x * x for x in chunk) / len(chunk)))
    if not energies:
        return None
    peak = max(energies)
    if peak < 1e-4:
        return None
    voiced = [i for i, e in enumerate(energies) if e >= ratio * peak]
    return voiced[0] * size / sample_rate, min(len(samples), (voiced[-1] + 1) * size) / sample_rate


@dataclass(frozen=True)
class Piece:
    """Un morceau d'un montage audio : un verset, une zone non coranique, ou un silence."""

    kind: str  # verse | zone | gap
    duration_s: float
    speech: tuple[float, float] | None = None
    """Début et fin de la parole dans la pièce (secondes depuis son début), None si muette."""
    ref: VerseRef | None = None
    zone_kind: str | None = None

    @classmethod
    def verse(cls, ref: VerseRef, duration_s: float, speech: tuple[float, float] | None) -> Piece:
        return cls("verse", duration_s, speech, ref=ref)

    @classmethod
    def zone(cls, kind: str, duration_s: float, speech: tuple[float, float] | None) -> Piece:
        return cls("zone", duration_s, speech, zone_kind=kind)

    @classmethod
    def gap(cls, duration_s: float) -> Piece:
        return cls("gap", duration_s)


def layout(pieces: Sequence[Piece]) -> tuple[list[TruthVerse], list[TruthZone], float]:
    """Vérité d'un montage : versets, zones et durée totale, depuis les durées des pièces."""
    verses: list[TruthVerse] = []
    zones: list[TruthZone] = []
    cursor = 0.0
    for piece in pieces:
        if piece.speech is not None:
            start, end = cursor + piece.speech[0], cursor + piece.speech[1]
            if piece.kind == "verse" and piece.ref is not None:
                verses.append(TruthVerse(piece.ref, start, end))
            elif piece.kind == "zone":
                zones.append(TruthZone(start, end, piece.zone_kind or "non_quran"))
        cursor += piece.duration_s
    return verses, zones, cursor


# --------------------------------------------------------------------------- mots d'ASR en cache
def save_words(
    path: Path, words: Sequence[TranscribedWord], *, engine: str, audio_s: float
) -> None:
    payload: dict[str, Any] = {
        "schema": WORDS_SCHEMA,
        "engine": engine,
        "audio_s": round(audio_s, 3),
        "words": [
            {
                "text": w.text,
                "t": [round(w.time.start_s, 3), round(w.time.end_s, 3)],
                "confidence": round(w.confidence, 4),
            }
            for w in words
        ],
    }
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def load_words(path: Path) -> tuple[list[TranscribedWord], str, float]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema") != WORDS_SCHEMA:
        raise ValueError(f"{path} n'est pas un fichier {WORDS_SCHEMA}")
    words = [
        TranscribedWord(
            text=w["text"],
            time=TimeSpan(float(w["t"][0]), float(w["t"][1])),
            confidence=float(w["confidence"]),
        )
        for w in payload["words"]
    ]
    return words, str(payload["engine"]), float(payload["audio_s"])


def scenario_from_words(
    scenario_id: str,
    source: str,
    words: Sequence[TranscribedWord],
    skeleton: Skeleton,
    model: ArrivalModel,
    *,
    verses: Sequence[TruthVerse],
    zones: Sequence[TruthZone],
    duration_s: float,
) -> Scenario:
    return Scenario(
        id=scenario_id,
        source=source,
        words=tuple(heard_words(words, skeleton, model)),
        duration_s=duration_s,
        verses=tuple(verses),
        zones=tuple(zones),
    )
