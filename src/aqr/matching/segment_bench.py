"""Banc de la recherche sur segments réalistes (phase 2b, ADR-0004).

Un segment audio découpé aux pauses est rarement un verset entier : c'est une partie de
verset (waqf), plusieurs versets d'un souffle, ou un verset 1 sans la basmala que Tanzil
y concatène. Ce module tire de tels segments du **flux continu** imla'i (fichier
simple-clean, jamais le corpus Uthmani indexé par le matcher) et mesure ce que le
décodeur ferait d'un segment isolé. Utilisé par `scripts/bench_segments.py` et les tests,
jamais en production.

Métrique principale : `false_named`, nombre de faux versets que le décodeur nommerait
(RECOGNIZED au-dessus du seuil, sans rival proche) — l'invariant I3 exige 0.
"""

from __future__ import annotations

import random
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from aqr.corpus.normalize import normalize_arabic
from aqr.domain.models import VerseRef
from aqr.domain.ports import Candidate, VerseMatcher
from aqr.domain.quran_structure import BASMALA_WORD_COUNT, verse_one_includes_basmala


@dataclass(frozen=True)
class SegmentCase:
    kind: str
    tokens: tuple[str, ...]
    refs: frozenset[VerseRef]  # versets dont au moins un mot est dans le segment

    @property
    def query(self) -> str:
        return " ".join(self.tokens)


def build_flow(
    simple_clean_words: dict[VerseRef, tuple[str, ...]],
) -> list[tuple[VerseRef, str]]:
    """Flux continu imla'i : un (verset, mot normalisé) par mot, basmala retirée du
    verset 1 de chaque sourate sauf 1:1 (où elle est le verset) et 9 (qui n'en a pas)."""
    flow: list[tuple[VerseRef, str]] = []
    for ref in sorted(simple_clean_words):
        tokens = [normalize_arabic(w) for w in simple_clean_words[ref]]
        if ref.ayah == 1 and ref.surah != 1 and verse_one_includes_basmala(ref.surah):
            tokens = tokens[BASMALA_WORD_COUNT:]
        flow.extend((ref, t) for t in tokens if t)
    return flow


def sample_windows(
    flow: Sequence[tuple[VerseRef, str]],
    n: int,
    min_words: int,
    max_words: int,
    rng: random.Random,
    kind: str,
) -> list[SegmentCase]:
    cases: list[SegmentCase] = []
    for _ in range(n):
        size = rng.randint(min_words, max_words)
        start = rng.randrange(0, len(flow) - size)
        window = flow[start : start + size]
        cases.append(
            SegmentCase(
                kind=kind,
                tokens=tuple(t for _r, t in window),
                refs=frozenset(r for r, _t in window),
            )
        )
    return cases


def verse_one_cases(
    simple_clean_words: dict[VerseRef, tuple[str, ...]], min_words: int = 4
) -> list[SegmentCase]:
    """Chaque verset 1 (sauf 1:1 et 9:1) récité SANS la basmala que Tanzil y concatène."""
    cases: list[SegmentCase] = []
    for ref in sorted(simple_clean_words):
        if ref.ayah != 1 or ref.surah == 1 or not verse_one_includes_basmala(ref.surah):
            continue
        tokens = tuple(
            t
            for t in (normalize_arabic(w) for w in simple_clean_words[ref][BASMALA_WORD_COUNT:])
            if t
        )
        if len(tokens) >= min_words:
            cases.append(SegmentCase("verset1_sans_basmala", tokens, frozenset({ref})))
    return cases


@dataclass(frozen=True)
class SegmentMetrics:
    kind: str
    n: int
    top1_correct: int  # refs du meilleur candidat == refs réellement récitées
    named_correct: int  # le décodeur nommerait exactement les bons versets
    uncertain: int  # le décodeur déclarerait UNCERTAIN (rival proche) ou rien (< seuil)
    false_named: int  # RECOGNIZED sur des versets sans aucun rapport : viole I3
    partial_named: int  # RECOGNIZED sur des versets qui recouvrent sans égaler la vérité
    mean_coverage: float  # part moyenne des mots de la requête expliqués (meilleur candidat)
    mean_ms: float


def evaluate(
    matcher: VerseMatcher,
    cases: Sequence[SegmentCase],
    min_recognized_score: float,
    uncertainty_ratio: float,
    top_k: int = 5,
    transform: Callable[[tuple[str, ...], random.Random], tuple[str, ...]] | None = None,
    rng: random.Random | None = None,
) -> SegmentMetrics:
    """Rejoue, sur un segment isolé, la règle d'acceptation du décodeur B7 (seuil puis
    rival proche) pour savoir ce qu'il nommerait sans aucun contexte."""
    top1 = named_ok = uncertain = false_named = partial = 0
    coverage_sum = 0.0
    total_s = 0.0
    noise_rng = rng or random.Random(0)
    for case in cases:
        tokens = case.tokens if transform is None else transform(case.tokens, noise_rng)
        started = time.perf_counter()
        candidates = matcher.match(" ".join(tokens), top_k=top_k)
        total_s += time.perf_counter() - started
        if not candidates:
            uncertain += 1
            continue
        best = candidates[0]
        coverage_sum += best.coverage
        if set(best.refs) == case.refs:
            top1 += 1
        if best.score < min_recognized_score or _has_close_rival(candidates, uncertainty_ratio):
            uncertain += 1
            continue
        named = set(best.refs)
        if named == case.refs:
            named_ok += 1
        elif named & case.refs:
            partial += 1
        else:
            false_named += 1
    n = len(cases)
    return SegmentMetrics(
        kind=cases[0].kind if cases else "",
        n=n,
        top1_correct=top1,
        named_correct=named_ok,
        uncertain=uncertain,
        false_named=false_named,
        partial_named=partial,
        mean_coverage=coverage_sum / n if n else 0.0,
        mean_ms=total_s / n * 1000 if n else 0.0,
    )


def _has_close_rival(candidates: Sequence[Candidate], ratio: float) -> bool:
    best = candidates[0]
    return any(c.refs != best.refs and c.score >= best.score * ratio for c in candidates[1:])
