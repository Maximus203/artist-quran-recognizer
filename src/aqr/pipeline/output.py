"""Sortie de `aqr recognize` : JSON `aqr.recognition/1`, puis SRT/VTT.

Le texte arabe vient du corpus et la traduction du dépôt de traductions (via `HomeRenderer`),
jamais de l'ASR (I1, I2). Un verset `UNCERTAIN` n'est jamais nommé par son texte (seulement ses
candidats) ; un `INFERRED` est marqué comme tel ; une abstention est un intervalle sans verset.
"""

from __future__ import annotations

from aqr.domain.models import Detection, NonQuranKind, NonQuranSpan, TimeSpan
from aqr.pipeline.result import AbstentionSpan, Interval, RecognitionResult
from aqr.rendering.home_renderer import HomeRenderer, format_range

SCHEMA = "aqr.recognition/1"

_LABEL_CAPTION = {
    NonQuranKind.ISTIADHA: "[isti'adha]",
    NonQuranKind.TAKBIR: "[takbir]",
    NonQuranKind.AMIN: "[amin]",
    NonQuranKind.BASMALA: "[basmala]",
}


def _span(time: TimeSpan | None) -> list[float] | None:
    return None if time is None else [round(time.start_s, 3), round(time.end_s, 3)]


def _interval_json(
    item: Interval, renderer: HomeRenderer, translation_id: str | None
) -> dict[str, object]:
    if isinstance(item, Detection):
        rendered = renderer.render_item(item, translation_id)
        return {
            "kind": "verse",
            "ref": rendered["ref"],
            "words": rendered["words"],
            "partial": rendered["partial"],
            "status": rendered["status"],
            "t": _span(item.time),
            "time_interpolated": item.time_interpolated,
            "confidence": round(item.confidence, 4),
            "candidates": rendered["candidates"],
            "repetition": rendered["repetition"],
            "text": rendered["text"],
            "translation": rendered["translation"],
        }
    if isinstance(item, NonQuranSpan):
        return {"kind": "non_quran", "label": item.kind.value, "t": _span(item.time)}
    assert isinstance(item, AbstentionSpan)
    return {
        "kind": "abstention",
        "reason": item.reason.value,
        "t": _span(item.time),
        "best_score": None if item.best_score is None else round(item.best_score, 4),
    }


def build_json(
    result: RecognitionResult,
    renderer: HomeRenderer,
    translation_id: str | None,
    source_sha256: str,
) -> dict[str, object]:
    engine = result.engine
    return {
        "schema": SCHEMA,
        "source": {
            "file": result.source_file,
            "sha256": source_sha256,
            "duration_s": result.duration_s,
        },
        "engine": {
            "asr": engine.asr,
            "segmenter": engine.segmenter,
            "matcher": engine.matcher,
            "decoder": engine.decoder,
            "constrained": engine.constrained,
            "corpus": engine.corpus,
        },
        "decoder": result.decoder_config,
        "timing": {k: round(v, 3) for k, v in result.timing.items()},
        "windows": result.windows,
        "warnings": list(result.warnings),
        "intervals": [_interval_json(i, renderer, translation_id) for i in result.intervals],
    }


def _captions(result: RecognitionResult, renderer: HomeRenderer) -> list[tuple[TimeSpan, str]]:
    lines: list[tuple[TimeSpan, str]] = []
    for item in result.intervals:
        if isinstance(item, Detection) and item.time is not None:
            lines.append((item.time, renderer.caption(item)))
        elif isinstance(item, NonQuranSpan):
            lines.append((item.time, _LABEL_CAPTION.get(item.kind, f"[{item.kind.value}]")))
    return lines


def render_srt(result: RecognitionResult, renderer: HomeRenderer) -> str:
    blocks = [
        f"{n}\n{format_range(time, ',')}\n{text}\n"
        for n, (time, text) in enumerate(_captions(result, renderer), start=1)
    ]
    return "\n".join(blocks)


def render_vtt(result: RecognitionResult, renderer: HomeRenderer) -> str:
    blocks = ["WEBVTT\n"]
    blocks.extend(
        f"{format_range(time, '.')}\n{text}\n" for time, text in _captions(result, renderer)
    )
    return "\n".join(blocks)


def redact_document(document: dict[str, object]) -> dict[str, object]:
    """Copie versionnable : sans texte ni traduction (le Mushaf et QuranEnc se relisent dans leurs
    sources épinglées ; une traduction n'est pas à republier), références/temps/statuts gardés."""
    intervals = document["intervals"]
    assert isinstance(intervals, list)
    light = [{k: v for k, v in i.items() if k not in ("text", "translation")} for i in intervals]
    return {**document, "intervals": light}
