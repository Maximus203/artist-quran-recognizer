"""Règle de verrou durcie en cours de flux (ADR-0011 §7) : elle monte, elle ne descend jamais."""

from __future__ import annotations

import pytest
from tests.support.live_toy import Clock, ref, toy_index

from aqr.domain.ports import HeardWord
from aqr.live.config import LiveConfig
from aqr.live.events import Locked
from aqr.live.tracker import HypothesisTracker

WORDS = "m1 m2 m3 m4 m5 m6 m7 m8"  # 114:2, huit mots uniques


def say(tracker: HypothesisTracker, words: list[HeardWord]) -> list[int]:
    """Rang du mot qui a déclenché chaque verrou."""
    return [
        rank
        for rank, word in enumerate(words, start=1)
        for event in tracker.feed(word)
        if isinstance(event, Locked)
    ]


def test_au_reglage_de_depart_le_verset_se_verrouille_au_troisieme_mot() -> None:
    tracker = HypothesisTracker(toy_index(), LiveConfig())
    assert say(tracker, Clock().say(WORDS)) == [3]


def test_une_regle_durcie_exige_plus_de_mots_avant_de_nommer() -> None:
    tracker = HypothesisTracker(toy_index(), LiveConfig())
    tracker.set_lock_rule(min_words_lock=5)
    assert say(tracker, Clock().say(WORDS)) == [5]


def test_une_regle_durcie_peut_revenir_a_celle_de_base() -> None:
    tracker = HypothesisTracker(toy_index(), LiveConfig())
    tracker.set_lock_rule(min_words_lock=5, tau_lock=0.995)
    tracker.set_lock_rule()  # None = la valeur de base
    assert say(tracker, Clock().say(WORDS)) == [3]
    assert tracker.lock_rule == (3, 0.98)


def test_un_posterior_plus_exigeant_retarde_ou_empeche_le_verrou() -> None:
    tracker = HypothesisTracker(toy_index(), LiveConfig())
    tracker.set_lock_rule(tau_lock=0.999999999)
    ranks = say(tracker, Clock().say(WORDS))
    assert not ranks or ranks[0] >= 3


def test_la_regle_ne_peut_jamais_etre_assouplie_sous_la_base() -> None:
    tracker = HypothesisTracker(toy_index(), LiveConfig())
    with pytest.raises(ValueError):
        tracker.set_lock_rule(min_words_lock=2)
    with pytest.raises(ValueError):
        tracker.set_lock_rule(tau_lock=0.9)
    assert tracker.lock_rule == (3, 0.98)


def test_la_base_stricte_reste_la_plancher() -> None:
    tracker = HypothesisTracker(toy_index(), LiveConfig(min_words_lock=4, tau_lock=0.99))
    with pytest.raises(ValueError):
        tracker.set_lock_rule(min_words_lock=3)
    tracker.set_lock_rule(min_words_lock=6)
    assert tracker.lock_rule == (6, 0.99)


def test_un_verrou_deja_emis_n_est_pas_retire_par_le_durcissement() -> None:
    tracker = HypothesisTracker(toy_index(), LiveConfig())
    words = Clock().say(WORDS)
    first = say(tracker, words[:3])
    assert first == [3]
    tracker.set_lock_rule(min_words_lock=7)
    rest = [e for w in words[3:] for e in tracker.feed(w)]
    assert not [e for e in rest if isinstance(e, Locked)]
    assert tracker.lock_rule[0] == 7


def test_le_durcissement_ne_fait_nommer_aucun_autre_verset() -> None:
    """Sur les mêmes mots, la règle durcie nomme au plus ce que la règle de base nomme."""
    base = HypothesisTracker(toy_index(), LiveConfig())
    hard = HypothesisTracker(toy_index(), LiveConfig())
    hard.set_lock_rule(min_words_lock=5, tau_lock=0.995)
    spoken = Clock().say("m1 m2 m3 m4")
    named_base = {e.ref for w in spoken for e in base.feed(w) if isinstance(e, Locked)}
    named_hard = {e.ref for w in spoken for e in hard.feed(w) if isinstance(e, Locked)}
    assert named_base == {ref("114:2")}
    assert named_hard <= named_base
    assert named_hard == set()  # 4 mots < 5 : la règle durcie attend
