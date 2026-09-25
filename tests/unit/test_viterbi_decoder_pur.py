"""Tests purs du ViterbiSequenceDecoder (pas de corpus réel requis) : mécanique de
transition, fusion des répétitions, comblement des trous d'un seul verset.
"""

from __future__ import annotations

from aqr.decoding.viterbi_decoder import DecoderConfig, DecoderWeights, ViterbiSequenceDecoder
from aqr.domain.models import Status, TimeSpan, VerseRef
from aqr.domain.ports import Candidate, WordSpan


def _cand(ref: VerseRef, score: float = 1.0, first: int = 1, last: int = 3) -> Candidate:
    return Candidate(span=WordSpan(ref=ref, first_word=first, last_word=last), score=score)


def _decoder(**config_kwargs) -> ViterbiSequenceDecoder:
    return ViterbiSequenceDecoder(config=DecoderConfig(**config_kwargs))


def test_aucune_observation_donne_une_timeline_vide():
    timeline = _decoder().decode([])
    assert timeline.items == ()


def test_toutes_observations_sous_le_seuil_donnent_une_timeline_vide():  # F5
    weak = _cand(VerseRef(1, 1), score=0.1)
    timeline = _decoder(min_recognized_score=0.75).decode([(TimeSpan(0.0, 1.0), [weak])])
    assert timeline.detections() == ()


def test_sequence_simple_sans_ambiguite():
    obs = [
        (TimeSpan(0.0, 3.0), [_cand(VerseRef(1, 1))]),
        (TimeSpan(3.0, 6.0), [_cand(VerseRef(1, 2))]),
        (TimeSpan(6.0, 9.0), [_cand(VerseRef(1, 3))]),
    ]
    timeline = _decoder().decode(obs)
    dets = timeline.detections()
    assert [d.span.ref for d in dets] == [VerseRef(1, 1), VerseRef(1, 2), VerseRef(1, 3)]
    assert all(d.status is Status.RECOGNIZED for d in dets)


def test_trou_d_un_verset_est_marque_infere():
    obs = [
        (TimeSpan(0.0, 3.0), [_cand(VerseRef(1, 1))]),
        (TimeSpan(6.0, 9.0), [_cand(VerseRef(1, 3))]),
    ]
    timeline = _decoder().decode(obs)
    dets = timeline.detections()
    assert [(d.span.ref, d.status) for d in dets] == [
        (VerseRef(1, 1), Status.RECOGNIZED),
        (VerseRef(1, 2), Status.INFERRED),
        (VerseRef(1, 3), Status.RECOGNIZED),
    ]
    gap = dets[1]
    assert gap.time == TimeSpan(3.0, 6.0)
    assert gap.time_interpolated is True


def test_saut_arbitraire_pas_de_comblement():
    obs = [
        (TimeSpan(0.0, 3.0), [_cand(VerseRef(1, 1))]),
        (TimeSpan(3.0, 6.0), [_cand(VerseRef(2, 50))]),
    ]
    timeline = _decoder().decode(obs)
    refs = [d.span.ref for d in timeline.detections()]
    assert refs == [VerseRef(1, 1), VerseRef(2, 50)]


def test_repetitions_consecutives_fusionnees():
    obs = [
        (TimeSpan(0.0, 5.0), [_cand(VerseRef(2, 255), first=1, last=58)]),
        (TimeSpan(5.0, 8.0), [_cand(VerseRef(2, 255), score=0.9, first=30, last=58)]),
    ]
    timeline = _decoder().decode(obs)
    dets = timeline.detections()
    assert len(dets) == 1
    assert dets[0].span.first_word == 1
    assert dets[0].span.last_word == 58
    assert dets[0].time == TimeSpan(0.0, 8.0)


def test_ambiguite_marque_uncertain_avec_candidats():
    tied = [
        _cand(VerseRef(55, 13), score=0.9),
        _cand(VerseRef(55, 16), score=0.9),
        _cand(VerseRef(55, 18), score=0.9),
    ]
    timeline = _decoder().decode([(TimeSpan(0.0, 3.0), tied)])
    dets = timeline.detections()
    assert len(dets) == 1
    assert dets[0].status is Status.UNCERTAIN
    assert len(dets[0].candidates) >= 2


def test_contexte_leve_l_ambiguite():
    tied = [
        _cand(VerseRef(55, 13), score=0.9),
        _cand(VerseRef(55, 16), score=0.9),
        _cand(VerseRef(55, 18), score=0.9),
    ]
    obs = [
        (TimeSpan(0.0, 3.0), [_cand(VerseRef(55, 12), score=1.0)]),
        (TimeSpan(3.0, 6.0), tied),
    ]
    timeline = _decoder().decode(obs)
    dets = timeline.detections()
    assert dets[1].span.ref == VerseRef(55, 13)
    assert dets[1].status is Status.RECOGNIZED


def test_poids_par_defaut_sont_des_donnees_de_configuration():
    weights = DecoderWeights()
    assert (
        0.0
        < weights.arbitrary_jump
        < weights.one_verse_gap
        < weights.repetition
        <= weights.next_verse
    )
