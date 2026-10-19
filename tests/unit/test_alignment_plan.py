"""Propositions de passages à aligner, tirées d'une sortie `aqr.recognition/1` (étape A).

Le moteur propose, l'humain corrige : une proposition n'est jamais une vérité terrain.
"""

from __future__ import annotations

import pytest

from aqr.alignment.plan import format_verse_spec, propose_passages
from aqr.domain.models import VerseRef, WordSpan


def verse(ref: str, t0: float, t1: float, status: str = "recognized", words=None, partial=False):
    return {
        "kind": "verse",
        "ref": ref,
        "words": words or [1, 5],
        "partial": partial,
        "status": status,
        "t": [t0, t1],
    }


def abstention(t0: float, t1: float):
    return {"kind": "abstention", "reason": "below_threshold", "t": [t0, t1]}


# --- format_verse_spec : inverse de parse_verse_spec --------------------------------------------
def test_versets_entiers_consecutifs_compactes():
    spans = [WordSpan(VerseRef(21, 51), 1, 9), WordSpan(VerseRef(21, 52), 1, 11)]
    assert format_verse_spec(spans, full=[True, True]) == "21:51-21:52"


def test_traverse_les_sourates_et_partiel_et_reprise():
    spans = [
        WordSpan(VerseRef(21, 112), 1, 9),
        WordSpan(VerseRef(22, 1), 5, 16),
        WordSpan(VerseRef(22, 1), 10, 16),
    ]
    assert format_verse_spec(spans, full=[True, True, False]) == "21:112-22:1, 22:1[10-16]"


def test_verset_isole():
    assert format_verse_spec([WordSpan(VerseRef(2, 255), 1, 50)], full=[True]) == "2:255"


# --- propose_passages -----------------------------------------------------------------------------
def test_versets_proches_regroupes_avec_marge_et_trou_infere_inclus():
    intervals = [
        {"kind": "non_quran", "label": "takbir", "t": [2.0, 5.0]},
        verse("21:51", 47.1, 56.8),
        verse("21:52", 57.3, 68.1),
        verse("21:53", 68.1, 74.8, status="inferred"),
        abstention(68.5, 74.5),
        verse("21:54", 74.8, 83.8),
    ]
    [passage] = propose_passages(intervals, duration_s=200.0)
    assert passage.verses == "21:51-21:54"
    assert passage.t.start_s == pytest.approx(46.1) and passage.t.end_s == pytest.approx(84.8)


def test_un_long_silence_coupe_les_passages_sans_chevauchement():
    intervals = [verse("1:1", 0.5, 4.0), verse("1:2", 30.0, 34.0)]
    first, second = propose_passages(intervals, duration_s=40.0, max_gap_s=6.0, margin_s=1.0)
    assert first.verses == "1:1" and second.verses == "1:2"
    assert first.t.start_s == 0.0 and first.t.end_s == pytest.approx(5.0)
    assert second.t.start_s == pytest.approx(29.0) and second.t.end_s == pytest.approx(35.0)


def test_duree_maximale_respectee():
    intervals = [verse(f"2:{i}", 10.0 * i, 10.0 * i + 9.5) for i in range(1, 30)]
    passages = propose_passages(intervals, duration_s=400.0, max_passage_s=60.0)
    assert all(p.t.end_s - p.t.start_s <= 60.0 for p in passages)
    assert passages[0].verses.startswith("2:1-")
    assert len(passages) > 1


def test_marges_bornees_par_le_passage_voisin():
    intervals = [verse("1:1", 0.5, 4.0), verse("1:2", 10.0, 14.0)]
    first, second = propose_passages(intervals, duration_s=20.0, max_gap_s=5.0, margin_s=4.0)
    assert first.t.end_s <= second.t.start_s


def test_incertain_et_partiel():
    intervals = [
        verse("2:255", 0.0, 8.0, words=[1, 9], partial=True),
        {"kind": "verse", "ref": "55:13", "status": "uncertain", "t": [9.0, 12.0], "words": [1, 5]},
        verse("2:256", 13.0, 20.0),
    ]
    passages = propose_passages(intervals, duration_s=30.0, max_gap_s=6.0)
    # un incertain n'est jamais déclaré à la place de l'humain : il coupe la proposition
    assert [p.verses for p in passages] == ["2:255[1-9]", "2:256"]


def test_aucun_verset_aucune_proposition():
    assert propose_passages([abstention(0.0, 5.0)], duration_s=10.0) == []
