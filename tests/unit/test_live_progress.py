"""Progression après le verrou (aqr.live/1 `PROGRESS`) : un événement par mot entendu du verset."""

from __future__ import annotations

from tests.support.live_toy import Clock, ref, toy_index

from aqr.live.config import LiveConfig
from aqr.live.events import Locked, Progress
from aqr.live.tracker import HypothesisTracker


def run(words: str) -> list:  # type: ignore[type-arg]
    tracker = HypothesisTracker(toy_index(), LiveConfig())
    events: list = []  # type: ignore[type-arg]
    for word in Clock().say(words):
        events.extend(tracker.feed(word))
    return events


def test_each_word_heard_after_the_lock_gives_a_progress_event_with_its_time() -> None:
    events = run("m1 m2 m3 m4 m5 m6")
    locked = [e for e in events if isinstance(e, Locked)]
    progress = [e for e in events if isinstance(e, Progress)]
    assert locked and locked[0].ref == ref("114:2")
    assert [p.words_heard for p in progress] == [4, 5, 6]
    assert [p.last_word for p in progress] == [4, 5, 6]
    assert all(p.ref == ref("114:2") for p in progress)
    assert [(p.word_start_s, p.word_end_s) for p in progress] == [
        (1.5, 2.0),
        (2.0, 2.5),
        (2.5, 3.0),
    ]


def test_nothing_is_sent_before_the_lock() -> None:
    assert not [e for e in run("m1 m2") if isinstance(e, Progress)]


def test_a_word_the_verse_does_not_explain_is_not_progress() -> None:
    events = run("m1 m2 m3 m4 zzzzz")
    assert [p.words_heard for p in events if isinstance(p, Progress)] == [4]
