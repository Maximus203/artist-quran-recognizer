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


def test_reprise_des_memes_mots_donne_deux_detections_la_seconde_marquee_repetition():
    obs = [
        (TimeSpan(0.0, 5.0), [_cand(VerseRef(2, 255), first=1, last=58)]),
        (TimeSpan(5.0, 8.0), [_cand(VerseRef(2, 255), score=0.9, first=30, last=58)]),
    ]
    dets = _decoder().decode(obs).detections()
    assert [d.span.ref for d in dets] == [VerseRef(2, 255), VerseRef(2, 255)]
    assert [d.is_repetition for d in dets] == [False, True]
    # Chaque passage garde SON temps : jamais l'union qui couvrirait le silence entre deux passages.
    assert dets[0].time == TimeSpan(0.0, 5.0)
    assert dets[1].time == TimeSpan(5.0, 8.0)
    assert (dets[1].span.first_word, dets[1].span.last_word) == (30, 58)


def test_deux_moities_contigues_proches_dans_le_temps_sont_fusionnees():
    obs = [
        (TimeSpan(0.0, 3.0), [_cand(VerseRef(2, 255), first=1, last=6)]),
        (TimeSpan(3.5, 6.0), [_cand(VerseRef(2, 255), first=7, last=12)]),
    ]
    dets = _decoder().decode(obs).detections()
    assert len(dets) == 1
    assert (dets[0].span.first_word, dets[0].span.last_word) == (1, 12)
    assert dets[0].time == TimeSpan(0.0, 6.0)
    assert dets[0].is_repetition is False


def test_deux_moities_separees_par_un_long_intervalle_ne_sont_pas_fusionnees():
    # 5 minutes d'autre chose entre les deux : l'union couvrirait des passages non reconnus.
    obs = [
        (TimeSpan(0.0, 3.0), [_cand(VerseRef(2, 255), first=1, last=6)]),
        (TimeSpan(300.0, 303.0), [_cand(VerseRef(2, 255), first=7, last=12)]),
    ]
    dets = _decoder(merge_max_gap_s=5.0).decode(obs).detections()
    assert len(dets) == 2
    assert [d.time for d in dets] == [TimeSpan(0.0, 3.0), TimeSpan(300.0, 303.0)]
    assert [d.is_repetition for d in dets] == [False, False]


def test_trou_d_un_verset_non_infere_apres_un_long_intervalle():
    obs = [
        (TimeSpan(0.0, 3.0), [_cand(VerseRef(67, 4))]),
        (TimeSpan(900.0, 903.0), [_cand(VerseRef(67, 6))]),
    ]
    dets = _decoder(infer_max_gap_s=180.0).decode(obs).detections()
    assert [d.span.ref for d in dets] == [VerseRef(67, 4), VerseRef(67, 6)]
    assert all(d.status is Status.RECOGNIZED for d in dets)


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


# --- Candidats multi-versets (phase 2b, ADR-0004) ----------------------------
def _multi(refs: list[VerseRef], counts: list[int], score: float = 1.0) -> Candidate:
    spans = [WordSpan(ref=r, first_word=1, last_word=c) for r, c in zip(refs, counts, strict=True)]
    return Candidate(
        span=spans[0], score=score, continuation=tuple(spans[1:]), query_counts=tuple(counts)
    )


def test_candidat_multi_versets_donne_une_detection_par_verset():
    refs = [VerseRef(112, 1), VerseRef(112, 2)]
    timeline = _decoder().decode([(TimeSpan(0.0, 6.0), [_multi(refs, [2, 4])])])
    dets = timeline.detections()
    assert [d.span.ref for d in dets] == refs
    assert all(d.status is Status.RECOGNIZED for d in dets)
    assert dets[0].time == TimeSpan(0.0, 2.0)  # temps réparti au prorata des mots
    assert dets[1].time == TimeSpan(2.0, 6.0)
    assert all(d.time_interpolated for d in dets)


def test_candidat_multi_versets_enchaine_avec_le_verset_suivant():
    obs = [
        (TimeSpan(0.0, 6.0), [_multi([VerseRef(112, 1), VerseRef(112, 2)], [4, 2])]),
        (TimeSpan(6.0, 9.0), [_cand(VerseRef(112, 3))]),
    ]
    dets = _decoder().decode(obs).detections()
    assert [d.span.ref for d in dets] == [VerseRef(112, 1), VerseRef(112, 2), VerseRef(112, 3)]
    assert all(d.status is Status.RECOGNIZED for d in dets)


def test_deux_moities_du_meme_verset_sont_fusionnees():  # waqf
    ref = VerseRef(2, 255)
    obs = [
        (TimeSpan(0.0, 3.0), [_cand(ref, first=1, last=6)]),
        (TimeSpan(3.0, 6.0), [_cand(ref, first=7, last=12)]),
    ]
    dets = _decoder().decode(obs).detections()
    assert len(dets) == 1
    assert (dets[0].span.first_word, dets[0].span.last_word) == (1, 12)


def test_candidats_multi_versets_proches_donnent_uncertain():
    a = _multi([VerseRef(112, 1), VerseRef(112, 2)], [4, 2], score=0.9)
    b = _multi([VerseRef(2, 255), VerseRef(2, 256)], [4, 2], score=0.9)
    dets = _decoder().decode([(TimeSpan(0.0, 6.0), [a, b])]).detections()
    assert dets and all(d.status is Status.UNCERTAIN for d in dets)
    assert all(len(d.candidates) >= 2 for d in dets)


def test_deux_moities_separees_par_une_observation_ecartee_ne_fusionnent_pas():
    # Une fenêtre sans candidat viable (parole non reconnue) entre les deux moitiés : l'union des
    # temps la couvrirait. Elle fait barrière, même si l'écart est inférieur à merge_max_gap_s.
    obs = [
        (TimeSpan(0.0, 3.0), [_cand(VerseRef(2, 255), first=1, last=6)]),
        (TimeSpan(3.0, 4.0), []),
        (TimeSpan(4.0, 7.0), [_cand(VerseRef(2, 255), first=7, last=12)]),
    ]
    dets = _decoder(merge_max_gap_s=5.0).decode(obs).detections()
    assert [d.time for d in dets] == [TimeSpan(0.0, 3.0), TimeSpan(4.0, 7.0)]
    assert [d.is_repetition for d in dets] == [False, False]


def test_observation_ecartee_hors_de_l_intervalle_ne_bloque_pas_la_fusion():
    obs = [
        (TimeSpan(0.0, 3.0), [_cand(VerseRef(2, 255), first=1, last=6)]),
        (TimeSpan(3.2, 6.0), [_cand(VerseRef(2, 255), first=7, last=12)]),
        (TimeSpan(20.0, 22.0), []),
    ]
    assert len(_decoder().decode(obs).detections()) == 1


def test_temps_mesures_par_alignement_remplacent_les_bords_de_fenetre():  # ADR-0008
    measured = Candidate(
        span=WordSpan(VerseRef(55, 2), 1, 2),
        score=0.9,
        continuation=(WordSpan(VerseRef(55, 3), 1, 2),),
        times=(TimeSpan(6.7, 9.3), TimeSpan(9.6, 12.2)),
    )
    (first, second) = _decoder().decode([(TimeSpan(6.0, 13.0), [measured])]).detections()
    assert (first.time, second.time) == (TimeSpan(6.7, 9.3), TimeSpan(9.6, 12.2))
    assert not first.time_interpolated and not second.time_interpolated


def test_sans_temps_mesures_le_partage_au_prorata_reste_estime():
    cand = Candidate(
        span=WordSpan(VerseRef(55, 2), 1, 2),
        score=0.9,
        continuation=(WordSpan(VerseRef(55, 3), 1, 2),),
    )
    dets = _decoder().decode([(TimeSpan(0.0, 4.0), [cand])]).detections()
    assert [d.time for d in dets] == [TimeSpan(0.0, 2.0), TimeSpan(2.0, 4.0)]
    assert all(d.time_interpolated for d in dets)
    assert all(not d.word_times for d in dets)  # jamais de temps au mot inventé


# --- Temps au mot (ADR-0010) --------------------------------------------------------------------
def _timed(ref: VerseRef, first: int, last: int, start: float, step: float = 0.5) -> Candidate:
    """Candidat dont l'alignement a mesuré chaque mot (`step` secondes par mot)."""
    words = tuple(
        TimeSpan(start + n * step, start + (n + 1) * step) for n in range(last - first + 1)
    )
    return Candidate(
        span=WordSpan(ref, first, last),
        score=0.9,
        times=(TimeSpan(words[0].start_s, words[-1].end_s),),
        word_times=(words,),
    )


def test_les_temps_au_mot_mesures_passent_dans_la_detection():
    obs = [(TimeSpan(0.0, 4.0), [_timed(VerseRef(55, 5), 1, 3, 0.4)])]
    (det,) = _decoder().decode(obs).detections()
    assert det.word_times == (TimeSpan(0.4, 0.9), TimeSpan(0.9, 1.4), TimeSpan(1.4, 1.9))
    assert det.time == TimeSpan(0.4, 1.9)


def test_les_temps_au_mot_d_un_candidat_a_plusieurs_versets_vont_a_chaque_verset():
    cand = Candidate(
        span=WordSpan(VerseRef(55, 2), 1, 2),
        score=0.9,
        continuation=(WordSpan(VerseRef(55, 3), 1, 2),),
        times=(TimeSpan(6.7, 7.7), TimeSpan(9.6, 10.6)),
        word_times=(
            (TimeSpan(6.7, 7.2), TimeSpan(7.2, 7.7)),
            (TimeSpan(9.6, 10.1), TimeSpan(10.1, 10.6)),
        ),
    )
    first, second = _decoder().decode([(TimeSpan(6.0, 11.0), [cand])]).detections()
    assert [len(d.word_times) for d in (first, second)] == [2, 2]
    assert second.word_times[0] == TimeSpan(9.6, 10.1)


def test_deux_moities_contigues_fusionnees_mettent_leurs_temps_au_mot_bout_a_bout():
    obs = [
        (TimeSpan(0.0, 3.0), [_timed(VerseRef(2, 255), 1, 6, 0.0)]),
        (TimeSpan(3.2, 6.0), [_timed(VerseRef(2, 255), 7, 12, 3.2)]),
    ]
    (det,) = _decoder().decode(obs).detections()
    assert (det.span.first_word, det.span.last_word) == (1, 12)
    assert len(det.word_times) == 12
    assert det.word_times[0].start_s == det.time.start_s
    assert det.word_times[-1].end_s == det.time.end_s


def test_une_fusion_avec_un_mot_perdu_au_raccord_ne_garde_aucun_temps_au_mot():
    obs = [
        (TimeSpan(0.0, 3.0), [_timed(VerseRef(2, 255), 1, 6, 0.0)]),
        (TimeSpan(3.2, 6.0), [_timed(VerseRef(2, 255), 8, 12, 3.2)]),  # le mot 7 n'a pas de temps
    ]
    (det,) = _decoder().decode(obs).detections()
    assert (det.span.first_word, det.span.last_word) == (1, 12) and det.word_times == ()


def test_une_fusion_dont_une_moitie_n_a_pas_de_temps_au_mot_n_en_garde_aucun():
    obs = [
        (TimeSpan(0.0, 3.0), [_timed(VerseRef(2, 255), 1, 6, 0.0)]),
        (TimeSpan(3.2, 6.0), [_cand(VerseRef(2, 255), first=7, last=12)]),
    ]
    (det,) = _decoder().decode(obs).detections()
    assert det.word_times == ()


def test_deux_moities_dont_les_fenetres_se_recouvrent_ne_donnent_aucun_chevauchement():
    # cas réel (vitesse ×0,3, Alafasy 67:26) : le mot 6 commence 50 ms avant la fin du mot 5
    obs = [
        (TimeSpan(0.0, 3.1), [_timed(VerseRef(2, 255), 1, 6, 0.0)]),
        (TimeSpan(2.95, 6.0), [_timed(VerseRef(2, 255), 7, 12, 2.95)]),
    ]
    (det,) = _decoder().decode(obs).detections()
    assert len(det.word_times) == 12
    assert all(
        a.end_s <= b.start_s for a, b in zip(det.word_times, det.word_times[1:], strict=False)
    )
    assert det.word_times[0].start_s == det.time.start_s
    assert det.word_times[-1].end_s == det.time.end_s


def test_un_recouvrement_grossier_des_moities_ne_garde_aucun_temps_au_mot():
    obs = [
        (TimeSpan(0.0, 3.0), [_timed(VerseRef(2, 255), 1, 6, 0.0)]),
        (TimeSpan(1.0, 6.0), [_timed(VerseRef(2, 255), 7, 12, 1.0)]),
    ]
    (det,) = _decoder().decode(obs).detections()
    assert (det.span.first_word, det.span.last_word) == (1, 12) and det.word_times == ()


# --- Détections venues d'ailleurs que du Viterbi (comblement de trou, ADR-0013) -------------------
def _det(ref, first, last, start, end, **kwargs):
    from aqr.domain.models import Detection, WordSpan

    return Detection(
        WordSpan(ref, first, last), TimeSpan(start, end), Status.RECOGNIZED, 0.75, **kwargs
    )


def _words(start, count):
    return tuple(TimeSpan(start + 0.5 * n, start + 0.5 * (n + 1)) for n in range(count))


V = VerseRef(12, 21)


def test_un_debut_ajoute_avant_la_suite_reconnue_fusionne_avec_elle():
    # Cas 3 (lot3-04) : 12:21 [13-23] reconnu, son début [1-12] comblé juste avant.
    tail = _det(V, 13, 23, 578.27, 607.63, word_times=_words(578.27, 11))
    head = _det(V, 1, 12, 556.0, 577.9, word_times=_words(556.0, 12), promoted_by="gap")
    out = _decoder().integrate([tail], [head], barriers=[])
    (merged,) = out
    assert (merged.span.first_word, merged.span.last_word) == (1, 23)
    assert merged.time == TimeSpan(556.0, 607.63)
    assert len(merged.word_times) == 23 and merged.promoted_by == "gap"
    assert merged.status is Status.RECOGNIZED and not merged.is_repetition


def test_une_suite_ajoutee_apres_le_verset_reconnu_fusionne_avec_lui():
    # Cas 2 : 2:87 [1-12] reconnu, le mot 13 dit juste après.
    before = _det(VerseRef(2, 87), 1, 12, 33.9, 62.6, word_times=_words(33.9, 12))
    word = _det(VerseRef(2, 87), 13, 13, 62.9, 63.8, word_times=_words(62.9, 1), promoted_by="gap")
    (merged,) = _decoder().integrate([before], [word], barriers=[])
    assert (merged.span.first_word, merged.span.last_word) == (1, 13)
    assert merged.time == TimeSpan(33.9, 63.8) and merged.promoted_by == "gap"


def test_les_detections_ajoutees_gardent_l_ordre_du_temps():
    a = _det(VerseRef(17, 73), 1, 10, 10.0, 20.0)
    c = _det(VerseRef(17, 75), 1, 12, 60.0, 70.0)
    b = _det(VerseRef(17, 74), 1, 10, 30.0, 50.0, promoted_by="gap")
    out = _decoder().integrate([a, c], [b], barriers=[])
    assert [d.span.ref.ayah for d in out] == [73, 74, 75]


def test_des_mots_redits_sont_marques_repetition_sans_fusion():
    # Cas 5 : 17:76 reconnu, puis redit en entier.
    first = _det(VerseRef(17, 76), 1, 13, 719.4, 747.9)
    again = _det(VerseRef(17, 76), 1, 13, 760.0, 779.0, promoted_by="gap")
    out = _decoder().integrate([first], [again], barriers=[])
    assert [(d.span.first_word, d.is_repetition) for d in out] == [(1, False), (1, True)]
    assert out[1].promoted_by == "gap"


def test_la_reprise_apres_un_ajout_est_marquee_repetition():
    # 2:87 [1-12] + mot 13 ajouté, puis la reprise [9-24] déjà marquée par le décodeur
    before = _det(VerseRef(2, 87), 1, 12, 33.9, 62.6)
    word = _det(VerseRef(2, 87), 13, 13, 62.9, 63.8, promoted_by="gap")
    reprise = _det(VerseRef(2, 87), 9, 24, 66.1, 103.9)
    out = _decoder().integrate([before, reprise], [word], barriers=[])
    assert [(d.span.first_word, d.span.last_word, d.is_repetition) for d in out] == [
        (1, 13, False),
        (9, 24, True),
    ]


def test_un_long_silence_entre_l_ajout_et_son_voisin_empeche_la_fusion():
    tail = _det(V, 13, 23, 578.27, 607.63)
    head = _det(V, 1, 12, 500.0, 520.0, promoted_by="gap")
    out = _decoder(merge_max_gap_s=5.0).integrate([tail], [head], barriers=[])
    assert [(d.span.first_word, d.span.last_word) for d in out] == [(1, 12), (13, 23)]


def test_une_observation_ecartee_entre_les_deux_empeche_la_fusion():
    tail = _det(V, 13, 23, 578.27, 607.63)
    head = _det(V, 1, 12, 556.0, 570.0, promoted_by="gap")
    barrier = TimeSpan(571.0, 577.0)
    out = _decoder().integrate([tail], [head], barriers=[barrier])
    assert len(out) == 2


def test_les_autres_detections_ne_sont_jamais_touchees():
    other = _det(VerseRef(5, 55), 1, 13, 242.0, 274.0)
    twin = _det(VerseRef(5, 55), 14, 15, 274.5, 280.0)  # deux moitiés que le décodeur a laissées
    head = _det(V, 1, 12, 556.0, 577.9, promoted_by="gap")
    out = _decoder().integrate([other, twin], [head], barriers=[])
    assert out[:2] == [other, twin]


def test_integrer_sans_ajout_rend_les_memes_detections():
    a = _det(V, 1, 12, 10.0, 20.0)
    assert _decoder().integrate([a], [], barriers=[]) == [a]


def test_un_ajout_n_est_raccorde_qu_aux_mots_contigus():
    # l'ajout [1-8] et le voisin [11-18] : les mots 9 et 10 manquent, personne ne les a entendus
    tail = _det(V, 11, 18, 578.27, 607.63)
    head = _det(V, 1, 8, 556.0, 570.0, promoted_by="gap")
    out = _decoder().integrate([tail], [head], barriers=[])
    assert [(d.span.first_word, d.span.last_word) for d in out] == [(1, 8), (11, 18)]
    # alors que le décodeur, lui, raccorde deux moitiés proches sans exiger la contiguïté
    obs = [
        (TimeSpan(0.0, 3.0), [_cand(VerseRef(2, 255), first=1, last=6)]),
        (TimeSpan(3.2, 6.0), [_cand(VerseRef(2, 255), first=9, last=12)]),
    ]
    (det,) = _decoder().decode(obs).detections()
    assert (det.span.first_word, det.span.last_word) == (1, 12)
