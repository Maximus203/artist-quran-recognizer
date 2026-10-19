"""Propositions de passages à aligner, tirées d'une sortie `aqr.recognition/1` (étape A,
ADR-0006).

Le moteur propose, l'humain corrige puis valide à l'oreille : une proposition n'est jamais une
vérité terrain. Les versets `recognized` et `inferred` consécutifs et proches forment un passage (au plus
`max_passage_s`, la longueur qu'un treillis CTC accepte d'un seul tenant) ; un `uncertain` coupe
la proposition : c'est à l'humain de dire ce qui est récité là.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from aqr.domain.models import TimeSpan, VerseRef, WordSpan

PLAN_SCHEMA = "aqr.align-plan/1"


@dataclass(frozen=True)
class PassageProposal:
    t: TimeSpan
    verses: str
    """Déclaration au format de `aqr align --verses` (« 21:51-21:54, 21:54[5-8] »)."""


def format_verse_spec(spans: Sequence[WordSpan], full: Sequence[bool]) -> str:
    """Forme compacte d'une suite de plages (inverse de `parse_verse_spec`) : versets entiers
    consécutifs regroupés en « a-b », plage partielle écrite « ref[premier-dernier] »."""
    items: list[str] = []
    run: list[VerseRef] = []

    def flush() -> None:
        if run:
            items.append(str(run[0]) if len(run) == 1 else f"{run[0]}-{run[-1]}")
            run.clear()

    for span, whole in zip(spans, full, strict=True):
        if whole and run and run[-1].next() == span.ref:
            run.append(span.ref)
            continue
        flush()
        if whole:
            run.append(span.ref)
        else:
            items.append(f"{span.ref}[{span.first_word}-{span.last_word}]")
    flush()
    return ", ".join(items)


def propose_passages(
    intervals: Sequence[Mapping[str, Any]],
    duration_s: float,
    *,
    max_passage_s: float = 110.0,
    max_gap_s: float = 6.0,
    margin_s: float = 1.0,
) -> list[PassageProposal]:
    """Passages à faire valider : versets proches regroupés, marges d'écoute sans chevauchement."""
    groups: list[list[Mapping[str, Any]]] = []
    current: list[Mapping[str, Any]] = []
    for item in sorted(intervals, key=lambda i: float(i["t"][0]) if i.get("t") else -1.0):
        if item.get("kind") != "verse" or not item.get("t"):
            continue
        if item.get("status") not in ("recognized", "inferred"):
            if current:
                groups.append(current)
            current = []
            continue
        start, end = float(item["t"][0]), float(item["t"][1])
        if current:
            first, last = float(current[0]["t"][0]), float(current[-1]["t"][1])
            too_far = start - last > max_gap_s
            too_long = max(end, last) - first + 2 * margin_s > max_passage_s
            if too_far or too_long:
                groups.append(current)
                current = []
        current.append(item)
    if current:
        groups.append(current)

    bounds = [(float(g[0]["t"][0]), max(float(i["t"][1]) for i in g)) for g in groups]
    proposals: list[PassageProposal] = []
    for index, group in enumerate(groups):
        start, end = bounds[index]
        low = (bounds[index - 1][1] + start) / 2 if index > 0 else 0.0
        high = (end + bounds[index + 1][0]) / 2 if index + 1 < len(groups) else duration_s
        window = TimeSpan(max(start - margin_s, low, 0.0), min(end + margin_s, high, duration_s))
        spans = [WordSpan(VerseRef.parse(str(i["ref"])), *map(int, i["words"])) for i in group]
        full = [not bool(i.get("partial")) for i in group]
        proposals.append(PassageProposal(t=window, verses=format_verse_spec(spans, full)))
    return proposals


def plan_document(
    source: Mapping[str, Any], proposals: Sequence[PassageProposal]
) -> dict[str, Any]:
    return {
        "schema": PLAN_SCHEMA,
        "source": {"sha256": source.get("sha256"), "duration_s": source.get("duration_s")},
        "notice": (
            "Propositions du moteur à corriger et valider à l'oreille : pas une vérité terrain."
        ),
        "passages": [
            {"t": [round(p.t.start_s, 3), round(p.t.end_s, 3)], "verses": p.verses}
            for p in proposals
        ],
    }
