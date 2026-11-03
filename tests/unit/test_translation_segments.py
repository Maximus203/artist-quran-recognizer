"""Découpage de la traduction en fragments (runtime) : lecture du fichier de frontières, empreinte,
sélection du fragment d'une plage de mots. Aucun texte coranique ni traduction réelle ici : un
texte français fictif suffit, seules les frontières comptent (I2 : jamais modifié)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from aqr.domain.models import VerseRef
from aqr.rendering.translation_segments import (
    FragmentPolicy,
    SegmentLibrary,
    SegmentStore,
    SegmentStoreError,
    fingerprint,
    select_fragment,
)

TEXT = "Alpha beta, gamma delta.  Epsilon zeta ! Eta theta iota[1] kappa."
REF = VerseRef(11, 61)
# 4 segments : mots 1-2 | 3-4 | 5-6 | 7-8   (offsets de début en caractères du texte)
CUT_OFFSETS = [TEXT.index("gamma"), TEXT.index("Epsilon"), TEXT.index("Eta")]
CUTS = [[3, CUT_OFFSETS[0], 0.97], [5, CUT_OFFSETS[1], 0.95], [7, CUT_OFFSETS[2], 0.99]]
POLICY = FragmentPolicy()


def _store(entry: dict[str, object] | None = None, **top: object) -> SegmentStore:
    verse = entry or {"h": fingerprint(TEXT), "w": 8, "cuts": CUTS}
    doc: dict[str, object] = {
        "schema": "aqr.translation-segments/1",
        "translation_id": "french_test",
        "method": "test",
        "verses": {str(REF): verse},
        **top,
    }
    return SegmentStore.from_document(doc)


def test_segments_exact_slices_reconstruct_text() -> None:
    segments = _store().segments(REF, TEXT, word_count=8)
    assert segments is not None
    texts = [TEXT[s.start : s.end] for s in segments]
    assert texts[0] == "Alpha beta,"
    assert texts[1] == "gamma delta."
    assert texts[2] == "Epsilon zeta !"
    assert texts[3] == "Eta theta iota[1] kappa."
    # la double espace est la seule différence : jonction à l'espace près (I2)
    assert " ".join(texts) == TEXT.replace("  ", " ")
    assert [(s.first_word, s.last_word) for s in segments] == [(1, 2), (3, 4), (5, 6), (7, 8)]


def test_stale_translation_is_refused_not_shifted() -> None:
    changed = TEXT.replace("Alpha", "Alfa")
    assert _store().segments(REF, changed, word_count=8) is None


def test_word_count_mismatch_is_refused() -> None:
    assert _store().segments(REF, TEXT, word_count=9) is None


def test_unknown_verse_is_unknown() -> None:
    assert _store().segments(VerseRef(1, 1), TEXT, word_count=8) is None


@pytest.mark.parametrize(
    "cuts",
    [
        [[3, 50, 0.9], [3, 60, 0.9]],  # mot non croissant
        [[3, 60, 0.9], [5, 50, 0.9]],  # offset non croissant
        [[1, 10, 0.9]],  # coupure avant le mot 2
        [[9, 10, 0.9]],  # au-delà du dernier mot
        [[3, 9999, 0.9]],  # offset hors du texte
        [[3, 3, 0.9]],  # offset au milieu d'un mot (pas après un espace)
    ],
)
def test_incoherent_cuts_are_refused(cuts: list[list[float]]) -> None:
    store = _store({"h": fingerprint(TEXT), "w": 8, "cuts": cuts})
    assert store.segments(REF, TEXT, word_count=8) is None


def test_no_cut_is_a_single_segment() -> None:
    store = _store({"h": fingerprint(TEXT), "w": 8, "cuts": []})
    segments = store.segments(REF, TEXT, word_count=8)
    assert segments is not None
    assert len(segments) == 1
    assert (segments[0].first_word, segments[0].last_word) == (1, 8)
    assert TEXT[segments[0].start : segments[0].end] == TEXT


def test_wrong_schema_is_refused() -> None:
    with pytest.raises(SegmentStoreError):
        SegmentStore.from_document({"schema": "autre/9", "verses": {}})


def _segs() -> tuple[object, ...]:
    segments = _store().segments(REF, TEXT, word_count=8)
    assert segments is not None
    return tuple(segments)


def test_fragment_exact_on_segment_boundaries() -> None:
    segments = _store().segments(REF, TEXT, word_count=8)
    assert segments is not None
    fragment = select_fragment(segments, TEXT, 3, 6, 8, POLICY)
    assert fragment is not None
    assert (fragment.first_word, fragment.last_word) == (3, 6)
    assert fragment.text == "gamma delta.  Epsilon zeta !"  # exactement la tranche d'origine
    assert not fragment.approximate
    assert fragment.ellipsis_before and fragment.ellipsis_after


def test_fragment_over_a_range_inside_a_segment_is_approximate() -> None:
    segments = _store().segments(REF, TEXT, word_count=8)
    assert segments is not None
    fragment = select_fragment(segments, TEXT, 4, 4, 8, POLICY)
    assert fragment is not None
    assert (fragment.first_word, fragment.last_word) == (3, 4)
    assert fragment.approximate


def test_fragment_drops_an_edge_segment_barely_covered() -> None:
    segments = _store().segments(REF, TEXT, word_count=8)
    assert segments is not None
    # mots 2..5 : le mot 2 n'est qu'1/2 du segment 1-2 (limite 0,5 -> gardé) ; avec 0,6 -> écarté
    strict = FragmentPolicy(min_edge_overlap=0.6)
    fragment = select_fragment(segments, TEXT, 2, 5, 8, strict)
    assert fragment is not None
    assert fragment.first_word == 3


def test_fragment_too_loose_falls_back() -> None:
    segments = _store().segments(REF, TEXT, word_count=8)
    assert segments is not None
    # 1 mot affiché, mais le segment en couvre 2 -> dépassement 100 % : refusé si limite 0,5
    tight = FragmentPolicy(max_overreach=0.5)
    assert select_fragment(segments, TEXT, 4, 4, 8, tight) is None


def test_whole_verse_range_has_no_fragment() -> None:
    segments = _store().segments(REF, TEXT, word_count=8)
    assert segments is not None
    assert select_fragment(segments, TEXT, 1, 8, 8, POLICY) is None


def test_fragment_covering_whole_verse_has_no_fragment() -> None:
    segments = _store().segments(REF, TEXT, word_count=8)
    assert segments is not None
    assert select_fragment(segments, TEXT, 2, 8, 8, FragmentPolicy(max_overreach=9.0)) is None


def test_single_segment_verse_has_no_fragment() -> None:
    store = _store({"h": fingerprint(TEXT), "w": 8, "cuts": []})
    segments = store.segments(REF, TEXT, word_count=8)
    assert segments is not None
    assert select_fragment(segments, TEXT, 3, 4, 8, POLICY) is None


def test_ellipsis_flags_follow_the_borders() -> None:
    segments = _store().segments(REF, TEXT, word_count=8)
    assert segments is not None
    head = select_fragment(segments, TEXT, 1, 4, 8, POLICY)
    assert head is not None
    assert not head.ellipsis_before and head.ellipsis_after
    tail = select_fragment(segments, TEXT, 5, 8, 8, POLICY)
    assert tail is not None
    assert tail.ellipsis_before and not tail.ellipsis_after


def test_invalid_range_is_rejected() -> None:
    segments = _store().segments(REF, TEXT, word_count=8)
    assert segments is not None
    with pytest.raises(ValueError):
        select_fragment(segments, TEXT, 5, 3, 8, POLICY)
    with pytest.raises(ValueError):
        select_fragment(segments, TEXT, 0, 3, 8, POLICY)


def test_library_loads_by_translation_id_and_ignores_absent_file(tmp_path: Path) -> None:
    library = SegmentLibrary(tmp_path)
    assert library.store("french_test") is None  # fichier absent : pas de découpage, pas d'erreur
    doc = {
        "schema": "aqr.translation-segments/1",
        "translation_id": "french_test",
        "method": "test",
        "verses": {str(REF): {"h": fingerprint(TEXT), "w": 8, "cuts": CUTS}},
    }
    (tmp_path / "french_test.json").write_text(json.dumps(doc), encoding="utf-8")
    store = SegmentLibrary(tmp_path).store("french_test")
    assert store is not None
    assert store.segments(REF, TEXT, word_count=8) is not None


def test_library_rejects_unsafe_translation_id(tmp_path: Path) -> None:
    assert SegmentLibrary(tmp_path).store("../secret") is None


def test_library_with_corrupt_file_degrades_to_none(tmp_path: Path) -> None:
    (tmp_path / "french_test.json").write_text("{pas du json", encoding="utf-8")
    assert SegmentLibrary(tmp_path).store("french_test") is None
