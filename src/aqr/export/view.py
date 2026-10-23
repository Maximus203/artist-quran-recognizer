"""La vue fusionnée : ce que le moteur a dit, plus les décisions humaines, selon la politique
d'export.

Aucune écriture dans la prédiction : on lit ses intervalles et on produit la liste de ce qui sera
écrit (`Entry`) et de ce qui ne le sera pas (`Omission`, avec la raison). Le texte arabe d'une
entrée vient toujours du corpus (I1) ; sa traduction est celle de QuranEnc, telle que le moteur
l'a livrée ou telle que le dépôt de traductions la rend (I2).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any

from aqr.decisions import Decision
from aqr.domain.models import NonQuranKind, VerseRef
from aqr.export.analysis import Analysis, Context, Item, candidate_passages
from aqr.export.options import FORMULAS
from aqr.rendering.formula_labels import FORMULA_LABELS_AR
from aqr.rendering.passages import Passages

BASMALA_REF = VerseRef(1, 1)


@dataclass(frozen=True)
class Entry:
    """Une ligne de sous-titre à écrire (avant découpe, durée minimale et décalage)."""

    index: int | None
    start_s: float
    end_s: float
    kind: str
    """`verse` (texte du Mushaf), ou `note` (repère : formule, marqueur d'un passage incertain)."""
    ref: str | None = None
    words: tuple[int, int] | None = None
    arabic_words: tuple[str, ...] = ()
    label: str | None = None
    prefix: str | None = None
    translation: Mapping[str, Any] | None = None
    scope: str | None = None
    word_times: tuple[tuple[float, float], ...] | None = None
    measured: bool = False
    """Les temps des mots viennent de l'alignement forcé et n'ont pas été touchés : karaoké
    permis."""
    repetition: bool = False
    origin: str = "engine"
    decision_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class Omission:
    index: int | None
    type: str
    t: tuple[float, float]
    ref: str | None
    reason: str
    """`uncertain` · `inferred` · `excluded` (décision humaine) · `no_text` (plage sans mot)."""
    detail: str | None = None


@dataclass(frozen=True)
class View:
    entries: tuple[Entry, ...]
    omissions: tuple[Omission, ...]
    applied: int
    unresolved: int
    ignored: int
    forced: bool
    policy: str
    warnings: tuple[str, ...] = field(default_factory=tuple)
    resolved_entries: Mapping[int, Entry] = field(default_factory=dict)
    """Intervalle du moteur -> entrée issue d'une décision humaine (pour la sortie JSON)."""
    added: tuple[Entry, ...] = ()
    """Passages posés par un humain là où le moteur n'avait rien reconnu."""


@dataclass(frozen=True)
class _Composed:
    ref: str | None = None
    words: tuple[int, int] | None = None
    t: tuple[float, float] | None = None
    excluded: str | None = None
    scope: str | None = None
    confirmed: bool = False
    changed_content: bool = False
    ids: tuple[str, ...] = ()


def _compose(decisions: Sequence[Decision]) -> _Composed:
    """Plusieurs décisions sur un intervalle (une par sorte de passage) : les plus récentes
    l'emportent."""
    out = _Composed()
    for d in sorted(decisions, key=lambda d: (d.decided_at, d.id)):
        v = d.value
        if d.kind in ("choose", "set_ref"):
            out = replace(
                out, ref=v.ref, words=v.words, t=v.t or out.t, confirmed=True, changed_content=True
            )
        elif d.kind == "confirm_inferred":
            out = replace(out, confirmed=True, t=v.t or out.t)
        elif d.kind == "confirm_partial":
            out = replace(out, confirmed=True)
        elif d.kind == "adjust_time":
            out = replace(out, t=v.t, changed_content=True)
        elif d.kind == "exclude":
            out = replace(out, excluded=v.reason)
        elif d.kind == "translation_scope":
            out = replace(out, scope=v.scope)
    return replace(out, ids=tuple(d.id for d in decisions if d.kind != "ignore"))


def _engine_words(
    interval: Mapping[str, Any], passages: Passages, ref: VerseRef
) -> tuple[int, int]:
    words = interval.get("words")
    if words:
        return (int(words[0]), int(words[1]))
    return (1, passages.word_count(ref))


def _translation_of(
    ctx: Context,
    interval: Mapping[str, Any] | None,
    ref: VerseRef,
    words: tuple[int, int],
    *,
    same_as_engine: bool,
    warnings: list[str],
) -> Mapping[str, Any] | None:
    if not ctx.options.with_translation:
        return None
    if same_as_engine and interval is not None:
        given = interval.get("translation")
        if isinstance(given, Mapping) and given.get("translation_id") == ctx.options.translation_id:
            return given
    if ctx.translations is not None:
        partial = words != (1, ctx.passages.word_count(ref))
        found = ctx.translations.passage(ref, words if partial else None)
        if found is not None:
            return found
    note = f"traduction indisponible pour {ref}"
    if note not in warnings:
        warnings.append(note)
    return None


def _entry(
    ctx: Context,
    interval: Mapping[str, Any] | None,
    index: int | None,
    ref: VerseRef,
    words: tuple[int, int],
    t: tuple[float, float],
    warnings: list[str],
    *,
    same_as_engine: bool,
    scope: str | None = None,
    prefix: str | None = None,
    origin: str = "engine",
    ids: tuple[str, ...] = (),
    repetition: bool = False,
) -> Entry | None:
    rng = ctx.passages.clip(ref, *words)
    arabic = ctx.passages.words_with_signs(ref, *rng) if rng else []
    if rng is None or not arabic:
        return None
    times: tuple[tuple[float, float], ...] | None = None
    measured = False
    if interval is not None and same_as_engine and t == _span_of(interval):
        raw = interval.get("word_times")
        if (
            isinstance(raw, list)
            and len(raw) == len(arabic)
            and interval.get("word_times_source") == "ctc-alignment"
        ):
            times = tuple((float(a), float(b)) for a, b in raw)
            measured = True
    return Entry(
        index=index,
        start_s=t[0],
        end_s=t[1],
        kind="verse",
        ref=str(ref),
        words=rng,
        arabic_words=tuple(arabic),
        prefix=prefix,
        translation=_translation_of(
            ctx, interval, ref, rng, same_as_engine=same_as_engine, warnings=warnings
        ),
        scope=scope,
        word_times=times,
        measured=measured,
        repetition=repetition,
        origin=origin,
        decision_ids=ids,
    )


def _span_of(interval: Mapping[str, Any]) -> tuple[float, float] | None:
    t = interval.get("t")
    return None if t is None else (float(t[0]), float(t[1]))


def _index_items(analysis: Analysis) -> dict[tuple[int, str], Item]:
    return {(i.index, i.type): i for i in analysis.items if i.index is not None}


def build_view(document: Mapping[str, Any], analysis: Analysis, ctx: Context) -> View:
    options = ctx.options
    items = _index_items(analysis)
    unresolved = analysis.unresolved
    forced = bool(unresolved) and options.allow_unresolved
    entries: list[Entry] = []
    omissions: list[Omission] = []
    resolved: dict[int, Entry] = {}
    warnings: list[str] = list(analysis.warnings)

    for index, interval in enumerate(analysis.intervals):
        kind = interval.get("kind")
        t = _span_of(interval)
        if t is None:
            continue
        if kind == "non_quran":
            entry = _formula_entry(ctx, interval, index, t, warnings)
            if entry is not None:
                entries.append(entry)
            continue
        if kind != "verse" or not interval.get("ref"):
            continue
        composed = _compose(analysis.applied.get(index, ()))
        status = interval.get("status")
        ref_text = str(interval["ref"])
        item_type = {"uncertain": "uncertain", "inferred": "inferred"}.get(str(status))
        item = items.get((index, item_type)) if item_type else None
        if composed.excluded is not None:
            omissions.append(
                Omission(index, item_type or "verse", t, ref_text, "excluded", composed.excluded)
            )
            continue
        ids = composed.ids
        final_t = composed.t or t
        if status == "uncertain" and composed.ref is None:
            made = _unresolved_uncertain(ctx, interval, index, t, item, warnings)
            if isinstance(made, Omission):
                omissions.append(made)
            elif made is not None:
                entries.append(made)
            continue
        if status == "inferred" and not composed.confirmed:
            made = _unresolved_inferred(ctx, interval, index, t, warnings)
            if isinstance(made, Omission):
                omissions.append(made)
            elif made is not None:
                entries.append(made)
            continue
        if composed.ref is not None and composed.words is not None:
            ref, words = VerseRef.parse(composed.ref), composed.words
            same = False
        else:
            ref = VerseRef.parse(ref_text)
            words = _engine_words(interval, ctx.passages, ref)
            same = True
        entry = _entry(
            ctx,
            interval,
            index,
            ref,
            words,
            final_t,
            warnings,
            same_as_engine=same and status != "uncertain",
            scope=composed.scope,
            origin="human" if ids else "engine",
            ids=ids,
            repetition=bool(interval.get("repetition")),
        )
        if entry is None:
            omissions.append(Omission(index, "verse", t, ref_text, "no_text"))
            continue
        entries.append(entry)
        if ids:
            resolved[index] = entry

    added = _added_passages(analysis, ctx, warnings)
    entries.extend(added)
    entries.sort(key=lambda e: (e.start_s, e.end_s))
    applied = sum(
        1 for decisions in analysis.applied.values() for d in decisions if d.kind != "ignore"
    ) + sum(1 for d in analysis.report_decisions if d.kind != "ignore")
    return View(
        entries=tuple(entries),
        omissions=tuple(omissions),
        applied=applied,
        unresolved=len(unresolved),
        ignored=len(analysis.ignored),
        forced=forced,
        policy=options.policy,
        warnings=tuple(warnings),
        resolved_entries=resolved,
        added=tuple(added),
    )


def _unresolved_uncertain(
    ctx: Context,
    interval: Mapping[str, Any],
    index: int,
    t: tuple[float, float],
    item: Item | None,
    warnings: list[str],
) -> Entry | Omission | None:
    """Un passage incertain que personne n'a tranché. Si le choix ne changerait rien au fichier, on
    écrit le texte commun ; sinon la politique décide (I3 : par défaut, ne rien nommer)."""
    found = candidate_passages(interval, ctx.passages)
    candidates = [str(c) for c in interval.get("candidates") or []]
    if item is not None and not item.effective:
        ref, rng = found[0]
        if rng is None:
            return Omission(index, "uncertain", t, None, "no_text")
        return _entry(ctx, None, index, ref, rng, t, warnings, same_as_engine=False)
    policy = ctx.options.policy
    if policy == "marker":
        return Entry(
            index=index,
            start_s=t[0],
            end_s=t[1],
            kind="note",
            label="[incertain : " + " | ".join(candidates) + "]",
        )
    if policy == "first" and found:
        ref, rng = found[0]
        if rng is not None:
            return _entry(ctx, None, index, ref, rng, t, warnings, same_as_engine=False)
    return Omission(index, "uncertain", t, None, "uncertain", " | ".join(candidates))


def _unresolved_inferred(
    ctx: Context,
    interval: Mapping[str, Any],
    index: int,
    t: tuple[float, float],
    warnings: list[str],
) -> Entry | Omission | None:
    """Un verset supposé n'a jamais été entendu : omis par défaut ; `[déduit]` avec les autres
    politiques."""
    ref_text = str(interval["ref"])
    if ctx.options.policy == "omit":
        return Omission(index, "inferred", t, ref_text, "inferred")
    ref = VerseRef.parse(ref_text)
    entry = _entry(
        ctx,
        interval,
        index,
        ref,
        _engine_words(interval, ctx.passages, ref),
        t,
        warnings,
        same_as_engine=True,
        prefix="[déduit]",
    )
    return entry or Omission(index, "inferred", t, ref_text, "no_text")


def _formula_entry(
    ctx: Context,
    interval: Mapping[str, Any],
    index: int,
    t: tuple[float, float],
    warnings: list[str],
) -> Entry | None:
    label = str(interval.get("label"))
    if label not in FORMULAS or label not in ctx.options.formulas:
        return None
    if label == NonQuranKind.BASMALA.value:
        count = ctx.passages.word_count(BASMALA_REF)
        return _entry(
            ctx, interval, index, BASMALA_REF, (1, count), t, warnings, same_as_engine=True
        )
    if not ctx.options.with_arabic:
        return None
    label_ar = interval.get("label_ar") or FORMULA_LABELS_AR.get(NonQuranKind(label))
    return (
        None
        if not label_ar
        else Entry(index=index, start_s=t[0], end_s=t[1], kind="note", label=f"[{label_ar}]")
    )


def _added_passages(analysis: Analysis, ctx: Context, warnings: list[str]) -> list[Entry]:
    """Les versets qu'un humain a posés sur un signalement là où le moteur n'avait rien reconnu."""
    out: list[Entry] = []
    for d in analysis.report_decisions:
        if d.kind != "set_ref" or d.value.ref is None or d.value.words is None or d.value.t is None:
            continue
        entry = _entry(
            ctx,
            None,
            None,
            VerseRef.parse(d.value.ref),
            d.value.words,
            d.value.t,
            warnings,
            same_as_engine=False,
            origin="human",
            ids=(d.id,),
        )
        if entry is not None:
            out.append(entry)
    return out
