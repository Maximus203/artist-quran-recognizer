"""Comblement de trou (ADR-0013) : où sont les trous, et quels textes du corpus y sont plausibles.

Logique pure (aucun modèle, aucun audio) : on part des détections finales du décodeur et on ne
formule que des HYPOTHÈSES de texte, déduites du contexte. C'est l'audio (`AcousticVerifier`) qui
décide ensuite, jamais cette couche (I3).
"""

from __future__ import annotations

import pytest

from aqr.decoding.gaps import GapConfig, Hole, find_holes, propose
from aqr.domain.models import (
    Detection,
    NonQuranKind,
    NonQuranSpan,
    Status,
    TimeSpan,
    VerseRef,
    WordSpan,
)

# Mini corpus : 12:20 (9 mots), 12:21 (23 mots), 17:74 (10 mots), 17:75 (12 mots), 17:76 (13 mots).
WORDS = {
    VerseRef(12, 20): 9,
    VerseRef(12, 21): 23,
    VerseRef(17, 74): 10,
    VerseRef(17, 75): 12,
    VerseRef(17, 76): 13,
    VerseRef(17, 77): 6,
    VerseRef(1, 1): 4,
    VerseRef(1, 2): 4,
    VerseRef(2, 87): 24,
    VerseRef(2, 88): 5,
}


class _Corpus:
    def words(self, ref: VerseRef) -> tuple[str, ...]:
        return tuple(f"w{n}" for n in range(WORDS[ref]))


def det(ref: str, first: int, last: int, start: float, end: float, status=Status.RECOGNIZED):
    ref_ = VerseRef.parse(ref)
    candidates = (ref_, VerseRef(2, 1)) if status is Status.UNCERTAIN else ()
    return Detection(
        WordSpan(ref_, first, last),
        TimeSpan(start, end) if end else None,
        status,
        0.75,
        candidates=candidates,
    )


def spans_of(hypothesis) -> list[tuple[str, int, int]]:
    return [(str(s.ref), s.first_word, s.last_word) for s in hypothesis.spans]


def by_role(hypotheses, role):
    return [h for h in hypotheses if h.role == role]


CONFIG = GapConfig()


# --- Où sont les trous --------------------------------------------------------------------------
def test_un_trou_est_l_espace_entre_deux_elements_consecutifs():
    items = [det("12:20", 1, 9, 531.66, 552.7), det("12:21", 13, 23, 578.27, 607.63)]
    holes = find_holes(items, 650.0, CONFIG)
    middle = [h for h in holes if h.before is not None and h.after is not None]
    assert [h.passage for h in middle] == [TimeSpan(552.7, 578.27)]
    assert middle[0].before is items[0] and middle[0].after is items[1]


def test_les_bords_du_fichier_sont_des_trous_a_une_seule_ancre():
    items = [det("12:20", 1, 9, 10.0, 20.0)]
    head, tail = find_holes(items, 40.0, CONFIG)
    assert (head.before, head.after) == (None, items[0]) and head.passage == TimeSpan(0.0, 10.0)
    assert (tail.before, tail.after) == (items[0], None) and tail.passage == TimeSpan(20.0, 40.0)


def test_un_trou_trop_court_n_est_pas_un_trou():
    items = [det("12:20", 1, 9, 10.0, 20.0), det("12:21", 1, 5, 20.3, 25.0)]
    assert all(h.after is None or h.before is None for h in find_holes(items, 25.0, CONFIG))


def test_un_voisin_incertain_ou_non_coranique_ferme_le_trou_sans_etre_une_ancre():
    uncertain = det("17:74", 1, 3, 30.0, 35.0, Status.UNCERTAIN)
    takbir = NonQuranSpan(TimeSpan(50.0, 52.0), NonQuranKind.TAKBIR)
    items = [det("12:20", 1, 9, 10.0, 20.0), uncertain, takbir]
    holes = {h.passage: h for h in find_holes(items, 60.0, CONFIG)}
    after_first = holes[TimeSpan(20.0, 30.0)]
    assert after_first.before is items[0] and after_first.after is None
    assert TimeSpan(35.0, 50.0) not in holes  # aucune ancre de part et d'autre : rien à déduire
    assert TimeSpan(52.0, 60.0) not in holes


def test_un_verset_infere_n_est_ni_ancre_ni_barriere():
    inferred = Detection(
        WordSpan(VerseRef(17, 75), 1, 12), TimeSpan(20.0, 40.0), Status.INFERRED, 0.0
    )
    items = [det("17:74", 1, 10, 10.0, 20.0), inferred, det("17:76", 1, 13, 40.0, 60.0)]
    middle = [h for h in find_holes(items, 60.0, CONFIG) if h.before and h.after]
    assert [h.passage for h in middle] == [TimeSpan(20.0, 40.0)]


def test_un_trou_trop_long_est_coupe_pres_de_chaque_ancre():
    items = [det("12:20", 1, 9, 100.0, 110.0), det("12:21", 1, 5, 400.0, 410.0)]
    config = GapConfig(max_search_s=60.0)
    pieces = [h for h in find_holes(items, 410.0, config) if 110.0 <= h.passage.start_s < 400.0]
    assert [(h.passage, h.before is not None, h.after is not None) for h in pieces] == [
        (TimeSpan(110.0, 170.0), True, False),
        (TimeSpan(340.0, 400.0), False, True),
    ]


def test_les_trous_sont_dans_l_ordre_du_temps():
    items = [det("12:20", 1, 9, 10.0, 20.0), det("12:21", 1, 5, 30.0, 40.0)]
    starts = [h.passage.start_s for h in find_holes(items, 60.0, CONFIG)]
    assert starts == sorted(starts)


def test_des_elements_qui_se_chevauchent_ne_creent_pas_de_trou_negatif():
    items = [det("12:20", 1, 9, 10.0, 25.0), det("12:21", 1, 5, 24.0, 40.0)]
    for hole in find_holes(items, 40.0, CONFIG):
        assert hole.passage.duration_s > 0


# --- Quels textes y sont plausibles -------------------------------------------------------------
def test_le_debut_manquant_du_verset_reconnu_est_le_verset_entier_jusqu_a_la_coupure():
    # Cas 3 (lot3-04) : 12:20 fini, puis 12:21 [13-23] reconnu ; il manque 12:21 [1-12] en entier.
    hole = Hole(
        TimeSpan(552.7, 578.27),
        det("12:20", 1, 9, 531.66, 552.7),
        det("12:21", 13, 23, 578.27, 607.63),
    )
    (between,) = by_role(propose(hole, _Corpus(), CONFIG), "between")
    assert spans_of(between) == [("12:21", 1, 12)]
    assert not between.free_end and not between.repeat


def test_la_suite_manquante_du_verset_reconnu_est_le_reste_du_verset():
    # Cas 4 : 17:74 [1-1] reconnu, 17:75 reconnu ensuite ; il manque 17:74 [2-10].
    hole = Hole(
        TimeSpan(661.81, 693.54),
        det("17:74", 1, 1, 656.95, 661.81),
        det("17:75", 1, 12, 693.54, 714.26),
    )
    hypotheses = by_role(propose(hole, _Corpus(), CONFIG), "between")
    assert ("17:74", 2, 10) in [spans_of(h)[0] for h in hypotheses]
    assert all(len(h.spans) == 1 for h in hypotheses)  # 17:75 commence au mot 1 : pas de début


def test_la_reprise_de_quelques_mots_avant_la_coupure_est_aussi_une_hypothese():
    hole = Hole(
        TimeSpan(661.81, 693.54),
        det("17:74", 1, 4, 656.95, 661.81),
        det("17:75", 1, 12, 693.54, 714.26),
    )
    firsts = {spans_of(h)[0][1] for h in by_role(propose(hole, _Corpus(), CONFIG), "between")}
    assert firsts == {5, 4, 3, 2}  # le mot 5 suit ; reprise jusqu'à 3 mots en arrière


def test_entre_deux_versets_consecutifs_le_reste_du_premier_et_le_debut_du_second():
    hole = Hole(
        TimeSpan(20.0, 30.0),
        det("17:74", 1, 6, 10.0, 20.0),
        det("17:75", 4, 12, 30.0, 40.0),
    )
    hypotheses = by_role(propose(hole, _Corpus(), CONFIG), "between")
    assert [("17:74", 7, 10), ("17:75", 1, 3)] in [spans_of(h) for h in hypotheses]


def test_un_verset_intermediaire_manquant_est_pris_en_entier():
    hole = Hole(
        TimeSpan(20.0, 60.0),
        det("17:74", 1, 10, 10.0, 20.0),
        det("17:76", 1, 13, 60.0, 80.0),
    )
    hypotheses = by_role(propose(hole, _Corpus(), CONFIG), "between")
    assert [("17:75", 1, 12)] in [spans_of(h) for h in hypotheses]


def test_trop_de_versets_manquants_ne_font_pas_une_hypothese():
    hole = Hole(
        TimeSpan(20.0, 60.0),
        det("17:74", 1, 10, 10.0, 20.0),
        det("17:77", 1, 6, 60.0, 80.0),
    )
    config = GapConfig(max_between_verses=1)
    assert by_role(propose(hole, _Corpus(), config), "between") == []


def test_mots_manquants_au_milieu_d_un_meme_verset():
    hole = Hole(
        TimeSpan(20.0, 30.0),
        det("17:76", 1, 4, 10.0, 20.0),
        det("17:76", 10, 13, 30.0, 40.0),
    )
    hypotheses = by_role(propose(hole, _Corpus(), CONFIG), "between")
    assert [spans_of(h) for h in hypotheses] == [
        [("17:76", 5, 9)],
        [("17:76", 4, 9)],
        [("17:76", 3, 9)],
        [("17:76", 2, 9)],
    ]  # le mot 5 suit ; reprise possible jusqu'à 3 mots en arrière
    assert not any(h.free_end for h in hypotheses)


def test_rien_a_combler_si_le_verset_precedent_est_fini_et_le_suivant_commence():
    hole = Hole(
        TimeSpan(20.0, 30.0),
        det("17:74", 1, 10, 10.0, 20.0),
        det("17:75", 1, 12, 30.0, 40.0),
    )
    assert by_role(propose(hole, _Corpus(), CONFIG), "between") == []


def test_apres_le_dernier_verset_reconnu_la_suite_du_verset_et_le_verset_suivant():
    hole = Hole(TimeSpan(20.0, 40.0), det("17:74", 1, 6, 10.0, 20.0), None)
    (cont, *rest) = by_role(propose(hole, _Corpus(), CONFIG), "continuation")
    assert spans_of(cont) == [("17:74", 7, 10), ("17:75", 1, 12)] and cont.free_end
    assert all(h.free_end for h in rest)


def test_le_verset_fini_n_a_pas_de_suite_mais_son_voisin_peut_suivre():
    hole = Hole(TimeSpan(20.0, 40.0), det("17:76", 1, 13, 10.0, 20.0), None)
    hypotheses = by_role(propose(hole, _Corpus(), CONFIG), "continuation")
    assert [spans_of(h) for h in hypotheses] == [[("17:77", 1, 6)]]


def test_avant_le_premier_verset_reconnu_le_debut_manquant():
    hole = Hole(TimeSpan(0.0, 2.2), None, det("1:1", 2, 4, 2.2, 9.5))
    (head,) = by_role(propose(hole, _Corpus(), CONFIG), "head")
    assert spans_of(head) == [("1:1", 1, 1)] and not head.free_end


def test_pas_de_debut_a_chercher_si_le_verset_reconnu_commence_au_mot_un():
    hole = Hole(TimeSpan(0.0, 5.0), None, det("17:75", 1, 12, 5.0, 20.0))
    assert by_role(propose(hole, _Corpus(), CONFIG), "head") == []


def test_la_repetition_du_dernier_verset_reconnu():
    # Cas 5 : 17:76 [1-13] reconnu (verset fini), puis une reprise.
    hole = Hole(TimeSpan(747.9, 783.5), det("17:76", 1, 13, 719.4, 747.9), None)
    reps = by_role(propose(hole, _Corpus(), CONFIG), "repetition")
    texts = [spans_of(h) for h in reps]
    assert [("17:76", 1, 13)] in texts  # le verset entier
    assert [("17:76", 11, 13)] in texts  # sa fin (3 mots)
    assert all(h.free_end for h in reps)
    assert all(len(h.spans) == 1 and h.repeat for h in reps)


def test_la_repetition_d_un_verset_partiel_reprend_aussi_la_plage_reconnue():
    hole = Hole(
        TimeSpan(30.0, 60.0), det("17:76", 4, 9, 10.0, 30.0), det("17:77", 1, 6, 60.0, 70.0)
    )
    texts = [spans_of(h) for h in by_role(propose(hole, _Corpus(), CONFIG), "repetition")]
    assert [("17:76", 4, 9)] in texts and [("17:76", 1, 13)] in texts


def test_un_verset_qui_redit_des_mots_du_precedent_ne_cache_aucun_milieu_manquant():
    # Cas 2 : 2:87 [1-12], puis la reprise 2:87 [9-24]. Entre les deux, le mot 13 a pu être dit.
    hole = Hole(
        TimeSpan(62.6, 66.1),
        det("2:87", 1, 12, 33.9, 62.6),
        det("2:87", 9, 24, 66.1, 103.9),
    )
    hypotheses = propose(hole, _Corpus(), CONFIG)
    assert by_role(hypotheses, "between") == [] and by_role(hypotheses, "head") == []
    continuation = by_role(hypotheses, "continuation")
    assert [spans_of(h)[0] for h in continuation] == [
        ("2:87", 13, 24),
        ("2:87", 12, 24),
        ("2:87", 11, 24),
        ("2:87", 10, 24),
    ]
    assert spans_of(continuation[0])[1] == ("2:88", 1, 5)


def test_aucune_hypothese_sans_ancre():
    assert propose(Hole(TimeSpan(0.0, 30.0), None, None), _Corpus(), CONFIG) == []


def test_les_hypotheses_se_desactivent_une_a_une():
    hole = Hole(TimeSpan(20.0, 40.0), det("17:74", 1, 6, 10.0, 20.0), None)
    off = GapConfig(repetition=False, continuation=False)
    assert propose(hole, _Corpus(), off) == []


def test_pas_de_doublon_d_hypothese():
    hole = Hole(TimeSpan(20.0, 40.0), det("17:76", 1, 13, 10.0, 20.0), None)
    keys = [(h.role, tuple(h.spans)) for h in propose(hole, _Corpus(), CONFIG)]
    assert len(keys) == len(set(keys))


@pytest.mark.parametrize("field", ["min_gap_s", "max_search_s"])
def test_la_configuration_refuse_les_durees_absurdes(field):
    with pytest.raises(ValueError):
        GapConfig(**{field: 0.0})


# --- Une reprise de mots ne vaut que si elle atteint un mot NOUVEAU -------------------------------
def test_chaque_hypothese_de_suite_dit_le_premier_mot_qu_elle_apporte():
    hole = Hole(TimeSpan(20.0, 40.0), det("17:74", 1, 6, 10.0, 20.0), None)
    firsts = {h.new_from for h in by_role(propose(hole, _Corpus(), CONFIG), "continuation")}
    assert firsts == {(VerseRef(17, 74), 7)}  # la reprise de mots 4-6 n'apporte rien avant le mot 7


def test_apres_un_verset_fini_le_mot_nouveau_est_le_debut_du_suivant():
    hole = Hole(TimeSpan(20.0, 40.0), det("17:76", 1, 13, 10.0, 20.0), None)
    (cont,) = by_role(propose(hole, _Corpus(), CONFIG), "continuation")
    assert cont.new_from == (VerseRef(17, 77), 1)


def test_entre_deux_versets_le_mot_nouveau_est_celui_qui_suit_le_dernier_reconnu():
    hole = Hole(
        TimeSpan(20.0, 30.0), det("17:74", 1, 6, 10.0, 20.0), det("17:75", 4, 12, 30.0, 40.0)
    )
    assert {h.new_from for h in by_role(propose(hole, _Corpus(), CONFIG), "between")} == {
        (VerseRef(17, 74), 7)
    }
    hole = Hole(
        TimeSpan(20.0, 30.0), det("17:74", 1, 10, 10.0, 20.0), det("17:75", 4, 12, 30.0, 40.0)
    )
    (between,) = by_role(propose(hole, _Corpus(), CONFIG), "between")
    assert between.new_from == (VerseRef(17, 75), 1)


def test_le_debut_et_la_repetition_n_ont_pas_a_atteindre_un_mot_particulier():
    head = by_role(
        propose(Hole(TimeSpan(0.0, 5.0), None, det("17:75", 4, 12, 5.0, 20.0)), _Corpus(), CONFIG),
        "head",
    )
    assert [h.new_from for h in head] == [(VerseRef(17, 75), 1)]
    hole = Hole(TimeSpan(20.0, 40.0), det("17:76", 1, 13, 10.0, 20.0), None)
    assert {h.new_from for h in by_role(propose(hole, _Corpus(), CONFIG), "repetition")} == {None}


def test_on_ne_repete_que_les_mots_deja_reconnus():
    # Cas 4 (lot3-04) : 17:74 [1-1] reconnu seulement. Sa fin n'est pas une répétition de quoi que
    # ce soit : ces mots n'ont jamais été reconnus, c'est la suite du verset.
    hole = Hole(TimeSpan(661.8, 693.5), det("17:74", 1, 1, 656.9, 661.8), None)
    texts = [spans_of(h) for h in by_role(propose(hole, _Corpus(), CONFIG), "repetition")]
    assert texts == [[("17:74", 1, 10)], [("17:74", 1, 1)]]
    fully = Hole(TimeSpan(661.8, 693.5), det("17:74", 1, 10, 650.0, 661.8), None)
    texts = [spans_of(h) for h in by_role(propose(fully, _Corpus(), CONFIG), "repetition")]
    assert [("17:74", 8, 10)] in texts and [("17:74", 5, 10)] in texts
