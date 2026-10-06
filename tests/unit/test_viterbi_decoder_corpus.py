"""Scénarios du playbook (P5-P9, F5) contre le corpus réel + propriété Hypothesis.

Sauté si le corpus n'a pas été téléchargé (`python scripts/fetch_corpus.py`).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.decoding.viterbi_decoder import ViterbiSequenceDecoder
from aqr.domain.models import Status, TimeSpan, VerseRef
from aqr.domain.ports import Candidate, WordSpan

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"

pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "LOCK.json").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)


@pytest.fixture(scope="module")
def corpus() -> TanzilCorpusRepository:
    return TanzilCorpusRepository(CORPUS_DIR)


@pytest.fixture(scope="module")
def decoder(corpus: TanzilCorpusRepository) -> ViterbiSequenceDecoder:
    return ViterbiSequenceDecoder(corpus=corpus)


@pytest.fixture(scope="module")
def all_refs_sorted(corpus: TanzilCorpusRepository) -> list[VerseRef]:
    return sorted(corpus.all_refs())


def _full_span(corpus: TanzilCorpusRepository, ref: VerseRef) -> WordSpan:
    return WordSpan(ref=ref, first_word=1, last_word=len(corpus.words(ref)))


def _obs(
    corpus: TanzilCorpusRepository, ref: VerseRef, t0: float, score: float = 1.0
) -> tuple[TimeSpan, list[Candidate]]:
    return TimeSpan(t0, t0 + 3.0), [Candidate(span=_full_span(corpus, ref), score=score)]


def test_consecutifs_67_1_2_3(corpus, decoder):  # P5
    obs = [_obs(corpus, VerseRef(67, a), i * 3.0) for i, a in enumerate([1, 2, 3])]
    dets = decoder.decode(obs).detections()
    assert [d.span.ref for d in dets] == [VerseRef(67, 1), VerseRef(67, 2), VerseRef(67, 3)]
    assert all(d.status is Status.RECOGNIZED for d in dets)


def test_trou_67_5_infere(corpus, decoder):  # P6
    obs = [_obs(corpus, VerseRef(67, 4), 0.0), _obs(corpus, VerseRef(67, 6), 6.0)]
    dets = decoder.decode(obs).detections()
    assert [(d.span.ref, d.status) for d in dets] == [
        (VerseRef(67, 4), Status.RECOGNIZED),
        (VerseRef(67, 5), Status.INFERRED),
        (VerseRef(67, 6), Status.RECOGNIZED),
    ]


def test_saut_de_sourate_1_7_puis_112_1_sans_fantome(corpus, decoder):  # P7
    obs = [_obs(corpus, VerseRef(1, a), i * 3.0) for i, a in enumerate(range(1, 8))]
    obs += [_obs(corpus, VerseRef(112, a), (7 + i) * 3.0) for i, a in enumerate(range(1, 5))]
    refs = [d.span.ref for d in decoder.decode(obs).detections()]
    assert refs == [VerseRef(1, a) for a in range(1, 8)] + [VerseRef(112, a) for a in range(1, 5)]
    assert VerseRef(2, 1) not in refs


def test_reprise_seconde_moitie_2_255_marquee_repetition(corpus, decoder):  # P8
    n = len(corpus.words(VerseRef(2, 255)))
    half = n // 2
    full = Candidate(span=WordSpan(VerseRef(2, 255), 1, n), score=1.0)
    second_half = Candidate(span=WordSpan(VerseRef(2, 255), half, n), score=0.97)
    obs = [(TimeSpan(0.0, 10.0), [full]), (TimeSpan(10.0, 14.0), [second_half])]
    dets = decoder.decode(obs).detections()
    # « deux détections marquées répétition — jamais un autre verset » (playbook P8)
    assert [d.span.ref for d in dets] == [VerseRef(2, 255), VerseRef(2, 255)]
    assert [d.is_repetition for d in dets] == [False, True]
    assert dets[0].time == TimeSpan(0.0, 10.0)
    assert dets[1].time == TimeSpan(10.0, 14.0)


def _ambiguous_candidates(corpus: TanzilCorpusRepository) -> list[Candidate]:
    ref13 = VerseRef(55, 13)
    text13 = corpus.text(ref13)
    refs = [r for r in corpus.all_refs() if r.surah == 55 and corpus.text(r) == text13]
    assert len(refs) > 5, "55:13 devrait être répété plusieurs fois dans Ar-Rahman"
    return [Candidate(span=_full_span(corpus, r), score=0.9) for r in refs]


def test_verset_ambigu_avec_contexte_bonne_occurrence(corpus, decoder):  # P9 avec contexte
    obs = [
        _obs(corpus, VerseRef(55, 12), 0.0),
        (TimeSpan(3.0, 6.0), _ambiguous_candidates(corpus)),
        _obs(corpus, VerseRef(55, 14), 6.0),
    ]
    dets = decoder.decode(obs).detections()
    assert dets[1].span.ref == VerseRef(55, 13)
    assert dets[1].status is Status.RECOGNIZED


def test_verset_ambigu_sans_contexte_incertain(corpus, decoder):  # P9 sans contexte
    obs = [(TimeSpan(0.0, 3.0), _ambiguous_candidates(corpus))]
    dets = decoder.decode(obs).detections()
    assert len(dets) == 1
    assert dets[0].status is Status.UNCERTAIN
    assert len(dets[0].candidates) >= 2


def test_mot_isole_ambigu_sans_reconnaissance(corpus, decoder):  # F5
    weak = Candidate(span=_full_span(corpus, VerseRef(18, 1)), score=0.4)
    assert decoder.decode([(TimeSpan(0.0, 1.0), [weak])]).detections() == ()


@given(start_idx=st.integers(min_value=0), length=st.integers(min_value=1, max_value=8))
@settings(
    max_examples=25, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture]
)
def test_propriete_suite_consecutive_restituee_identique(
    corpus, decoder, all_refs_sorted, start_idx, length
):
    n = len(all_refs_sorted)
    start_idx = start_idx % max(1, n - length)
    refs = all_refs_sorted[start_idx : start_idx + length]
    obs = [_obs(corpus, r, i * 3.0) for i, r in enumerate(refs)]
    dets = decoder.decode(obs).detections()
    assert [d.span.ref for d in dets] == refs
    assert all(d.status is Status.RECOGNIZED for d in dets)
