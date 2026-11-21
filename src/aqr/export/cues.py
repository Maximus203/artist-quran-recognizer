"""De la vue fusionnée aux sous-titres : durées, décalage, karaoké, découpe (désactivée).

Par défaut un verset est UN sous-titre, arabe et traduction entiers (ADR-0031, qui remplace
l'ADR-0029) ; la découpe ci-dessous n'existe que derrière `pause_split`, désactivé par défaut.

Avec `pause_split`, un verset plus long que la durée maximale est coupé aux frontières de mots :
aux temps mesurés quand le moteur les a (alignement forcé), sinon au prorata de la longueur des mots
(et l'aperçu le dit). La traduction suit l'arabe exactement ou pas du tout (ADR-0027) : on ne
coupe que là où une tranche `segments` de QuranEnc (jamais réécrite) finit ; sans tranches
exactes, le verset reste entier avec toute sa traduction. Rien n'est inventé : chaque ligne est
un morceau du texte du corpus ou de la traduction.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from itertools import pairwise
from statistics import median
from typing import Any, Final

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


STOP_SIGNS: Final = frozenset("ۗۘۚۛ")
"""Signes du Mushaf où l'on peut s'arrêter : qalā ۗ, lāzim ۘ, jā'iz ۚ, mu'ānaqa ۛ. Ni ۙ (ne pas
s'arrêter) ni ۖ (mieux vaut continuer)."""

MIN_CAP_SHARE: Final = 0.5
"""Au plafond, un signe d'arrêt n'est préféré que si le morceau couvre au moins cette part de
`max_s` : sinon on afficherait un tout petit morceau pour rien."""


MIN_CARD_S: Final = 2.0
"""Durée minimale d'une carte issue d'une coupe de verset (ADR-0027) : une coupe ne se justifie que
si chaque morceau se lit. Plus conservateur que `min_s` (durée minimale d'un sous-titre)."""


def pause_after(
    words: Sequence[str], times: Sequence[tuple[float, float]], pause_s: float
) -> frozenset[int]:
    """Indices (0-based) des mots après lesquels le récitant s'arrête, d'après les temps mesurés.

    Les temps au mot sont contigus (le silence qui suit un mot lui est compté, ADR-0006) : une
    pause se voit donc à l'allongement d'un mot au-delà de son débit. Le débit est la médiane des
    secondes par lettre du verset (robuste à quelques pauses) ; le silence d'un mot est son
    excédent sur ce débit plus le trou éventuel qui le sépare du suivant. Un madd long peut
    dépasser le seuil : la coupe n'est qu'un changement d'affichage, jamais de texte (I1)."""
    if len(words) < 3 or len(times) != len(words):
        return frozenset()
    weights = [max(1, len(normalize_arabic(w).replace(" ", ""))) for w in words]
    rate = median((end - start) / w for (start, end), w in zip(times, weights, strict=True))
    out: set[int] = set()
    for k in range(len(words) - 1):
        start, end = times[k]
        excess = max(0.0, (end - start) - rate * weights[k])
        gap = max(0.0, times[k + 1][0] - end)
        if excess + gap >= pause_s:
            out.add(k)
    return frozenset(out)


def sign_stops(words: Sequence[str]) -> frozenset[int]:
    """Indices des mots suivis d'un signe d'arrêt permis (pas le dernier : le verset finit)."""
    return frozenset(k for k, word in enumerate(words[:-1]) if any(ch in STOP_SIGNS for ch in word))


def _chunks(
    times: Sequence[tuple[float, float]],
    start_s: float,
    max_s: float,
    min_s: float,
    pauses: frozenset[int] = frozenset(),
    stops: frozenset[int] = frozenset(),
) -> list[tuple[int, int]]:
    """Plages de mots `[i, j)` : coupées après chaque mot de `pauses`, et d'au plus `max_s`
    chacune (un mot seul peut dépasser). Au plafond, on coupe de préférence après un mot de
    `stops` si le morceau couvre au moins la moitié de `max_s`. Une plage plus courte que `min_s`
    est rattachée à sa voisine (la précédente, sinon la suivante)."""
    out: list[tuple[int, int]] = []
    i = 0
    while i < len(times):
        begin = start_s if not out else times[i][0]
        j = i + 1
        while j < len(times) and (j - 1) not in pauses and times[j][1] - begin <= max_s:
            j += 1
        if j < len(times) and (j - 1) not in pauses:  # coupé par le plafond
            fitting = [
                k + 1
                for k in stops
                if i < k + 1 < j and times[k][1] - begin >= MIN_CAP_SHARE * max_s
            ]
            if fitting:
                j = max(fitting)
        out.append((i, j))
        i = j
    return _absorb_short(out, times, min_s)


def _absorb_short(
    chunks: list[tuple[int, int]], times: Sequence[tuple[float, float]], min_s: float
) -> list[tuple[int, int]]:
    """Rattache chaque plage plus courte que `min_s` à la précédente (la 1re, à la suivante)."""
    out = list(chunks)
    k = 0
    while len(out) > 1 and k < len(out):
        first, last = out[k]
        if times[last - 1][1] - times[first][0] >= min_s:
            k += 1
            continue
        if k == 0:
            out[0:2] = [(first, out[1][1])]
        else:
            out[k - 1 : k + 1] = [(out[k - 1][0], last)]
            k -= 1
    return out


def align_to_segments(
    ranges: Sequence[tuple[int, int]],
    spans: Sequence[tuple[int, int]],
    first_word: int,
    word_count: int,
) -> list[tuple[int, int]]:
    """Ne garde des coupes que celles où une tranche de traduction exacte finit (ADR-0027).

    `spans` sont les plages de mots arabes (numérotées dans le verset, bornes comprises) des
    tranches QuranEnc ; `first_word` est le numéro du premier mot de l'entrée. Une coupe est
    permise si aucune tranche ne la chevauche : chaque carte porte alors des tranches entières,
    jamais un morceau de tranche. Si les tranches ne couvrent pas tous les mots (ou n'existent
    pas), la traduction ne peut pas suivre l'arabe : le verset reste d'un bloc."""
    whole = [(0, word_count)]
    if len(ranges) <= 1:
        return list(ranges)
    covered = [any(lo <= first_word + k <= hi for lo, hi in spans) for k in range(word_count)]
    if not spans or not all(covered):
        return whole
    kept = [0]
    for _, end in ranges[:-1]:
        boundary = first_word + end  # numéro du premier mot de la carte suivante
        if not any(lo < boundary <= hi for lo, hi in spans):
            kept.append(end)
    kept.append(word_count)
    return list(pairwise(kept))


def _translation_spans(entry: Entry) -> list[tuple[tuple[int, int], str]]:
    """Les tranches exactes de QuranEnc du passage (phrases si elles existent, sinon propositions),
    limitées à la plage du fragment quand la traduction n'en couvre qu'une."""
    translation = entry.translation or {}
    segments = translation.get("phrases") or translation.get("segments")
    fragment = translation.get("fragment")
    use_fragment = (
        entry.scope != "verse"
        and (entry.scope == "fragment" or translation.get("scope") == "fragment")
        and isinstance(fragment, Mapping)
    )
    low, high = (-1, 10**6)
    if use_fragment and isinstance(fragment, Mapping):
        low, high = int(fragment["words"][0]), int(fragment["words"][1])
    out: list[tuple[tuple[int, int], str]] = []
    if isinstance(segments, list):
        for segment in segments:
            start = int(segment["words"][0])
            if low <= start <= high:
                out.append(((start, int(segment["words"][1])), str(segment["text"])))
    return out


def _split_translation(
    entry: Entry, ranges: Sequence[tuple[int, int]], ctx: Context
) -> tuple[list[tuple[int, int]], list[str]]:
    """Les plages de mots retenues et le texte de traduction de chacune.

    La traduction suit l'arabe exactement ou ne le suit pas : seules les coupes qui tombent à la
    fin d'une tranche QuranEnc sont gardées (jamais de coupe au prorata, I2), et si aucune ne
    l'est le verset reste entier avec toute sa traduction. Aucune carte n'est sans traduction."""
    options = ctx.options
    shown = translation_text(entry.translation, scope=entry.scope, strip_notes=options.strip_notes)
    if shown is None:
        return list(ranges), [""] * len(ranges)
    whole = [(0, len(entry.arabic_words))]
    if len(ranges) == 1:
        return list(ranges), [shown]
    first_word = entry.words[0] if entry.words else 1
    pieces = _translation_spans(entry)
    aligned = align_to_segments(
        ranges, [span for span, _ in pieces], first_word, len(entry.arabic_words)
    )
    if len(aligned) <= 1:
        return whole, [shown]
    buckets = [""] * len(aligned)
    for (low_word, _), text in pieces:
        # Aucune tranche ne chevauche une coupe : la carte est celle qui contient son début.
        start = max(low_word, first_word)
        for slot, (i, j) in enumerate(aligned):
            if first_word + i <= start < first_word + j or (slot == 0 and start < first_word + i):
                buckets[slot] = f"{buckets[slot]} {text}".strip()
                break
    if not all(buckets):
        return whole, [shown]
    fragment = (entry.translation or {}).get("fragment")
    if entry.scope != "verse" and isinstance(fragment, Mapping):
        if fragment.get("ellipsis_before"):
            buckets[0] = "… " + buckets[0]
        if fragment.get("ellipsis_after"):
            buckets[-1] = buckets[-1] + " …"
    if options.strip_notes:
        buckets = [strip_note_marks(b) for b in buckets]
    return aligned, buckets


def _reference(entry: Entry, ctx: Context) -> str | None:
    if not ctx.options.show_ref or entry.ref is None:
        return None
    if entry.words is None or entry.words == (
        1,
        ctx.passages.word_count(VerseRef.parse(entry.ref)),
    ):
        return entry.ref
    return f"{entry.ref} [{entry.words[0]}-{entry.words[1]}]"


def _cues_for(entry: Entry, ctx: Context) -> list[Cue]:
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
    split_on_pauses = options.pause_split and entry.kind == "verse"
    pauses = (
        pause_after(entry.arabic_words, times, options.pause_s)
        if split_on_pauses and entry.measured
        else frozenset()
    )
    stops = sign_stops(entry.arabic_words) if split_on_pauses else frozenset()
    if entry.kind == "verse" and not options.pause_split:
        # ADR-0031 : un verset = un cue, entier ; ni les pauses ni le plafond `max_s` ne le coupent.
        ranges = [(0, len(times))] if times else []
    else:
        ranges = _chunks(
            times, entry.start_s, options.max_s, max(options.min_s, MIN_CARD_S), pauses, stops
        )
    pieces: list[str] = []
    if options.with_translation:
        ranges, pieces = _split_translation(entry, ranges, ctx)
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
        made = _cues_for(entry, ctx)
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
