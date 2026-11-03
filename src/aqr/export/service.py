"""Cas d'usage de l'export : contrôle de préparation, sous-titres, aperçu, lecture d'un verset.

C'est la couche « application » : elle assemble le corpus, la traduction QuranEnc (cache local),
les décisions et la revue, appelle l'analyse, la vue et les écrivains, et rend des dictionnaires
JSON que la ligne de commande imprime et que l'atelier relit. Un seul moteur de rendu, deux entrées
(`aqr recognize` et `aqr export-subtitles`).
"""

from __future__ import annotations

import copy
import hashlib
import json
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from aqr.corpus.checksums import CorpusChecksumError
from aqr.decisions import Decision, DecisionsDocument, interval_fingerprint, parse_decisions
from aqr.domain.models import VerseRef
from aqr.export.analysis import (
    MAX_CANDIDATES,
    Analysis,
    Context,
    Item,
    ReviewNote,
    analyze,
    candidate_passages,
    read_review,
)
from aqr.export.cues import CueBuild, build_cues, preview_json
from aqr.export.options import ExportOptions
from aqr.export.texts import TranslationSource, translation_text
from aqr.export.view import Omission, View, build_view
from aqr.rendering.passages import Passages
from aqr.rendering.subtitles import write_ass, write_srt, write_vtt

READINESS_SCHEMA: Final = "aqr.export-readiness/1"
RESULT_SCHEMA: Final = "aqr.export-result/1"
EXPORT_SCHEMA: Final = "aqr.recognition/1"
PAGE_SIZE: Final = 10
INEFFECTIVE_LIMIT: Final = 20
FETCH_TIMEOUT_S: Final = 6
"""Une traduction absente du cache se télécharge, mais hors ligne l'export ne doit pas attendre."""
TANZIL_CREDIT: Final = "Texte coranique : Tanzil Project (CC-BY-3.0, tanzil.net), non modifié."


class ExportBlocked(Exception):
    """Des passages ambigus restent à corriger et l'export n'est pas forcé (`unresolved_items`)."""

    def __init__(self, unresolved: int) -> None:
        super().__init__(f"{unresolved} passage(s) ambigu(s) non résolu(s)")
        self.unresolved = unresolved


class InputsError(ValueError):
    """Fichier d'entrée illisible ou incohérent (message en français)."""


# --- entrées ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class Inputs:
    document: Mapping[str, Any]
    prediction_sha256: str
    decisions: DecisionsDocument | None
    notes: tuple[ReviewNote, ...]


def _read_json(path: Path, what: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise InputsError(f"{what} illisible : {path.name} ({exc.strerror or exc})") from None
    except json.JSONDecodeError as exc:
        raise InputsError(f"{what} : JSON invalide ({exc})") from None


def load_inputs(
    prediction: Path, decisions: Path | None = None, review: Path | None = None
) -> Inputs:
    raw = prediction.read_bytes() if prediction.is_file() else b""
    if not raw:
        raise InputsError(f"prédiction introuvable : {prediction.name}")
    try:
        document = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InputsError(f"prédiction illisible ({exc})") from None
    if not isinstance(document, dict) or document.get("schema") != EXPORT_SCHEMA:
        raise InputsError(f"{prediction.name} n'est pas une sortie {EXPORT_SCHEMA}")
    parsed: DecisionsDocument | None = None
    if decisions is not None and decisions.is_file():
        try:
            parsed = parse_decisions(_read_json(decisions, "décisions"))
        except ValueError as exc:
            raise InputsError(f"décisions illisibles : {exc}") from None
    notes: tuple[ReviewNote, ...] = ()
    if review is not None and review.is_file():
        notes = tuple(read_review(_read_json(review, "revue")))
    return Inputs(document, hashlib.sha256(raw).hexdigest(), parsed, notes)


# --- traduction ------------------------------------------------------------------------------


def _fetch(url: str) -> bytes:  # pragma: no cover - réseau
    request = urllib.request.Request(
        url, headers={"User-Agent": "artist-quran-recognizer/0.1 (+export-subtitles)"}
    )
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_S) as response:
        body: bytes = response.read()
        return body


class RendererTranslations:
    """Traduction QuranEnc d'un passage, par le même code que la sortie JSON (`HomeRenderer`).

    Hors ligne, le premier échec réseau coupe les suivants : l'export continue sans traduction
    pour ces versets (et le dit) au lieu d'attendre un délai par passage."""

    def __init__(self, renderer: Any, translation_id: str) -> None:
        self._renderer = renderer
        self._id = translation_id
        self._offline = False
        self._cache: dict[tuple[str, tuple[int, int] | None], Mapping[str, Any] | None] = {}

    def passage(self, ref: VerseRef, words: tuple[int, int] | None) -> Mapping[str, Any] | None:
        key = (str(ref), words)
        if key in self._cache:
            return self._cache[key]
        found: Mapping[str, Any] | None = None
        if not self._offline:
            try:
                found = self._renderer.translation_json(ref, self._id, words)
            except OSError:
                self._offline = True
            except (CorpusChecksumError, ValueError, KeyError, RuntimeError):
                found = None
        self._cache[key] = found
        return found


@dataclass(frozen=True)
class Environment:
    corpus_dir: Path
    cache_dir: Path | None = None
    """Cache des traductions QuranEnc (`AQR_CACHE_DIR/translations`) ; None = pas de traduction."""
    segments_dir: Path | None = None
    fetcher: Callable[[str], bytes] = _fetch


def build_context(
    options: ExportOptions, env: Environment, blocking_tags: frozenset[str] = frozenset()
) -> Context:
    from aqr.adapters.quranenc import QuranEncTranslationRepository
    from aqr.corpus.tanzil_repository import TanzilCorpusRepository
    from aqr.rendering.home_renderer import HomeRenderer
    from aqr.rendering.translation_segments import SegmentLibrary

    corpus = TanzilCorpusRepository(env.corpus_dir)
    translations: TranslationSource | None = None
    if env.cache_dir is not None:
        renderer = HomeRenderer(
            corpus,
            QuranEncTranslationRepository(env.cache_dir, env.fetcher),
            SegmentLibrary(env.segments_dir) if env.segments_dir else None,
        )
        translations = RendererTranslations(renderer, options.translation_id)
    return Context(
        passages=Passages(corpus),
        options=options,
        translations=translations,
        blocking_tags=blocking_tags,
    )


# --- sérialisation ---------------------------------------------------------------------------


def decision_json(decision: Decision) -> dict[str, Any]:
    v = decision.value
    value = {
        k: (list(x) if isinstance(x, tuple) else x)
        for k, x in {
            "ref": v.ref,
            "words": v.words,
            "t": v.t,
            "reason": v.reason,
            "scope": v.scope,
        }.items()
        if x is not None
    }
    return {
        "id": decision.id,
        "kind": decision.kind,
        "value": value,
        "target": {
            "fingerprint": decision.target.fingerprint,
            "item": decision.target.item,
            "index": decision.target.index,
            "snapshot": dict(decision.target.snapshot),
            "review_ids": list(decision.target.review_ids),
        },
        "evidence": {
            "listened": decision.evidence.listened,
            "listened_s": decision.evidence.listened_s,
            "device": decision.evidence.device,
        },
        "use_for_training": decision.use_for_training,
        "decided_by": decision.decided_by,
        "decided_at": decision.decided_at,
        "revision": decision.revision,
    }


def _preview_text(
    ctx: Context, ref: VerseRef, words: tuple[int, int] | None
) -> tuple[str | None, str | None]:
    if ctx.translations is None or words is None:
        return None, None
    partial = words != (1, ctx.passages.word_count(ref))
    found = ctx.translations.passage(ref, words if partial else None)
    if found is None:
        return None, None
    text = translation_text(found, strip_notes=ctx.options.strip_notes)
    scope = "fragment" if found.get("scope") == "fragment" else "verse"
    return (None if text is None else text[:400]), scope


def candidate_views(interval: Mapping[str, Any], ctx: Context) -> list[dict[str, Any]]:
    """Les candidats d'un passage incertain, mots du corpus à l'appui, les mots qui diffèrent
    signalés (aide à la décision : un candidat n'est pas nommé par le moteur, I3)."""
    found = candidate_passages(interval, ctx.passages)[:MAX_CANDIDATES]
    token_lists = [ctx.passages.words_with_signs(ref, *rng) if rng else [] for ref, rng in found]
    views: list[dict[str, Any]] = []
    for n, (ref, rng) in enumerate(found):
        others = [t for m, t in enumerate(token_lists) if m != n]
        tokens = [
            {
                "text": text,
                "diff": any(i >= len(o) or o[i] != text for o in others),
            }
            for i, text in enumerate(token_lists[n])
        ]
        translation, scope = _preview_text(ctx, ref, rng)
        views.append(
            {
                "ref": str(ref),
                "words": None if rng is None else list(rng),
                "words_total": ctx.passages.word_count(ref),
                "tokens": tokens,
                "translation": translation,
                "translation_scope": scope,
            }
        )
    return views


def item_json(
    item: Item, analysis: Analysis, ctx: Context, *, detailed: bool = True
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "key": item.key,
        "type": item.type,
        "index": item.index,
        "fingerprint": item.fingerprint,
        "t": list(item.t),
        "ref": item.ref,
        "words": None if item.words is None else list(item.words),
        "impact": item.impact,
        "effective": item.effective,
        "state": item.state,
        "decision": None if item.decision is None else decision_json(item.decision),
        "review_ids": list(item.review_ids),
        "related_reports": list(item.related_reports),
    }
    if not detailed:
        return out
    interval = analysis.intervals[item.index] if item.index is not None else None
    if item.type == "uncertain" and interval is not None:
        out["candidates"] = candidate_views(interval, ctx)
    elif item.type in ("inferred", "cut", "approx", "report") and interval is not None:
        _describe_verse(out, item, interval, ctx)
    if item.type == "cut":
        out["sides"] = list(item.details.get("sides", []))
    if item.type == "report":
        out["notes"] = list(item.details.get("notes", []))
    if item.type == "approx":
        translation = interval.get("translation") if interval else None
        if isinstance(translation, Mapping):
            fragment = translation.get("fragment") or {}
            out["translation"] = {
                "verse": translation.get("text"),
                "fragment": fragment.get("text"),
                "fragment_words": fragment.get("words"),
            }
    return out


def _describe_verse(
    out: dict[str, Any], item: Item, interval: Mapping[str, Any], ctx: Context
) -> None:
    if item.ref is None:
        return
    try:
        ref = VerseRef.parse(item.ref)
    except ValueError:
        return
    total = ctx.passages.word_count(ref)
    out["words_total"] = total
    if item.words is not None:
        out["tokens"] = ctx.passages.words_with_signs(ref, *item.words)
    if item.type == "cut":
        out["verse_tokens"] = ctx.passages.words_with_signs(ref, 1, total)


# --- contrôle de préparation -----------------------------------------------------------------


def _count_types(items: Sequence[Item]) -> dict[str, dict[str, int]]:
    counts: dict[str, dict[str, int]] = {}
    for item in items:
        slot = counts.setdefault(item.type, {"total": 0, "open": 0})
        slot["total"] += 1
        slot["open"] += item.state == "open"
    return counts


def readiness_payload(
    inputs: Inputs,
    analysis: Analysis,
    ctx: Context,
    *,
    page: int = 0,
    size: int = PAGE_SIZE,
    type_filter: str | None = None,
    state_filter: str | None = None,
) -> dict[str, Any]:
    counted = analysis.counted
    unresolved = analysis.unresolved
    arabic_open = [
        i
        for i in unresolved
        if i.impact.startswith("arabic") or i.type in ("inferred", "cut", "report")
    ]
    selected = [
        i
        for i in counted
        if type_filter in (None, "", i.type) and state_filter in (None, "", i.state)
    ]
    size = max(0, min(size, 50))
    pages = 0 if size == 0 else max(1, -(-len(selected) // size))
    window = selected[page * size : (page + 1) * size] if size else []
    ineffective = [i for i in analysis.items if not i.effective]
    first_open_at = next((n for n, i in enumerate(selected) if i.state == "open"), None)
    first_open = None if first_open_at is None else selected[first_open_at].key
    return {
        "schema": READINESS_SCHEMA,
        "prediction_sha256": inputs.prediction_sha256,
        "decisions_sha256": analysis.decisions_sha256,
        "options": {"content": ctx.options.content, "show_ref": ctx.options.show_ref},
        "verdict": {
            "total": len(counted),
            "resolved": len(counted) - len(unresolved),
            "unresolved": len(unresolved),
            "ready": not unresolved,
            "arabic": len(arabic_open),
            "other": len(unresolved) - len(arabic_open),
        },
        "counts": _count_types(counted),
        "verses": sum(1 for i in analysis.intervals if i.get("kind") == "verse"),
        "non_quran": {
            "abstentions": analysis.abstentions,
            "formulas": analysis.formulas,
            "items": _non_quran_items(analysis),
        },
        "page": {"index": page, "size": size, "total": len(selected), "pages": pages},
        "items": [item_json(i, analysis, ctx) for i in window],
        "first_open": first_open,
        "first_open_page": (None if first_open_at is None or size == 0 else first_open_at // size),
        "ineffective": {
            "total": len(ineffective),
            "items": [
                item_json(i, analysis, ctx, detailed=False) for i in ineffective[:INEFFECTIVE_LIMIT]
            ],
        },
        "orphans": [
            {**decision_json(d), "reason": "Ce passage n'existe plus tel quel dans l'analyse."}
            for d in analysis.orphans
        ],
        "warnings": list(analysis.warnings),
    }


NON_QURAN_LIST_LIMIT: Final = 100


def _non_quran_items(analysis: Analysis) -> list[dict[str, Any]]:
    """Les passages non coraniques (abstentions, formules) : à voir, jamais à corriger (I4)."""
    out: list[dict[str, Any]] = []
    for interval in analysis.intervals:
        kind = interval.get("kind")
        if kind not in ("abstention", "non_quran") or interval.get("t") is None:
            continue
        out.append(
            {
                "kind": "abstention" if kind == "abstention" else "formula",
                "label": interval.get("reason") if kind == "abstention" else interval.get("label"),
                "t": list(interval["t"]),
            }
        )
        if len(out) >= NON_QURAN_LIST_LIMIT:
            break
    return out


def run_readiness(
    inputs: Inputs,
    options: ExportOptions,
    env: Environment,
    blocking_tags: frozenset[str] = frozenset(),
    *,
    page: int = 0,
    size: int = PAGE_SIZE,
    type_filter: str | None = None,
    state_filter: str | None = None,
) -> dict[str, Any]:
    ctx = build_context(options, env, blocking_tags)
    analysis = analyze(inputs.document, inputs.decisions, inputs.notes, ctx)
    return readiness_payload(
        inputs,
        analysis,
        ctx,
        page=page,
        size=size,
        type_filter=type_filter,
        state_filter=state_filter,
    )


# --- export ----------------------------------------------------------------------------------


def attribution(view: View, options: ExportOptions) -> list[str]:
    """Ce qu'il faut créditer avec la vidéo : le texte coranique et la traduction utilisés."""
    lines: list[str] = []
    verses = [e for e in view.entries if e.kind == "verse"]
    if options.with_arabic and verses:
        lines.append(TANZIL_CREDIT)
    if options.with_translation:
        seen: list[str] = []
        for entry in verses:
            credit = (entry.translation or {}).get("attribution")
            if isinstance(credit, str) and credit not in seen:
                seen.append(credit)
        for credit in seen:
            if options.strip_notes:
                lines.append(f"Traduction : {credit}. Renvois de note retirés.")
            else:
                lines.append(f"Traduction : {credit}, non modifiée.")
    return lines


def _review_block(analysis: Analysis, view: View) -> dict[str, Any]:
    return {
        "schema": "aqr.decisions/1",
        "decisions_sha256": analysis.decisions_sha256,
        "applied": view.applied,
        "unresolved": view.unresolved,
        "ignored": view.ignored,
        "orphans": len(analysis.orphans),
        "forced": view.forced,
        "policy": view.policy,
    }


def build_export_json(
    document: Mapping[str, Any], analysis: Analysis, view: View
) -> dict[str, Any]:
    """La prédiction recopiée telle quelle, plus un bloc `review` et, pour chaque passage décidé,
    un champ `resolved` : le `status` du moteur n'est jamais réécrit (ADR-0014)."""
    out: dict[str, Any] = {"schema": document["schema"], "review": _review_block(analysis, view)}
    for key, value in document.items():
        if key == "schema":
            continue
        if key != "intervals":
            out[key] = copy.deepcopy(value)
            continue
        intervals: list[Any] = []
        for index, interval in enumerate(value):
            item = copy.deepcopy(interval)
            decisions = [d for d in analysis.applied.get(index, ()) if d.kind != "ignore"]
            if decisions:
                item["resolved"] = _resolved_json(decisions, view, index)
            intervals.append(item)
        out["intervals"] = intervals
    if view.added:
        out["review"]["added"] = [
            {
                "by": "human",
                "decision_ids": list(e.decision_ids),
                "ref": e.ref,
                "words": None if e.words is None else list(e.words),
                "t": [e.start_s, e.end_s],
                "text": " ".join(e.arabic_words),
                "translation": copy.deepcopy(dict(e.translation)) if e.translation else None,
            }
            for e in view.added
        ]
    return out


def _resolved_json(decisions: Sequence[Decision], view: View, index: int) -> dict[str, Any]:
    ids = [d.id for d in decisions]
    excluded = next(
        (o for o in view.omissions if o.index == index and o.reason == "excluded"), None
    )
    if excluded is not None:
        return {"by": "human", "decision_ids": ids, "excluded": excluded.detail}
    entry = view.resolved_entries.get(index)
    if entry is None:
        return {"by": "human", "decision_ids": ids}
    return {
        "by": "human",
        "decision_ids": ids,
        "ref": entry.ref,
        "words": None if entry.words is None else list(entry.words),
        "t": [entry.start_s, entry.end_s],
        "text": " ".join(entry.arabic_words),
        "translation": copy.deepcopy(dict(entry.translation)) if entry.translation else None,
    }


@dataclass(frozen=True)
class ExportResult:
    content: str
    summary: dict[str, Any]
    cues: CueBuild


def _render(inputs: Inputs, analysis: Analysis, view: View, build: CueBuild, ctx: Context) -> str:
    options = ctx.options
    note = "\n".join(attribution(view, options)) or None
    if options.format == "srt":
        return write_srt(build.cues, rtl=options.rtl)
    if options.format == "vtt":
        return write_vtt(build.cues, rtl=options.rtl, note=note)
    if options.format == "ass":
        return write_ass(build.cues, font=options.font, karaoke=options.karaoke, note=note)
    return (
        json.dumps(build_export_json(inputs.document, analysis, view), ensure_ascii=False, indent=1)
        + "\n"
    )


def run_export(
    inputs: Inputs,
    options: ExportOptions,
    env: Environment,
    blocking_tags: frozenset[str] = frozenset(),
    *,
    preview: int | None = None,
) -> ExportResult:
    """Rend le fichier et son résumé. Sans `allow_unresolved`, des passages ambigus non résolus
    l'interdisent (`ExportBlocked`) ; l'aperçu, lui, se calcule toujours (il montre ce que l'export
    forcé ferait) et indique `would_block`."""
    ctx = build_context(options, env, blocking_tags)
    analysis = analyze(inputs.document, inputs.decisions, inputs.notes, ctx)
    would_block = bool(analysis.unresolved) and not options.allow_unresolved
    if would_block and preview is None:
        raise ExportBlocked(len(analysis.unresolved))
    view = build_view(inputs.document, analysis, ctx)
    build = build_cues(view.entries, ctx)
    content = _render(inputs, analysis, view, build, ctx)
    summary: dict[str, Any] = {
        "schema": RESULT_SCHEMA,
        "format": options.format,
        "cues": len(build.cues),
        "split": build.split,
        "omitted": [
            {
                "index": o.index,
                "type": o.type,
                "t": list(o.t),
                "ref": o.ref,
                "reason": o.reason,
                "detail": o.detail,
                "key": _item_key(analysis, o),
            }
            for o in view.omissions
        ][:200],
        "omitted_total": len(view.omissions),
        "applied": view.applied,
        "unresolved": view.unresolved,
        "ignored": view.ignored,
        "orphans": len(analysis.orphans),
        "forced": view.forced,
        "policy": view.policy,
        "decisions_sha256": analysis.decisions_sha256,
        "prediction_sha256": inputs.prediction_sha256,
        "bytes": len(content.encode("utf-8")),
        "attribution": attribution(view, options),
        "warnings": [*view.warnings, *build.warnings],
    }
    if preview is not None:
        summary["would_block"] = would_block
        summary["preview"] = {
            "cues": preview_json(build.cues, preview),
            "words_timed": [bool(c.words) for c in build.cues[:preview]],
            "head": content[:1500],
        }
    return ExportResult(content, summary, build)


def _item_key(analysis: Analysis, omission: Omission) -> str | None:
    """La clé du passage à vérifier (celle du contrôle) d'un passage omis : lien « Le corriger »."""
    if omission.index is None or omission.type not in ("uncertain", "inferred"):
        return None
    return f"{interval_fingerprint(analysis.intervals[omission.index])}#{omission.type}"


def corpus_verse(
    ref_text: str, words: tuple[int, int] | None, options: ExportOptions, env: Environment
) -> dict[str, Any]:
    """Un verset (ou une plage de mots) lu dans le corpus, pour l'écran de correction : jamais un
    texte venu d'un modèle (I1). Une référence inexistante n'est pas une erreur du programme."""
    ctx = build_context(options, env)
    try:
        ref = VerseRef.parse(ref_text)
    except (ValueError, TypeError):
        return {"ok": False, "error": "Ce verset n'existe pas."}
    total = ctx.passages.word_count(ref)
    rng = ctx.passages.clip(ref, *(words or (1, total)))
    if rng is None:
        return {"ok": False, "error": "Cette plage de mots n'existe pas dans ce verset."}
    translation, scope = _preview_text(ctx, ref, rng)
    return {
        "ok": True,
        "ref": str(ref),
        "words": list(rng),
        "words_total": total,
        "tokens": ctx.passages.words_with_signs(ref, *rng),
        "verse_tokens": ctx.passages.words_with_signs(ref, 1, total),
        "translation": translation,
        "translation_scope": scope,
    }
