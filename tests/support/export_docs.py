"""Documents `aqr.recognition/1` synthétiques pour les tests de l'export de sous-titres.

Pas de texte ni de traduction dans les intervalles : l'export lit le corpus (I1) ; quand un test a
besoin d'une traduction, il la donne à l'intervalle ou à la source de traduction factice.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from aqr.domain.models import VerseRef


def verse(
    ref: str,
    words: tuple[int, int],
    t: tuple[float, float] | None,
    *,
    status: str = "recognized",
    partial: bool | None = None,
    candidates: Sequence[str] = (),
    repetition: bool = False,
    translation: Mapping[str, Any] | None = None,
    word_times: Sequence[tuple[float, float]] | None = None,
    time_interpolated: bool | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "kind": "verse",
        "ref": ref,
        "words": list(words),
        "partial": bool(partial),
        "status": status,
        "t": None if t is None else list(t),
        "time_interpolated": status == "inferred"
        if time_interpolated is None
        else time_interpolated,
        "confidence": 0.9,
        "candidates": list(candidates),
        "repetition": repetition,
        "text": None,
        "translation": dict(translation) if translation else None,
    }
    if word_times is not None:
        item["word_times"] = [list(w) for w in word_times]
        item["word_times_source"] = "ctc-alignment"
    return item


def uncertain(
    ref: str, words: tuple[int, int], t: tuple[float, float], candidates: Sequence[str]
) -> dict[str, Any]:
    return verse(ref, words, t, status="uncertain", candidates=candidates)


def abstention(t: tuple[float, float], reason: str = "no_candidate") -> dict[str, Any]:
    return {"kind": "abstention", "reason": reason, "t": list(t), "best_score": 0.5}


def formula(label: str, t: tuple[float, float], **extra: Any) -> dict[str, Any]:
    return {"kind": "non_quran", "label": label, "t": list(t), **extra}


def fragment_translation(
    text: str, fragment_text: str, words: tuple[int, int], *, approximate: bool = False
) -> dict[str, Any]:
    return {
        "text": text,
        "translation_id": "french_hameedullah",
        "version": "quranenc.com",
        "attribution": "QuranEnc.com — Muhammad Hamidullah (révision du Complexe du Roi Fahd)",
        "scope": "fragment",
        "fragment": {
            "words": list(words),
            "text": fragment_text,
            "approximate": approximate,
            "ellipsis_before": True,
            "ellipsis_after": False,
        },
    }


def document(*intervals: Mapping[str, Any], merge_max_gap_s: float | None = 5.0) -> dict[str, Any]:
    decoder: dict[str, float] = {"min_recognized_score": 0.75, "infer_max_gap_s": 180.0}
    if merge_max_gap_s is not None:
        decoder["merge_max_gap_s"] = merge_max_gap_s
    end = max((i["t"][1] for i in intervals if i.get("t")), default=1.0) + 1.0
    return {
        "schema": "aqr.recognition/1",
        "source": {"file": "essai.mp3", "sha256": "ab" * 32, "duration_s": end},
        "engine": {
            "asr": "test",
            "segmenter": "test",
            "matcher": "test",
            "decoder": "test",
            "constrained": False,
            "corpus": "tanzil.net hafs (test)",
        },
        "decoder": decoder,
        "timing": {"total_s": 1.0},
        "windows": len(intervals),
        "warnings": [],
        "intervals": [dict(i) for i in intervals],
    }


def total_words(corpus: Any, ref: str) -> int:
    return len(corpus.words(VerseRef.parse(ref)))
