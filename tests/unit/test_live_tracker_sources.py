"""Candidats : où le passage entendu commence dans chaque verset (étape 3, texte commun).

Le service ne montre le « passage entendu » (mots communs à tous les candidats) que s'il peut
comparer, dans le corpus, la graphie de ces mots pour CHAQUE candidat plausible (I1)."""

from __future__ import annotations

import pytest
from tests.support.live_toy import Clock, ref, toy_index

from aqr.live import tracker as tracker_module
from aqr.live.config import LiveConfig
from aqr.live.events import Candidates
from aqr.live.tracker import HypothesisTracker


def candidates_after(words: str) -> Candidates:
    tracker = HypothesisTracker(toy_index(), LiveConfig())
    last: list = []  # type: ignore[type-arg]
    for word in Clock().say(words):
        last = tracker.feed(word)
    found = [e for e in last if isinstance(e, Candidates)]
    assert found
    return found[0]


def test_each_item_says_where_the_heard_words_start_in_its_verse() -> None:
    candidates = candidates_after("aa bb")
    assert {item.ref: item.first_word for item in candidates.items} == {
        ref("112:1"): 1,
        ref("113:1"): 1,
        ref("113:5"): 1,
    }


def test_the_sources_list_every_plausible_candidate_with_its_first_word() -> None:
    candidates = candidates_after("aa bb")
    assert set(candidates.sources) == {
        (ref("112:1"), 1),
        (ref("113:1"), 1),
        (ref("113:5"), 1),
    }


def test_beyond_the_sample_the_sources_are_empty_so_no_common_text_is_shown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(tracker_module, "_SHARED_WORDS_SAMPLE", 2)
    candidates = candidates_after("aa")
    assert candidates.count == 3
    assert candidates.sources == ()
