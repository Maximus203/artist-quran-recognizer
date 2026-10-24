"""Du suivi aux messages `aqr.live/1` : le texte vient du corpus, jamais d'un modèle (I1-I3)."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.domain.models import Status, VerseRef
from aqr.domain.ports import Translation
from aqr.live.content import LiveContent
from aqr.live.corpus_flow import load_prefix_index
from aqr.live.events import (
    BasmalaHeard,
    CandidateItem,
    Candidates,
    Continue,
    DegradationChanged,
    HypothesisClass,
    Jump,
    Locked,
    Lost,
    PartialTranscript,
    Revision,
    Unresolved,
)
from aqr.live.presenter import LivePresenter
from aqr.rendering.home_renderer import HomeRenderer

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"
pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "quran-uthmani.txt").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)
ARABIC = re.compile("[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")


class FakeTranslations:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail

    def get(self, ref: VerseRef, translation_id: str) -> Translation:
        if self.fail:
            raise OSError("réseau coupé")
        return Translation(
            ref=ref,
            text=f"Traduction de {ref}.[1]",
            translation_id=translation_id,
            version="v-test",
            attribution="QuranEnc.com — test",
        )


@pytest.fixture(scope="module")
def corpus() -> TanzilCorpusRepository:
    return TanzilCorpusRepository(CORPUS_DIR)


@pytest.fixture(scope="module")
def index():  # type: ignore[no-untyped-def]
    return load_prefix_index(CORPUS_DIR)[0]


def make(corpus, index, *, technical=False, translation="french_hameedullah", fail=False):  # type: ignore[no-untyped-def]
    renderer = HomeRenderer(corpus, FakeTranslations(fail))
    return LivePresenter(LiveContent(index, corpus, renderer), translation, technical=technical)


def ref(text: str) -> VerseRef:
    return VerseRef.parse(text)


def item(r: str, posterior: float = 0.5, matched: int = 2, nxt: int | None = 3, first: int = 1):  # type: ignore[no-untyped-def]
    return CandidateItem(ref(r), posterior, HypothesisClass.START, matched, nxt, first)


def candidates(items, *, shared=2, count=None, sources=None, leader=None):  # type: ignore[no-untyped-def]
    refs = [i.ref for i in items]
    return Candidates(
        t=3.0,
        start_s=1.0,
        end_s=2.5,
        words_heard=2,
        count=len(items) if count is None else count,
        items=tuple(items),
        leader=leader or refs[0],
        leader_posterior=items[0].posterior,
        shared_words=shared,
        non_quran_posterior=0.01,
        sources=tuple((i.ref, i.first_word) for i in items) if sources is None else sources,
    )


def locked(r="112:1", *, status=Status.RECOGNIZED, basis="words", first=1, repetition=False):  # type: ignore[no-untyped-def]
    return Locked(
        t=6.0,
        ref=ref(r),
        status=status,
        identity_basis=basis,
        words_heard=3,
        first_word=first,
        posterior=0.99,
        start_s=2.0,
        end_s=5.5,
        repetition=repetition,
    )


def only(messages):  # type: ignore[no-untyped-def]
    assert len(messages) == 1, messages
    return messages[0]


# --------------------------------------------------------------------------- CANDIDATES
def test_candidates_show_the_common_heard_text_from_the_corpus(corpus, index) -> None:  # type: ignore[no-untyped-def]
    presenter = make(corpus, index)
    # 55:13 et 55:16 : le refrain d'Ar-Rahman, mots identiques de bout en bout
    event = candidates([item("55:13"), item("55:16")], shared=2)
    message = only(presenter.present(event))
    assert message.type == "CANDIDATES"
    assert message.t == 3.0
    body = message.fields
    assert body["state"] == "ambiguous"
    assert body["count"] == 2
    assert body["words_heard"] == 2
    assert body["span"] == [1.0, 2.5]
    assert body["heard"]["words"] == [1, 2]
    expected = " ".join(corpus.words(ref("55:13"))[:2])
    assert body["heard"]["text"] == expected
    assert body["leader"]["ref"] == "55:13"


def test_the_common_text_is_withheld_when_a_candidate_spells_the_words_differently(
    corpus, index
) -> None:  # type: ignore[no-untyped-def]
    presenter = make(corpus, index)
    event = candidates([item("112:1", first=1), item("112:2", first=1)], shared=1)
    body = only(presenter.present(event)).fields
    assert body["heard"] == {"words": [1, 1]}  # compte seulement, jamais de texte non vérifié


def test_the_common_text_is_withheld_when_not_every_candidate_could_be_compared(
    corpus, index
) -> None:  # type: ignore[no-untyped-def]
    presenter = make(corpus, index)
    event = candidates([item("55:13"), item("55:16")], shared=2, count=88, sources=())
    body = only(presenter.present(event)).fields
    assert "text" not in body["heard"]
    assert body["count"] == 88


def test_no_common_words_means_no_heard_block(corpus, index) -> None:  # type: ignore[no-untyped-def]
    presenter = make(corpus, index)
    body = only(presenter.present(candidates([item("55:13"), item("112:1")], shared=0))).fields
    assert body["heard"] is None
    assert not ARABIC.search(json.dumps({k: v for k, v in body.items() if k != "items"}))


def test_next_word_uses_corpus_ranks_and_the_corpus_spelling(corpus, index) -> None:  # type: ignore[no-untyped-def]
    presenter = make(corpus, index)
    # 112:1 : le rang 1 du flux est le 5e mot du corpus (la basmala du verset 1 sort du flux)
    event = candidates([item("112:1", matched=1, nxt=2, first=1), item("113:1", nxt=2)], shared=1)
    items = only(presenter.present(event)).fields["items"]
    assert items[0]["ref"] == "112:1"
    assert items[0]["next_word"]["index"] == 6
    assert items[0]["next_word"]["text"] == corpus.words(ref("112:1"))[5]
    assert items[0]["class"] == "start"
    assert isinstance(items[0]["posterior"], float)


def test_a_finished_candidate_has_no_next_word(corpus, index) -> None:  # type: ignore[no-untyped-def]
    presenter = make(corpus, index)
    event = candidates([item("112:2", nxt=None), item("55:13")], shared=0)
    assert only(presenter.present(event)).fields["items"][0]["next_word"] is None


def test_the_leader_basis_follows_the_hypothesis_class(corpus, index) -> None:  # type: ignore[no-untyped-def]
    presenter = make(corpus, index)
    follow = CandidateItem(ref("112:2"), 0.9, HypothesisClass.CONTINUE, 1, 2, 1)
    body = only(presenter.present(candidates([follow, item("55:13")], shared=0))).fields
    assert body["leader"] == {"ref": "112:2", "posterior": 0.9, "basis": "context"}
    fresh = only(presenter.present(candidates([item("55:13"), follow], shared=0))).fields
    assert fresh["leader"]["basis"] == "words"


# --------------------------------------------------------------------------- LOCKED / CONTINUE
def test_locked_names_the_verse_with_corpus_text_and_untouched_translation(corpus, index) -> None:  # type: ignore[no-untyped-def]
    presenter = make(corpus, index)
    message = only(presenter.present(locked("112:2")))
    interval = message.fields["interval"]
    assert message.type == "LOCKED"
    assert interval["kind"] == "verse"
    assert interval["ref"] == "112:2"
    assert interval["status"] == "recognized"
    assert interval["identity_basis"] == "words"
    assert interval["words_heard"] == 3
    assert interval["t"] == [2.0, None]
    assert interval["text"] == corpus.text(ref("112:2"))
    assert interval["words"] == [1, 2]
    assert interval["partial"] is False
    assert interval["candidates"] == []
    assert interval["translation"]["text"] == "Traduction de 112:2.[1]"
    assert interval["translation"]["translation_id"] == "french_hameedullah"
    assert interval["translation"]["attribution"] == "QuranEnc.com — test"
    assert "word_times" not in interval


def test_locked_after_a_basmala_prefix_uses_corpus_ranks(corpus, index) -> None:  # type: ignore[no-untyped-def]
    """Le suivi compte à partir du rang 1 du flux ; le contrat d'`aqr.recognition/1` compte les
    mots du corpus, basmala comprise : 112:1 entendu depuis son 1er mot de flux = mot 5."""
    interval = only(make(corpus, index).present(locked("112:1", first=1))).fields["interval"]
    assert interval["partial"] is True
    assert interval["words"] == [5, 8]
    assert interval["text"] == " ".join(corpus.text(ref("112:1")).split()[4:])


def test_an_inferred_lock_is_marked_as_context_not_heard(corpus, index) -> None:  # type: ignore[no-untyped-def]
    event = locked("55:16", status=Status.INFERRED, basis="context")
    interval = only(make(corpus, index).present(event)).fields["interval"]
    assert interval["status"] == "inferred"
    assert interval["identity_basis"] == "context"


def test_a_lock_without_translation_option_carries_none(corpus, index) -> None:  # type: ignore[no-untyped-def]
    interval = only(make(corpus, index, translation=None).present(locked())).fields["interval"]
    assert interval["translation"] is None


def test_a_translation_failure_never_blocks_the_lock(corpus, index) -> None:  # type: ignore[no-untyped-def]
    interval = only(make(corpus, index, fail=True).present(locked())).fields["interval"]
    assert interval["translation"] is None
    assert interval["translation_unavailable"] is True
    assert interval["text"] == " ".join(corpus.text(ref("112:1")).split()[4:])


def _continue(
    r="112:1", *, first=1, last=4, complete=True, expected="112:2", status=Status.RECOGNIZED
):  # type: ignore[no-untyped-def]
    return Continue(
        t=9.0,
        ref=ref(r),
        status=status,
        identity_basis="words",
        first_word=first,
        last_word=last,
        start_s=2.0,
        end_s=8.5,
        complete=complete,
        expected=(ref(expected),) if expected else (),
    )


def test_continue_closes_the_interval_and_announces_the_next_verse(corpus, index) -> None:  # type: ignore[no-untyped-def]
    presenter = make(corpus, index)
    presenter.present(locked("112:1"))
    message = only(presenter.present(_continue()))
    body = message.fields
    assert message.type == "CONTINUE"
    assert body["closed"]["t"] == [2.0, 8.5]
    assert body["closed"]["ref"] == "112:1"
    assert body["closed"]["words"] == [5, 8]
    assert body["closed"]["confidence"] == pytest.approx(0.99, abs=1e-3)
    assert body["complete"] is True
    assert body["expected"] == {"ref": "112:2"}


def test_a_passage_cut_short_is_not_presented_as_the_whole_verse(corpus, index) -> None:  # type: ignore[no-untyped-def]
    presenter = make(corpus, index)
    presenter.present(locked("112:1"))
    body = only(presenter.present(_continue(last=2, complete=False))).fields
    assert body["complete"] is False
    assert body["closed"]["words"] == [5, 6]
    assert body["closed"]["partial"] is True


def test_the_end_of_the_quran_has_no_expected_verse(corpus, index) -> None:  # type: ignore[no-untyped-def]
    body = only(
        make(corpus, index).present(_continue("114:6", first=1, last=3, expected=""))
    ).fields
    assert body["expected"] is None


# --------------------------------------------------------------------------- JUMP / GAP / LOST
def test_a_jump_after_a_named_verse_is_a_jump(corpus, index) -> None:  # type: ignore[no-untyped-def]
    presenter = make(corpus, index)
    presenter.present(locked("112:1"))
    presenter.present(_continue())
    message = only(presenter.present(Jump(12.0, ref("112:1"), "other_surah")))
    assert message.type == "JUMP"
    assert message.fields == {
        "from": "112:1",
        "reason": "mismatch_with_expected",
        "kind": "other_surah",
    }


def test_a_jump_after_an_unnamed_passage_is_a_gap(corpus, index) -> None:  # type: ignore[no-untyped-def]
    presenter = make(corpus, index)
    presenter.present(
        Unresolved(
            t=9.0,
            candidates=(ref("55:13"), ref("55:16"), ref("55:18")),
            words_heard=5,
            start_s=1.0,
            end_s=8.0,
        )
    )
    message = only(presenter.present(Jump(12.0, ref("55:13"), "skip")))
    assert message.type == "GAP"
    assert message.fields["reason"] == "previous_unnamed"
    assert message.fields["after"]["candidates"] == ["55:13", "55:16", "55:18"]
    assert message.fields["after"]["count"] == 3
    assert message.fields["after"]["span"] == [1.0, 8.0]
    assert "kind" not in message.fields


def test_a_jump_after_a_loss_is_a_gap(corpus, index) -> None:  # type: ignore[no-untyped-def]
    presenter = make(corpus, index)
    presenter.present(locked("112:1"))
    presenter.present(_continue())
    presenter.present(Lost(15.0, "silence"))
    assert only(presenter.present(Jump(20.0, ref("112:1"), "skip"))).type == "GAP"


def test_lost_carries_its_reason(corpus, index) -> None:  # type: ignore[no-untyped-def]
    message = only(make(corpus, index).present(Lost(15.0, "non_quran")))
    assert (message.type, message.t, message.fields) == ("LOST", 15.0, {"reason": "non_quran"})


# --------------------------------------------------------------------------- UNCERTAIN (I3)
def test_an_unresolved_passage_lists_references_only_never_text(corpus, index) -> None:  # type: ignore[no-untyped-def]
    event = Unresolved(
        t=9.0, candidates=(ref("55:13"), ref("55:16")), words_heard=5, start_s=1.0, end_s=8.0
    )
    message = only(make(corpus, index).present(event))
    assert message.type == "UNCERTAIN"
    assert message.fields["candidates"] == ["55:13", "55:16"]
    assert message.fields["count"] == 2
    assert not ARABIC.search(json.dumps(message.fields, ensure_ascii=False))
    assert "translation" not in message.fields


def test_unnamed_candidates_never_carry_a_translation(corpus, index) -> None:  # type: ignore[no-untyped-def]
    event = candidates([item("55:13"), item("55:16")], shared=0)
    text = json.dumps(only(make(corpus, index).present(event)).fields, ensure_ascii=False)
    assert "Traduction" not in text


# --------------------------------------------------------------------------- autres événements
def test_a_revision_retracts_without_hiding(corpus, index) -> None:  # type: ignore[no-untyped-def]
    presenter = make(corpus, index)
    presenter.present(locked("112:1"))
    message = only(presenter.present(Revision(8.0, ref("112:1"), "contradicted")))
    assert message.type == "REVISION"
    assert message.fields == {"ref": "112:1", "status": "retracted", "reason": "contradicted"}


def test_the_partial_transcript_is_for_technical_mode_only(corpus, index) -> None:  # type: ignore[no-untyped-def]
    event = PartialTranscript(4.0, 3.2, 3.9, "قل هو")
    assert make(corpus, index, technical=False).present(event) == []
    message = only(make(corpus, index, technical=True).present(event))
    assert message.type == "PARTIAL"
    assert message.fields == {"span": [3.2, 3.9], "text": "قل هو", "stable": False}


def test_degradation_is_said_explicitly(corpus, index) -> None:  # type: ignore[no-untyped-def]
    event = DegradationChanged(
        t=30.0,
        tier=1,
        overloaded=True,
        lag_s=6.5,
        skipped=("acoustic",),
        reason="overload",
        min_words_lock=5,
        tau_lock=0.995,
    )
    message = only(make(corpus, index).present(event))
    assert message.type == "DEGRADED"
    assert message.fields["overloaded"] is True
    assert message.fields["tier"] == 1
    assert message.fields["skipped"] == ["acoustic"]
    assert message.fields["lock_rule"] == {"min_words_lock": 5, "tau_lock": 0.995}


def test_a_basmala_is_read_from_the_corpus(corpus, index) -> None:  # type: ignore[no-untyped-def]
    message = only(make(corpus, index).present(BasmalaHeard(2.0)))
    assert message.type == "BASMALA"
    assert message.fields["ref"] == "1:1"
    assert message.fields["text"] == corpus.text(ref("1:1"))
    assert message.fields["translation"]["text"] == "Traduction de 1:1.[1]"
