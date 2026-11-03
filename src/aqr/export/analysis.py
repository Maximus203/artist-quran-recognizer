"""Quels passages de la partie coranique sont ambigus, et où en sont leurs décisions.

Règles de `docs/design/export-sous-titres.md` §3 : seuls comptent les intervalles `verse` et les
signalements de revue confirmés ; les abstentions et les formules ne sont jamais obligatoires (I4).
L'ambiguïté dépend de ce qu'on exporte (§3.1) : on compare les candidats d'un `uncertain` dans le
corpus et on ne bloque que si la différence se verrait dans le fichier. Les seuils (écart maximal
entre deux intervalles) viennent de la configuration du décodeur écrite dans le JSON, jamais d'une
valeur en dur.

Rien ici ne modifie la prédiction ni ne fabrique de texte : le corpus se lit, la traduction vient
de QuranEnc (I1, I2).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any, Final

from aqr.decisions import (
    Decision,
    DecisionsDocument,
    active_decisions,
    decisions_digest,
    interval_fingerprint,
    reconcile,
    target_key,
)
from aqr.domain.models import VerseRef
from aqr.export.options import ExportOptions
from aqr.export.texts import TranslationSource, translation_text
from aqr.rendering.passages import Passages

ITEM_TYPES: Final = ("uncertain", "inferred", "cut", "approx", "report")
MAX_CANDIDATES: Final = 8
"""Candidats détaillés pour un passage incertain (l'écran de correction en montre autant)."""

_RANK = {"same": 0, "sign": 1, "letters": 2}


@dataclass(frozen=True)
class ReviewNote:
    """Un signalement de revue confirmé, réduit à ce que le contrôle lit."""

    id: str
    start_s: float
    end_s: float
    tags: tuple[str, ...]
    tester: str
    description: str
    expected_ref: str | None


def read_review(raw: Mapping[str, Any] | None) -> list[ReviewNote]:
    """Les signalements **confirmés** d'une revue `aqr.review/2` ; un brouillon ne compte pas."""
    if not raw:
        return []
    notes: list[ReviewNote] = []
    for item in raw.get("annotations") or []:
        if not isinstance(item, Mapping) or item.get("status") != "confirmed":
            continue
        start = float(item.get("start_s") or 0.0)
        end = item.get("end_s")
        notes.append(
            ReviewNote(
                id=str(item.get("id")),
                start_s=start,
                end_s=start if end is None else float(end),
                tags=tuple(str(t) for t in item.get("tags") or []),
                tester=str(item.get("tester") or ""),
                description=str(item.get("description") or "")[:300],
                expected_ref=item.get("expected_ref"),
            )
        )
    return notes


@dataclass(frozen=True)
class Context:
    passages: Passages
    options: ExportOptions
    translations: TranslationSource | None = None
    blocking_tags: frozenset[str] = field(default_factory=frozenset)
    """Étiquettes de revue qui bloquent l'export (propriété `blocksExport` des puces de
    l'atelier)."""


@dataclass(frozen=True)
class Item:
    """Un passage à vérifier."""

    key: str
    type: str
    index: int | None
    fingerprint: str | None
    t: tuple[float, float]
    ref: str | None
    words: tuple[int, int] | None
    impact: str
    """`arabic` · `arabic_sign` · `translation` · `reference` : ce qui changerait dans le
    fichier."""
    effective: bool
    """Compte dans le contrôle avec les réglages d'export actuels."""
    decision: Decision | None = None
    review_ids: tuple[str, ...] = ()
    related_reports: tuple[str, ...] = ()
    details: Mapping[str, Any] = field(default_factory=dict)

    @property
    def state(self) -> str:
        if self.decision is None:
            return "open"
        return "ignored" if self.decision.kind == "ignore" else "resolved"


@dataclass(frozen=True)
class Analysis:
    intervals: Sequence[Mapping[str, Any]]
    items: tuple[Item, ...]
    applied: Mapping[int, tuple[Decision, ...]]
    report_decisions: tuple[Decision, ...]
    orphans: tuple[Decision, ...]
    decisions_sha256: str
    abstentions: int
    formulas: int
    warnings: tuple[str, ...]

    @property
    def counted(self) -> tuple[Item, ...]:
        return tuple(i for i in self.items if i.effective)

    @property
    def unresolved(self) -> tuple[Item, ...]:
        return tuple(i for i in self.counted if i.state == "open")

    @property
    def ignored(self) -> tuple[Item, ...]:
        return tuple(i for i in self.counted if i.state == "ignored")


# --- passages incertains ---------------------------------------------------------------------


def candidate_passages(
    interval: Mapping[str, Any], passages: Passages
) -> list[tuple[VerseRef, tuple[int, int] | None]]:
    """Chaque candidat d'un `uncertain` avec la plage de mots du moteur ramenée à ses mots."""
    words = interval.get("words")
    out: list[tuple[VerseRef, tuple[int, int] | None]] = []
    for text in interval.get("candidates") or []:
        try:
            ref = VerseRef.parse(str(text))
        except ValueError:
            continue
        first, last = (1, passages.word_count(ref)) if words is None else (words[0], words[1])
        out.append((ref, passages.clip(ref, first, last)))
    return out


def _shown_translation(ctx: Context, ref: VerseRef, words: tuple[int, int] | None) -> str | None:
    if ctx.translations is None or words is None:
        return None
    partial = words != (1, ctx.passages.word_count(ref))
    found = ctx.translations.passage(ref, words if partial else None)
    return translation_text(found, strip_notes=ctx.options.strip_notes)


def _uncertain_impact(interval: Mapping[str, Any], ctx: Context) -> tuple[str, bool]:
    options = ctx.options
    found = candidate_passages(interval, ctx.passages)
    texts = [ctx.passages.text(r, *rng) if rng else "" for r, rng in found]
    worst = "same"
    for other in texts[1:]:
        verdict = ctx.passages.compare(texts[0], other)
        if _RANK[verdict] > _RANK[worst]:
            worst = verdict
    translation_differs: bool | None = False
    if options.with_translation or worst == "same":
        shown = [_shown_translation(ctx, r, rng) for r, rng in found]
        # inconnu (None) : par prudence (I3), on le compte comme différent
        translation_differs = None if any(s is None for s in shown) else len(set(shown)) > 1
    if worst == "letters":
        impact = "arabic"
    elif worst == "sign":
        impact = "arabic_sign"
    elif translation_differs is not False:
        impact = "translation"
    else:
        impact = "reference"
    effective = (
        (options.with_arabic and worst != "same")
        or (options.with_translation and translation_differs is not False)
        or options.show_ref
    )
    return impact, effective


# --- coupures --------------------------------------------------------------------------------


def _neighbour(
    intervals: Sequence[Mapping[str, Any]], index: int, step: int
) -> Mapping[str, Any] | None:
    """L'intervalle voisin, sans compter les versets supposés (jamais entendus)."""
    j = index + step
    while 0 <= j < len(intervals):
        candidate = intervals[j]
        if not (candidate.get("kind") == "verse" and candidate.get("status") == "inferred"):
            return candidate
        j += step
    return None


def _explains_missing_words(
    current: Mapping[str, Any], other: Mapping[str, Any] | None, after: bool, max_gap: float
) -> bool:
    """Le voisin proche explique-t-il que des mots manquent (le lecteur n'a pas dû s'arrêter là) ?

    Une abstention (sauf le silence), un passage incertain ou le verset d'à côté : des mots ont
    été dits sans être reconnus ou ont été rattachés ailleurs. Un silence, un autre passage
    éloigné ou la fin du fichier : le lecteur s'est arrêté, ce n'est pas une coupure."""
    if other is None or other.get("t") is None or current.get("t") is None:
        return False
    gap = (other["t"][0] - current["t"][1]) if after else (current["t"][0] - other["t"][1])
    if gap > max_gap:
        return False
    kind = other.get("kind")
    if kind == "abstention":
        return other.get("reason") != "silence"
    if kind != "verse":
        return False
    if other.get("status") == "uncertain":
        return True
    try:
        here, there = VerseRef.parse(str(current["ref"])), VerseRef.parse(str(other["ref"]))
    except (ValueError, KeyError):
        return False
    return there == here.next() if after else here == there.next()


def _cut_sides(
    intervals: Sequence[Mapping[str, Any]],
    index: int,
    passages: Passages,
    max_gap: float,
) -> list[str]:
    interval = intervals[index]
    if interval.get("status") != "recognized" or interval.get("repetition"):
        return []
    try:
        ref = VerseRef.parse(str(interval["ref"]))
        first, last = interval["words"]
    except (ValueError, KeyError, TypeError):
        return []
    sides: list[str] = []
    if last < passages.word_count(ref) and _explains_missing_words(
        interval, _neighbour(intervals, index, +1), True, max_gap
    ):
        sides.append("end")
    if first > passages.first_content_word(ref) and _explains_missing_words(
        interval, _neighbour(intervals, index, -1), False, max_gap
    ):
        sides.append("start")
    return sides


def _approximate_translation(interval: Mapping[str, Any]) -> bool:
    translation = interval.get("translation")
    if not isinstance(translation, Mapping) or translation.get("scope") != "fragment":
        return False
    fragment = translation.get("fragment")
    return isinstance(fragment, Mapping) and fragment.get("approximate") is True


# --- signalements de revue -------------------------------------------------------------------


def _overlap(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Durée commune de deux plages ; deux bornes égales (un point) comptent comme un contact."""
    low, high = max(a[0], b[0]), min(a[1], b[1])
    if high > low:
        return high - low
    return 1e-9 if high == low and (a[0] == a[1] or b[0] == b[1]) else 0.0


def _interval_span(interval: Mapping[str, Any]) -> tuple[float, float] | None:
    t = interval.get("t")
    return None if t is None else (float(t[0]), float(t[1]))


# --- l'analyse -------------------------------------------------------------------------------


def analyze(
    document: Mapping[str, Any],
    decisions: DecisionsDocument | None,
    notes: Sequence[ReviewNote],
    ctx: Context,
) -> Analysis:
    intervals: Sequence[Mapping[str, Any]] = document.get("intervals") or []
    active = active_decisions(decisions) if decisions is not None else ()
    reconciled = reconcile(intervals, active)
    # Une décision posée sur des signalements dont plus aucun n'est confirmé ne vise plus rien.
    known = {n.id for n in notes}
    live_reports = tuple(d for d in reconciled.reports if set(d.target.review_ids) & known)
    orphans = (
        *reconciled.orphans,
        *(d for d in reconciled.reports if d not in live_reports),
    )
    by_key = {target_key(d): d for d in active if d not in orphans}
    warnings: list[str] = []
    max_gap = (document.get("decoder") or {}).get("merge_max_gap_s")
    if not isinstance(max_gap, int | float):
        max_gap = None
        warnings.append("merge_max_gap_s absent du JSON : les coupures ne sont pas détectées")

    items: list[Item] = []
    for index, interval in enumerate(intervals):
        if interval.get("kind") != "verse" or _interval_span(interval) is None:
            continue
        fingerprint = interval_fingerprint(interval)
        t = _interval_span(interval)
        assert t is not None
        words = tuple(interval["words"]) if interval.get("words") else None
        base: dict[str, Any] = {
            "index": index,
            "fingerprint": fingerprint,
            "t": t,
            "ref": interval.get("ref"),
            "words": words,
        }
        status = interval.get("status")
        if status == "uncertain":
            impact, effective = _uncertain_impact(interval, ctx)
            key = f"{fingerprint}#uncertain"
            items.append(
                Item(
                    key=key,
                    type="uncertain",
                    impact=impact,
                    effective=effective,
                    decision=by_key.get(key),
                    details={"candidates": list(interval.get("candidates") or [])},
                    **base,
                )
            )
        elif status == "inferred":
            key = f"{fingerprint}#inferred"
            items.append(
                Item(
                    key=key,
                    type="inferred",
                    impact="arabic",
                    effective=True,
                    decision=by_key.get(key),
                    **base,
                )
            )
        if max_gap is not None:
            sides = _cut_sides(intervals, index, ctx.passages, float(max_gap))
            if sides:
                key = f"{fingerprint}#cut"
                items.append(
                    Item(
                        key=key,
                        type="cut",
                        impact="arabic",
                        effective=True,
                        decision=by_key.get(key),
                        details={"sides": sides},
                        **base,
                    )
                )
        if _approximate_translation(interval):
            key = f"{fingerprint}#approx"
            fragment = interval["translation"]["fragment"]
            items.append(
                Item(
                    key=key,
                    type="approx",
                    impact="translation",
                    effective=ctx.options.with_translation,
                    decision=by_key.get(key),
                    details={"fragment_words": list(fragment.get("words") or [])},
                    **base,
                )
            )

    items = _with_reports(items, intervals, notes, by_key, ctx)
    items.sort(key=lambda i: (i.t[0], i.t[1], ITEM_TYPES.index(i.type)))
    abstentions = sum(1 for i in intervals if i.get("kind") == "abstention")
    formulas = sum(1 for i in intervals if i.get("kind") == "non_quran")
    return Analysis(
        intervals=intervals,
        items=tuple(items),
        applied=reconciled.applied,
        report_decisions=live_reports,
        orphans=orphans,
        decisions_sha256=decisions_digest(active),
        abstentions=abstentions,
        formulas=formulas,
        warnings=tuple(warnings),
    )


def _with_reports(
    items: list[Item],
    intervals: Sequence[Mapping[str, Any]],
    notes: Sequence[ReviewNote],
    by_key: Mapping[str, Decision],
    ctx: Context,
) -> list[Item]:
    """Ajoute les signalements bloquants. Un signalement posé sur un passage déjà à vérifier lui
    est rattaché (un seul passage, un seul décompte) ; sinon il devient un passage à vérifier,
    regroupé par verset du moteur qu'il touche, ou seul s'il ne touche aucun verset."""
    blocking = [n for n in notes if set(n.tags) & ctx.blocking_tags]
    if not blocking:
        return items
    attached: dict[str, list[str]] = {}
    grouped: dict[int, list[ReviewNote]] = {}
    alone: list[ReviewNote] = []
    for note in blocking:
        span = (note.start_s, note.end_s)
        host = next((i for i in items if _overlap(i.t, span) > 0), None)
        if host is not None:
            attached.setdefault(host.key, []).append(note.id)
            continue
        best_index, best = None, 0.0
        for index, interval in enumerate(intervals):
            if interval.get("kind") != "verse":
                continue
            interval_span = _interval_span(interval)
            if interval_span is not None and (overlap := _overlap(interval_span, span)) > best:
                best_index, best = index, overlap
        if best_index is None:
            alone.append(note)
        else:
            grouped.setdefault(best_index, []).append(note)
    out = [
        replace(i, related_reports=tuple(attached[i.key])) if i.key in attached else i
        for i in items
    ]
    for index, group in grouped.items():
        interval = intervals[index]
        fingerprint = interval_fingerprint(interval)
        ids = tuple(sorted(n.id for n in group))
        key = f"{fingerprint}#report"
        decision = by_key.get(key)
        if decision is not None and not set(ids) <= set(decision.target.review_ids):
            decision = None  # un signalement est arrivé après la décision : le passage se rouvre
        t = _interval_span(interval)
        assert t is not None
        out.append(
            Item(
                key=key,
                type="report",
                index=index,
                fingerprint=fingerprint,
                t=t,
                ref=interval.get("ref"),
                words=tuple(interval["words"]) if interval.get("words") else None,
                impact="arabic",
                effective=True,
                decision=decision,
                review_ids=ids,
                details={"notes": [_note_json(n) for n in group]},
            )
        )
    for note in alone:
        key = f"report:{note.id}#report"
        out.append(
            Item(
                key=key,
                type="report",
                index=None,
                fingerprint=None,
                t=(note.start_s, max(note.end_s, note.start_s)),
                ref=note.expected_ref,
                words=None,
                impact="arabic",
                effective=True,
                decision=by_key.get(key),
                review_ids=(note.id,),
                details={"notes": [_note_json(note)]},
            )
        )
    return out


def _note_json(note: ReviewNote) -> dict[str, Any]:
    return {
        "id": note.id,
        "tester": note.tester,
        "tags": list(note.tags),
        "description": note.description,
        "expected_ref": note.expected_ref,
        "t": [note.start_s, note.end_s],
    }
