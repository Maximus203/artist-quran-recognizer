"""Sortie de `aqr recognize` : JSON `aqr.recognition/1`, puis SRT/VTT.

Le texte arabe vient du corpus et la traduction du dépôt de traductions (via `HomeRenderer`),
jamais de l'ASR (I1, I2). Un verset `UNCERTAIN` n'est jamais nommé par son texte (seulement ses
candidats) ; un `INFERRED` est marqué comme tel ; une abstention est un intervalle sans verset.
"""

from __future__ import annotations

from aqr.alignment.verification import ChainCheck
from aqr.domain.models import Detection, NonQuranKind, NonQuranSpan, Status, TimeSpan
from aqr.pipeline.result import AbstentionSpan, Interval, RecognitionResult
from aqr.pipeline.word_times import CTC_ALIGNMENT, INTERPOLATED, interpolate
from aqr.rendering.formula_labels import FORMULA_LABELS_AR
from aqr.rendering.home_renderer import HomeRenderer, format_range

SCHEMA = "aqr.recognition/1"
RIWAYA_NOTICE = (
    "Riwaya supposée Hafs, non vérifiée : le corpus et le modèle sont en Hafs. Une récitation "
    "en Warsh (ou une autre riwaya) peut être reconnue, mais le texte affiché est celui du Hafs "
    "et peut différer sur certains mots."
)
"""Aucun signal ne détecte encore une autre riwaya (mesure négative du 2026-10-20) : avertissement
permanent, décision de Cherif du 2026-10-20."""

_LABEL_CAPTION = {
    NonQuranKind.ISTIADHA: "[isti'adha]",
    NonQuranKind.TAKBIR: "[takbir]",
    NonQuranKind.AMIN: "[amin]",
    NonQuranKind.BASMALA: "[basmala]",
}


def _span(time: TimeSpan | None) -> list[float] | None:
    return None if time is None else [round(time.start_s, 3), round(time.end_s, 3)]


def _word_fields(item: Detection, renderer: HomeRenderer) -> dict[str, object]:
    """Temps de chaque mot affiché (ADR-0010) : mesurés par l'alignement s'ils couvrent exactement
    la plage `words`, sinon estimés au prorata de la longueur des mots, bornés à l'intervalle. Rien
    pour un verset non nommé (`uncertain`) ou jamais entendu (`inferred`)."""
    if item.status is not Status.RECOGNIZED or item.time is None:
        return {}
    shown = item.span.last_word - item.span.first_word + 1
    if len(item.word_times) == shown:
        return {
            "word_times": [_span(t) for t in item.word_times],
            "word_times_source": CTC_ALIGNMENT,
        }
    estimated = interpolate(renderer.word_weights(item), item.time)
    return {
        "word_times": [_span(t) for t in estimated],
        "word_times_source": INTERPOLATED,
    }


def _non_quran_json(
    item: NonQuranSpan, renderer: HomeRenderer, translation_id: str | None
) -> dict[str, object]:
    """Zone non coranique. La basmala est le verset 1:1 : son texte et sa traduction viennent du
    corpus (I1, I2), signalés par `basmala: true`. Isti'adha, takbir et amin n'ont aucun texte du
    Mushaf : un libellé arabe constant (`label_ar`), jamais présenté comme un verset."""
    base: dict[str, object] = {"kind": "non_quran", "label": item.kind.value, "t": _span(item.time)}
    if item.kind is NonQuranKind.BASMALA:
        return {**base, **renderer.render_basmala(translation_id)}
    label_ar = FORMULA_LABELS_AR.get(item.kind)
    return base if label_ar is None else {**base, "label_ar": label_ar}


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
            **_word_fields(item, renderer),
            **({} if item.promoted_by is None else {"promoted_by": item.promoted_by}),
        }
    if isinstance(item, NonQuranSpan):
        return _non_quran_json(item, renderer, translation_id)
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
            "acoustic": engine.acoustic,
        },
        "decoder": result.decoder_config,
        "timing": {k: round(v, 3) for k, v in result.timing.items()},
        "windows": result.windows,
        "riwaya": {"assumed": result.riwaya.value, "verified": False, "notice": RIWAYA_NOTICE},
        **({} if result.cascade is None else {"cascade": result.cascade}),
        "warnings": list(result.warnings),
        "acoustic_checks": [_check_json(c) for c in result.acoustic_checks],
        "intervals": [_interval_json(i, renderer, translation_id) for i in result.intervals],
    }


def _check_json(check: ChainCheck) -> dict[str, object]:
    """Une vérification sur l'audio (ADR-0008) : suite de versets (`chain`), suite d'un verset
    commencé (`continuation`) ou détection incertaine qui prolonge son voisin (`neighbor`) ;
    passage, texte du corpus aligné (syntaxe de `aqr align --verses`),
    preuve et décision."""
    return {
        "kind": check.kind,
        "t": _span(check.time),
        "verses": ",".join(f"{s.ref}[{s.first_word}-{s.last_word}]" for s in check.spans),
        "llr_per_frame": None if check.llr_per_frame is None else round(check.llr_per_frame, 4),
        "accepted": check.accepted,
        **({} if check.text_similarity is None else {"text_similarity": check.text_similarity}),
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
