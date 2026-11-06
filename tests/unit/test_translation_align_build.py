"""Construction du fichier de frontières sur un corpus jouet (mots inventés, correspondance 1-1).

Vérifie le principe (les frontières tombent sur les propositions), l'invariant I2 (reconstitution)
et le repli : sans appui lexical, pas de frontière."""

from __future__ import annotations

import json
import random
from dataclasses import replace

from aqr.domain.models import VerseRef
from aqr.rendering.translation_segments import SegmentStore
from aqr.translation_align.build import (
    VerseSource,
    build_document,
    dump_document,
    leading_basmala,
    merge_fine_cuts,
    merge_soft_cuts,
    verify_reconstruction,
)
from aqr.translation_align.config import TranslationAlignmentConfig
from aqr.translation_align.segmenter import Cut

ARABIC = [a + b + c for a in "كقفرسم" for b in "تلنب" for c in "رمدش"][:48]
FRENCH = [f"mot{chr(97 + i // 6)}{chr(97 + i % 6)}x" for i in range(48)]
CONFIG = TranslationAlignmentConfig(second_opinion=False, em_iterations=6)


def _toy(seed: int = 3, verses: int = 140) -> tuple[list[VerseSource], dict[str, list[int]]]:
    rng = random.Random(seed)
    sources: list[VerseSource] = []
    truth: dict[str, list[int]] = {}
    for n in range(1, verses + 1):
        sizes = [rng.randint(2, 4) for _ in range(3)]
        picks = rng.sample(range(48), sum(sizes))
        words = [ARABIC[i] for i in picks]
        parts = []
        cursor = 0
        for size in sizes:
            parts.append(" ".join(FRENCH[i] for i in picks[cursor : cursor + size]))
            cursor += size
        ref = VerseRef(2, n)
        sources.append(VerseSource(ref, tuple(words), " ".join(words), ", ".join(parts) + "."))
        truth[str(ref)] = [sizes[0] + 1, sizes[0] + sizes[1] + 1]
    return sources, truth


def test_boundaries_follow_the_clauses_when_the_lexicon_supports_them() -> None:
    sources, truth = _toy()
    document = build_document(sources, "toy", CONFIG, corpus_sha256="0" * 64)
    verses = document["verses"]
    assert isinstance(verses, dict)
    exact = 0
    wrong = 0
    for ref, expected in truth.items():
        got = [cut[0] for cut in verses[ref]["cuts"]]
        exact += got == expected
        wrong += any(g not in expected for g in got)
    assert exact >= 0.7 * len(truth)
    assert wrong == 0  # précision d'abord : jamais une frontière ailleurs que sur une proposition


def test_reconstruction_holds_on_every_verse() -> None:
    sources, _truth = _toy()
    document = build_document(sources, "toy", CONFIG, corpus_sha256="0" * 64)
    assert verify_reconstruction(document, sources) == []


def test_document_has_no_text_and_roundtrips_through_the_store() -> None:
    sources, _truth = _toy(verses=40)
    document = build_document(sources, "toy", CONFIG, corpus_sha256="0" * 64)
    raw = dump_document(document)
    reloaded = json.loads(raw)
    for source in sources:
        assert source.french not in raw
        assert source.arabic_words[0] not in raw
    assert reloaded["schema"] == "aqr.translation-segments/1"
    assert reloaded["method"] == CONFIG.method
    store = SegmentStore.from_document(reloaded)
    first = sources[0]
    assert store.segments(first.ref, first.french, len(first.arabic_words)) is not None


def test_a_verse_without_any_candidate_cut_is_one_segment() -> None:
    source = VerseSource(VerseRef(2, 1), ("كتب", "قلم"), "كتب قلم", "Un seul membre de phrase")
    document = build_document([source], "toy", CONFIG, corpus_sha256="0" * 64)
    verses = document["verses"]
    assert isinstance(verses, dict)
    assert verses["2:1"]["cuts"] == []


def test_unrelated_translation_never_invents_boundaries() -> None:
    sources, _truth = _toy(verses=100)
    rng = random.Random(9)
    shuffled = []
    for source in sources:
        sizes = [rng.randint(1, 6) for _ in range(3)]  # longueurs sans rapport avec l'arabe
        words = [FRENCH[rng.randrange(48)] for _ in range(sum(sizes))]
        text = (
            ", ".join(" ".join(words[sum(sizes[:k]) : sum(sizes[: k + 1])]) for k in range(3)) + "."
        )
        shuffled.append(replace(source, french=text))
    document = build_document(shuffled, "toy", CONFIG, corpus_sha256="0" * 64)
    stats = document["stats"]
    assert isinstance(stats, dict)
    # aucune correspondance apprenable : le hasard ne passe presque jamais (au plus 10 % des
    # 200 coupures candidates, contre ~100 % quand le lexique les soutient)
    assert stats["cuts"] <= 0.10 * 2 * len(shuffled)


def test_leading_basmala_is_detected_only_on_first_verses() -> None:
    bismillah = ("بِسْمِ", "ٱللَّهِ", "ٱلرَّحْمَـٰنِ", "ٱلرَّحِيمِ", "الم")
    first = VerseSource(VerseRef(2, 1), bismillah, " ".join(bismillah), "Alif, Lâm, Mîm.")
    second = VerseSource(VerseRef(2, 2), bismillah, " ".join(bismillah), "Autre.")
    fatiha = VerseSource(VerseRef(1, 1), bismillah[:4], " ".join(bismillah[:4]), "Au nom d’Allah")
    assert leading_basmala(first) == 4
    assert leading_basmala(second) == 0
    assert leading_basmala(fatiha) == 0


def _cut(boundary: int, word: int, confidence: float) -> Cut:
    return Cut(boundary=boundary, word=word, confidence=confidence)


def test_merge_soft_cuts_keeps_firm_cuts_untouched_and_adds_compatible_soft_ones() -> None:
    firm = [_cut(1, 10, 0.99)]
    soft = [_cut(0, 4, 0.7), _cut(1, 11, 0.99), _cut(2, 16, 0.65)]
    merged = merge_soft_cuts(firm, soft, tolerance=1)
    assert [(c.boundary, c.word) for c in merged] == [(0, 4), (1, 10), (2, 16)]
    assert merged[1] is firm[0]  # la ferme garde sa place, pas celle que la chaîne souple propose


def test_merge_soft_cuts_drops_a_soft_cut_that_would_reverse_the_word_order() -> None:
    firm = [_cut(1, 10, 0.99)]
    soft = [_cut(0, 12, 0.8), _cut(2, 8, 0.7)]  # avant la ferme mais au-delà ; après mais en deçà
    assert merge_soft_cuts(firm, soft, tolerance=1) == firm


def test_merge_soft_cuts_drops_a_soft_cut_next_to_a_firm_one() -> None:
    firm = [_cut(1, 10, 0.99)]
    assert merge_soft_cuts(firm, [_cut(2, 11, 0.9)], tolerance=1) == firm


def test_merge_fine_cuts_keeps_base_and_adds_only_order_preserving_cuts() -> None:
    base = [(5, 40, 0.99), (12, 120, 0.97)]
    fine = [
        (2, 10, 0.5),  # libre, mot 2 < 5 : gardée
        (5, 60, 0.9),  # même mot que la base à un décalage différent : écartée (ordre)
        (8, 80, 0.4),  # entre les deux : gardée
        (9, 40, 0.8),  # décalage déjà pris par la base : ignorée
        (3, 100, 0.7),  # mot 3 après le mot 8 : écartée (ordre)
    ]
    merged = merge_fine_cuts(base, fine)
    assert merged == [(2, 10, 0.5), (5, 40, 0.99), (8, 80, 0.4), (12, 120, 0.97)]
