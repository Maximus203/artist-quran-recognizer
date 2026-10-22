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
    verify_reconstruction,
)
from aqr.translation_align.config import TranslationAlignmentConfig

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
