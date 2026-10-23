"""De la vue fusionnée aux sous-titres : découpe d'un long verset, durées, décalage, karaoké.

Un verset plus long que la durée maximale est coupé aux frontières de mots : aux temps mesurés
quand le moteur les a (alignement forcé), sinon au prorata de la longueur des mots (et l'aperçu le
dit). La traduction suit l'arabe : les tranches `segments` de QuranEnc (jamais réécrites) quand
elles existent, sinon une coupe proportionnelle aux espaces. Rien n'est inventé : chaque ligne est
un morceau du texte du corpus ou de la traduction.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any

from aqr.corpus.normalize import normalize_arabic
from aqr.domain.models import TimeSpan, VerseRef
from aqr.export.analysis import Context
from aqr.export.texts import strip_note_marks, translation_text, wrap_lines
from aqr.export.view import Entry
from aqr.pipeline.word_times import interpolate
from aqr.rendering.subtitles import Cue, CueWord


@dataclass(frozen=True)
class CueBuild:
    cues: tuple[Cue, ...]
    warnings: tuple[str, ...]
    split: int
    """Nombre de versets coupés en plusieurs sous-titres."""


def merge_repetitions(entries: Sequence[Entry]) -> list[Entry]:
    """Un même passage redit tout de suite après n'est qu'un sous-titre, de la première à la
    dernière lecture. Seul le même verset avec les mêmes mots est fusionné."""
    out: list[Entry] = []
    for entry in entries:
        previous = out[-1] if out else None
        if (
            previous is not None
            and entry.repetition
            and entry.kind == "verse"
            and previous.kind == "verse"
            and (previous.ref, previous.words) == (entry.ref, entry.words)
        ):
            out[-1] = replace(
                previous,
                end_s=max(previous.end_s, entry.end_s),
                word_times=None,
                measured=False,
            )
            continue
        out.append(entry)
    return out


def _word_times(entry: Entry) -> list[tuple[float, float]]:
    """Le temps de chaque mot : mesuré si le moteur l'a, sinon au prorata de la longueur des
    mots."""
    if entry.word_times is not None and len(entry.word_times) == len(entry.arabic_words):
        return [(a, b) for a, b in entry.word_times]
    weights = [max(1, len(normalize_arabic(w).replace(" ", ""))) for w in entry.arabic_words]
    spans = interpolate(weights, TimeSpan(entry.start_s, entry.end_s))
    return [(s.start_s, s.end_s) for s in spans]


def _chunks(
    times: Sequence[tuple[float, float]], start_s: float, max_s: float, min_s: float
) -> list[tuple[int, int]]:
    """Plages de mots `[i, j)` d'au plus `max_s` chacune (un mot seul peut dépasser) ; une dernière
    plage plus courte que `min_s` est rattachée à la précédente."""
    out: list[tuple[int, int]] = []
    i = 0
    while i < len(times):
        begin = start_s if not out else times[i][0]
        j = i + 1
        while j < len(times) and times[j][1] - begin <= max_s:
            j += 1
        out.append((i, j))
        i = j
    if len(out) > 1:
        last_start, last_end = out[-1]
        if times[last_end - 1][1] - times[last_start][0] < min_s:
            previous = out.pop(-2)
            out[-1] = (previous[0], last_end)
    return out


def _split_translation(
    entry: Entry, ranges: Sequence[tuple[int, int]], ctx: Context, warnings: list[str]
) -> list[str]:
    """Le texte de traduction de chaque plage de mots de l'arabe."""
    options = ctx.options
    shown = translation_text(entry.translation, scope=entry.scope, strip_notes=options.strip_notes)
    if shown is None:
        return [""] * len(ranges)
    if len(ranges) == 1:
        return [shown]
    translation = entry.translation or {}
    first_word = entry.words[0] if entry.words else 1
    segments = translation.get("segments")
    fragment = translation.get("fragment")
    use_fragment = (
        entry.scope != "verse"
        and (entry.scope == "fragment" or translation.get("scope") == "fragment")
        and isinstance(fragment, Mapping)
    )
    pieces: list[tuple[int, str]] = []
    if isinstance(segments, list) and segments:
        low, high = (-1, 10**6)
        if use_fragment and isinstance(fragment, Mapping):
            low, high = int(fragment["words"][0]), int(fragment["words"][1])
        for segment in segments:
            start = int(segment["words"][0])
            if low <= start <= high:
                pieces.append((start, str(segment["text"])))
    if pieces:
        buckets = [""] * len(ranges)
        for start, text in pieces:
            absolute = min(max(start, first_word), first_word + len(entry.arabic_words) - 1)
            slot = next(
                k
                for k, (i, j) in enumerate(ranges)
                if first_word + i <= absolute <= first_word + j - 1
            )
            buckets[slot] = f"{buckets[slot]} {text}".strip()
        if use_fragment and isinstance(fragment, Mapping):
            filled = [k for k, b in enumerate(buckets) if b]
            if filled and fragment.get("ellipsis_before"):
                buckets[filled[0]] = "… " + buckets[filled[0]]
            if filled and fragment.get("ellipsis_after"):
                buckets[filled[-1]] = buckets[filled[-1]] + " …"
        if options.strip_notes:
            buckets = [strip_note_marks(b) for b in buckets]
        return buckets
    note = "traduction coupée au prorata des mots (découpage de QuranEnc indisponible)"
    if note not in warnings:
        warnings.append(note)
    pieces_words = shown.split()
    total = len(entry.arabic_words)
    buckets = []
    for i, j in ranges:
        low = round(len(pieces_words) * i / total)
        high = round(len(pieces_words) * j / total)
        buckets.append(" ".join(pieces_words[low:high]))
    return buckets


def _reference(entry: Entry, ctx: Context) -> str | None:
    if not ctx.options.show_ref or entry.ref is None:
        return None
    if entry.words is None or entry.words == (
        1,
        ctx.passages.word_count(VerseRef.parse(entry.ref)),
    ):
        return entry.ref
    return f"{entry.ref} [{entry.words[0]}-{entry.words[1]}]"


def _cues_for(entry: Entry, ctx: Context, warnings: list[str]) -> list[Cue]:
    options = ctx.options
    if entry.kind == "note":
        line = entry.label or ""
        if not line:
            return []
        # Un libellé de formule est de l'arabe (lecture de droite à gauche) ; un marqueur
        # « [incertain : a | b] » est du texte latin : jamais encadré en RTL.
        is_arabic = any("؀" <= ch <= "ۿ" for ch in line)
        return [
            Cue(
                entry.start_s,
                entry.end_s,
                arabic=line if is_arabic else None,
                translation=() if is_arabic else (line,),
            )
        ]
    times = _word_times(entry)
    ranges = _chunks(times, entry.start_s, options.max_s, options.min_s)
    pieces = _split_translation(entry, ranges, ctx, warnings) if options.with_translation else []
    cues: list[Cue] = []
    for k, (i, j) in enumerate(ranges):
        first, last = k == 0, k == len(ranges) - 1
        start = entry.start_s if first else times[i][0]
        end = entry.end_s if last else times[j - 1][1]
        text = " ".join(entry.arabic_words[i:j])
        if first and entry.prefix:
            text = f"{entry.prefix} {text}"
        words: tuple[CueWord, ...] = ()
        if (
            options.with_arabic
            and entry.measured
            and options.karaoke
            and not (first and entry.prefix)
        ):
            words = tuple(
                CueWord(entry.arabic_words[n], times[n][0], times[n][1]) for n in range(i, j)
            )
        translation = wrap_lines(pieces[k], options.line_chars) if pieces and pieces[k] else ()
        if not options.with_arabic and not translation:
            continue
        cues.append(
            Cue(
                start,
                end,
                arabic=text if options.with_arabic else None,
                translation=translation,
                reference=_reference(entry, ctx) if first else None,
                words=words,
            )
        )
    return cues


def build_cues(entries: Sequence[Entry], ctx: Context) -> CueBuild:
    options = ctx.options
    warnings: list[str] = []
    ordered = merge_repetitions(entries) if options.repetitions == "merge" else list(entries)
    cues: list[Cue] = []
    split = 0
    for entry in ordered:
        made = _cues_for(entry, ctx, warnings)
        if len(made) > 1:
            split += 1
        if not entry.measured and entry.kind == "verse" and len(made) > 1:
            note = "versets coupés sur des temps estimés (pas de temps mesurés au mot)"
            if note not in warnings:
                warnings.append(note)
        cues.extend(made)
    cues = _stretch(cues, options.min_s)
    cues = _shift(cues, options.offset_ms / 1000)
    return CueBuild(tuple(cues), tuple(warnings), split)


def _stretch(cues: list[Cue], min_s: float) -> list[Cue]:
    """Un sous-titre trop court est prolongé jusqu'à `min_s`, sans jamais empiéter sur le
    suivant."""
    out: list[Cue] = []
    for n, cue in enumerate(cues):
        end = cue.end_s
        if end - cue.start_s < min_s:
            limit = cues[n + 1].start_s if n + 1 < len(cues) else float("inf")
            end = max(end, min(cue.start_s + min_s, limit))
        out.append(replace(cue, end_s=end))
    return out


def _shift(cues: list[Cue], offset_s: float) -> list[Cue]:
    if offset_s == 0:
        return cues
    out: list[Cue] = []
    for cue in cues:
        start, end = cue.start_s + offset_s, cue.end_s + offset_s
        if end <= 0:
            continue
        shifted: tuple[CueWord, ...] = tuple(
            CueWord(w.text, w.start_s + offset_s, w.end_s + offset_s) for w in cue.words
        )
        out.append(replace(cue, start_s=max(0.0, start), end_s=end, words=shifted))
    return out


def preview_json(cues: Sequence[Cue], limit: int) -> list[dict[str, Any]]:
    return [
        {
            "start_s": c.start_s,
            "end_s": c.end_s,
            "arabic": c.arabic,
            "translation": list(c.translation),
            "reference": c.reference,
        }
        for c in cues[:limit]
    ]
