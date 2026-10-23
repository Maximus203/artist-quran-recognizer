"""HypothesisTracker (ADR-0011, étape 1) : suivi d'hypothèses de position, mot après mot.

Corpus réduit à l'échelle d'un jouet, plus un verset de remplissage de 5 000 mots distincts :
le vocabulaire doit être assez large pour que « mot sans rapport » soit réellement improbable,
comme dans le Coran (environ 14 000 mots distincts).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TypeVar

import pytest
from tests.support.live_toy import Clock, ref, toy_index

from aqr.domain.models import Status
from aqr.domain.ports import HeardWord
from aqr.live.config import LiveConfig
from aqr.live.events import (
    BasmalaHeard,
    Candidates,
    Continue,
    HypothesisClass,
    Jump,
    LiveEvent,
    Locked,
    Lost,
    Revision,
    Unresolved,
)
from aqr.live.prefix_index import PrefixIndex
from aqr.live.tracker import HypothesisTracker


@pytest.fixture(scope="module")
def index() -> PrefixIndex:
    return toy_index()


def new_tracker(index: PrefixIndex, **changes: float) -> HypothesisTracker:
    return HypothesisTracker(index, LiveConfig().replace(**changes))


def feed(tracker: HypothesisTracker, words: Sequence[HeardWord]) -> list[list[LiveEvent]]:
    return [tracker.feed(word) for word in words]


def flat(batches: Sequence[Sequence[LiveEvent]]) -> list[LiveEvent]:
    return [event for batch in batches for event in batch]


E = TypeVar("E")


def of_type(events: Sequence[LiveEvent], kind: type[E]) -> list[E]:
    return [e for e in events if isinstance(e, kind)]


# --------------------------------------------------------------------------- candidats
def test_le_premier_mot_ouvre_des_candidats_sans_verrou(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    batches = feed(tracker, Clock().say("aa"))
    candidates = of_type(batches[0], Candidates)
    assert len(candidates) == 1
    assert candidates[0].count == 3  # 112:1, 113:1 et 113:5 commencent par « aa »
    assert candidates[0].words_heard == 1
    assert not of_type(flat(batches), Locked)


def test_un_mot_commun_a_plusieurs_versets_laisse_une_famille(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    last = feed(tracker, Clock().say("aa bb"))[-1]
    candidates = of_type(last, Candidates)[0]
    assert candidates.count == 3
    assert candidates.shared_words == 2
    assert {item.ref for item in candidates.items} == {ref("112:1"), ref("113:1"), ref("113:5")}


def test_un_mot_discriminant_reduit_les_candidats(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    last = feed(tracker, Clock().say("aa bb cc"))[-1]
    candidates = of_type(last, Candidates)[0]
    assert {item.ref for item in candidates.items} == {ref("112:1"), ref("113:5")}
    assert candidates.leader_posterior == pytest.approx(0.5, abs=0.05)


def test_les_meilleurs_candidats_sont_bornes_et_comptes(index: PrefixIndex) -> None:
    tracker = new_tracker(index, max_items=2)
    candidates = of_type(feed(tracker, Clock().say("aa"))[0], Candidates)[0]
    assert len(candidates.items) == 2
    assert candidates.count == 3


# --------------------------------------------------------------------------- verrou
def test_un_debut_unique_ne_verrouille_qu_apres_le_nombre_minimal_de_mots(
    index: PrefixIndex,
) -> None:
    tracker = new_tracker(index)
    batches = feed(tracker, Clock().say("nn oo pp"))
    assert not of_type(batches[0] + batches[1], Locked)  # 1 et 2 mots : jamais (I3)
    locks = of_type(batches[2], Locked)
    assert len(locks) == 1
    lock = locks[0]
    assert (lock.ref, lock.status, lock.identity_basis) == (
        ref("113:2"),
        Status.RECOGNIZED,
        "words",
    )
    assert lock.words_heard == 3
    assert lock.first_word == 1
    assert lock.repetition is False


def test_un_posterior_haut_ne_dispense_pas_du_nombre_minimal_de_mots(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    clock = Clock()
    feed(tracker, clock.say("nn oo pp qq"))  # 113:2 verrouillé puis clos
    batches = feed(tracker, clock.say("rr ss tt"))
    # « rr » est unique et la suite est attendue : le posterior est déjà haut au 1er mot
    first = of_type(batches[0], Candidates)[0]
    assert first.leader == ref("113:3") and first.leader_posterior > 0.98
    assert not of_type(batches[0] + batches[1], Locked)
    assert of_type(batches[2], Locked)[0].ref == ref("113:3")


def test_la_fin_du_verset_clot_le_passage_et_annonce_la_suite(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    batches = feed(tracker, Clock().say("nn oo pp qq"))
    closed = of_type(batches[3], Continue)
    assert len(closed) == 1
    assert closed[0].ref == ref("113:2")
    assert closed[0].complete is True
    assert closed[0].expected == (ref("113:3"),)
    assert closed[0].first_word == 1 and closed[0].last_word == 4


def test_un_verset_court_se_verrouille_une_fois_entendu_en_entier(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    batches = feed(tracker, Clock().say("ee ff"))
    assert not of_type(batches[0], Locked)
    assert of_type(batches[1], Locked)[0].ref == ref("112:2")
    assert of_type(batches[1], Locked)[0].words_heard == 2


def test_un_mot_mal_entendu_n_empeche_pas_le_verrou_et_ne_nomme_aucun_autre_verset(
    index: PrefixIndex,
) -> None:
    tracker = new_tracker(index)
    events = flat(feed(tracker, Clock().say("nn oo x9999999 qq")))
    locks = of_type(events, Locked)
    assert [lock.ref for lock in locks] == [ref("113:2")]
    assert locks[0].status is Status.RECOGNIZED


def test_un_mot_avale_est_toleree(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    events = flat(feed(tracker, Clock().say("nn pp qq")))  # « oo » avalé par l'ASR
    assert [lock.ref for lock in of_type(events, Locked)] == [ref("113:2")]


def test_un_mot_en_trop_est_tolere(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    events = flat(feed(tracker, Clock().say("nn oo x8888888 pp qq")))
    assert [lock.ref for lock in of_type(events, Locked)] == [ref("113:2")]


def test_des_sosies_sans_contexte_ne_se_verrouillent_jamais(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    events = flat(feed(tracker, Clock().say("aa bb cc dd")))
    assert not of_type(events, Locked)  # 112:1 et 113:5 sont indiscernables : I3
    unresolved = of_type(events, Unresolved)
    assert len(unresolved) == 1
    assert set(unresolved[0].candidates) == {ref("112:1"), ref("113:5")}


def test_le_contexte_departage_des_sosies_et_le_dit(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    clock = Clock()
    feed(tracker, clock.say("rr ss tt"))  # 113:3
    feed(tracker, clock.say("uu vv ww"))  # 113:4, la suite attendue est 113:5
    events = flat(feed(tracker, clock.say("aa bb cc dd")))
    locks = of_type(events, Locked)
    assert len(locks) == 1
    assert locks[0].ref == ref("113:5")
    assert locks[0].status is Status.INFERRED  # texte entendu, référence déduite de la position
    assert locks[0].identity_basis == "context"
    assert locks[0].words_heard == 3


def test_deux_verrous_de_la_meme_famille_sans_contexte_ne_sont_pas_nommes_par_les_mots(
    index: PrefixIndex,
) -> None:
    tracker = new_tracker(index)
    events = flat(feed(tracker, Clock().say("aa bb xx yy zz")))
    locks = of_type(events, Locked)
    assert [lock.ref for lock in locks] == [ref("113:1")]
    assert locks[0].identity_basis == "words"  # « xx » départage 113:1 de 112:1 et 113:5


# --------------------------------------------------------------------------- saut, perte
def test_un_debut_incompatible_avec_la_suite_est_un_saut(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    clock = Clock()
    feed(tracker, clock.say("nn oo pp qq"))  # la suite attendue est 113:3
    batches = feed(tracker, clock.say("ee ff"))  # 112:2 : une autre sourate
    assert not of_type(batches[0], Jump)  # un seul mot : trop tôt
    jumps = of_type(batches[1], Jump)
    assert len(jumps) == 1
    assert jumps[0].from_ref == ref("113:2")
    assert jumps[0].kind == "other_surah"


def test_une_repetition_est_un_saut_de_type_repeat_puis_un_verrou_marque(
    index: PrefixIndex,
) -> None:
    tracker = new_tracker(index)
    clock = Clock()
    feed(tracker, clock.say("nn oo pp qq"))
    events = flat(feed(tracker, clock.say("nn oo pp")))
    assert [j.kind for j in of_type(events, Jump)] == ["repeat"]
    locks = of_type(events, Locked)
    assert locks and locks[0].ref == ref("113:2") and locks[0].repetition is True


def test_un_retour_en_arriere_dans_la_sourate_est_un_saut_back(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    clock = Clock()
    feed(tracker, clock.say("rr ss tt"))  # 113:3
    events = flat(feed(tracker, clock.say("nn oo")))  # 113:2, avant
    assert [j.kind for j in of_type(events, Jump)] == ["back"]


def test_des_mots_inconnus_ne_produisent_ni_candidat_ni_verrou(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    events = flat(feed(tracker, Clock().say("x1234567 x2345678 x3456789 x4567890 x5678901")))
    assert not of_type(events, Candidates)
    assert not of_type(events, Locked)  # I4
    lost = of_type(events, Lost)
    assert [e.reason for e in lost] == ["no_candidate"]  # une seule fois, pas à chaque mot


def test_une_parole_qui_ressemble_un_peu_au_coran_est_perdue_sans_verrou(
    index: PrefixIndex,
) -> None:
    tracker = new_tracker(index)
    # des mots du Coran dans le désordre, sans suite dans le texte
    events = flat(feed(tracker, Clock().say("cc rr nn uu aa jj ee")))
    assert not of_type(events, Locked)
    assert of_type(events, Lost)


def test_une_parole_etrangere_qui_ressemble_au_coran_n_est_pas_un_saut(index: PrefixIndex) -> None:
    # des mots épars du Coran après un verset clos : rien ne remplace la suite attendue avec
    # assez de poids pour dire « le récitant est allé ailleurs » ; c'est de la parole perdue
    tracker = new_tracker(index)
    clock = Clock()
    feed(tracker, clock.say("nn oo pp qq"))
    events = flat(feed(tracker, clock.say("cc jj uu ee gg ii")))
    assert not of_type(events, Jump)
    assert not of_type(events, Locked)


def test_des_mots_epars_noyes_dans_la_parole_ne_verrouillent_qu_avec_la_densite_par_defaut_nulle(
    index: PrefixIndex,
) -> None:
    # trois mots du verset sur cinq entendus : le reste est de la parole sans rapport
    speech = "nn x1234567 oo x2345678 pp"
    default = flat(feed(new_tracker(index), Clock().say(speech)))
    assert [lock.ref for lock in of_type(default, Locked)] == [ref("113:2")]  # état de départ
    guarded = flat(feed(new_tracker(index, min_lock_density=0.8), Clock().say(speech)))
    assert not of_type(guarded, Locked)  # 3 mots sur 5 : des candidats, pas un verset nommé


def test_une_recitation_dense_verrouille_meme_avec_la_densite_exigee(index: PrefixIndex) -> None:
    events = flat(feed(new_tracker(index, min_lock_density=0.8), Clock().say("nn oo pp")))
    assert [lock.ref for lock in of_type(events, Locked)] == [ref("113:2")]


def test_un_premier_mot_avale_de_la_suite_attendue_n_est_pas_un_saut(index: PrefixIndex) -> None:
    # mesuré sur la récitation de la sourate 67 : l'ASR avale « هو », premier mot de 67:15, et le
    # passage commence au 2e mot ; le verset est bien la suite attendue, pas un saut vers l'avant
    tracker = new_tracker(index)
    clock = Clock()
    feed(tracker, clock.say("nn oo pp qq"))  # 113:2 ; la suite attendue est 113:3 (rr ss tt)
    events = flat(feed(tracker, clock.say("ss tt")))
    assert not of_type(events, Jump)


def test_le_seuil_de_saut_est_ce_qui_ecarte_la_parole_etrangere(index: PrefixIndex) -> None:
    tracker = new_tracker(index, jump_leader_posterior=1e-9)
    clock = Clock()
    feed(tracker, clock.say("nn oo pp qq"))
    events = flat(feed(tracker, clock.say("cc jj uu ee gg ii")))
    assert of_type(events, Jump)  # sans ce seuil, des mots épars passeraient pour un saut


def test_apres_un_verset_clos_une_parole_etrangere_est_perdue(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    clock = Clock()
    feed(tracker, clock.say("nn oo pp qq"))
    events = flat(feed(tracker, clock.say("x1234567 x2345678 x3456789 x4567890")))
    assert [e.reason for e in of_type(events, Lost)] == ["no_candidate"]
    assert not of_type(events, Jump)  # le silence du Coran n'est pas un saut


def test_le_silence_abandonne_un_passage_non_verrouille(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    clock = Clock()
    feed(tracker, clock.say("aa"))
    assert tracker.tick(clock.now + 1.0) == []
    lost = tracker.tick(clock.now + 9.0)
    assert [e.reason for e in of_type(lost, Lost)] == ["silence"]
    assert tracker.tick(clock.now + 20.0) == []  # une seule fois


def test_le_silence_n_abandonne_pas_un_verset_verrouille(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    clock = Clock()
    feed(tracker, clock.say("nn oo pp"))
    assert tracker.tick(clock.now + 60.0) == []


def test_une_cassure_au_milieu_du_verset_rouvre_un_passage(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    clock = Clock()
    feed(tracker, clock.say("nn oo pp"))  # 113:2 verrouillé, incomplet
    events = flat(feed(tracker, clock.say("ee ff")))  # 112:2
    closed = of_type(events, Continue)
    assert closed and closed[0].ref == ref("113:2") and closed[0].complete is False
    assert of_type(events, Locked)[-1].ref == ref("112:2")


# --------------------------------------------------------------------------- basmala
def test_une_basmala_en_tete_est_annoncee_et_restreint_aux_premiers_versets(
    index: PrefixIndex,
) -> None:
    tracker = new_tracker(index)
    batches = feed(tracker, Clock().say("bs1 bs2 bs3 bs4 pa qa ra"))
    events = flat(batches)
    assert len(of_type(events, BasmalaHeard)) == 1
    assert of_type(events, Locked)[0].ref == ref("2:1")
    assert not of_type(events, Lost)


def test_apres_une_basmala_un_milieu_de_verset_n_est_pas_un_depart(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    events = flat(feed(tracker, Clock().say("bs1 bs2 bs3 bs4 oo pp qq")))
    assert not of_type(events, Locked)  # 113:2 n'est pas le début d'une sourate


def test_la_basmala_seule_ne_nomme_aucun_verset(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    events = flat(feed(tracker, Clock().say("bs1 bs2 bs3 bs4")))
    assert of_type(events, BasmalaHeard)
    assert not of_type(events, Locked)


# --------------------------------------------------------------------------- fin de flux
def test_la_fin_du_flux_clot_un_passage_ambigu_en_incertain(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    feed(tracker, Clock().say("aa bb"))
    events = tracker.finish(5.0)
    unresolved = of_type(events, Unresolved)
    assert len(unresolved) == 1
    assert len(unresolved[0].candidates) == 3
    assert tracker.finish(6.0) == []


def test_la_fin_du_flux_clot_un_verset_verrouille_incomplet(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    feed(tracker, Clock().say("nn oo pp"))
    closed = of_type(tracker.finish(5.0), Continue)
    assert len(closed) == 1 and closed[0].complete is False and closed[0].last_word == 3


def test_un_flux_vide_ne_produit_rien(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    assert tracker.finish(1.0) == []
    assert tracker.tick(100.0) == []


# --------------------------------------------------------------------------- milieu de verset
def test_un_passage_peut_demarrer_au_milieu_d_un_verset(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    events = flat(feed(tracker, Clock().say("ta ua va")))
    assert not of_type(events, Locked)  # 3 mots depuis le 2e mot : trop peu pour nommer (I3)
    first = of_type(events, Candidates)[0]
    assert first.leader == ref("2:2") or first.leader == ref("2:3")


# --------------------------------------------------------------------------- invariants
def test_les_classes_d_hypothese_viennent_du_contexte(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    clock = Clock()
    first = of_type(flat(feed(tracker, clock.say("nn"))), Candidates)[0]
    assert first.items[0].hypothesis_class is HypothesisClass.START
    feed(tracker, clock.say("oo pp qq"))
    after = of_type(flat(feed(tracker, clock.say("rr"))), Candidates)[0]
    assert after.items[0].ref == ref("113:3")
    assert after.items[0].hypothesis_class is HypothesisClass.CONTINUE


def test_le_suivi_est_deterministe(index: PrefixIndex) -> None:
    def run() -> list[LiveEvent]:
        tracker = new_tracker(index)
        clock = Clock()
        return flat(feed(tracker, clock.say("aa bb cc nn oo pp qq rr ss ee ff"))) + tracker.finish(
            99.0
        )

    assert run() == run()


def test_un_rival_qui_n_est_pas_un_sosie_bloque_le_verrou_tant_que_les_mots_ne_le_separent_pas(
    index: PrefixIndex,
) -> None:
    # 2:2 (la suite attendue) et 2:3 partagent leurs 3 premiers mots : le contexte seul ne dit pas
    # lequel est récité, alors qu'un 4e mot le dira. Règle (c) de l'ADR-0011 : seuls des sosies
    # EXACTS se départagent par la position ; pour les autres, on attend le mot qui sépare.
    tracker = new_tracker(index)
    clock = Clock()
    feed(tracker, clock.say("pa qa ra"))
    waiting = flat(feed(tracker, clock.say("sa ta ua")))
    assert not of_type(waiting, Locked)
    candidates = of_type(waiting, Candidates)[-1]
    assert candidates.leader == ref("2:2") and candidates.leader_posterior > 0.98
    decided = flat(feed(tracker, clock.say("va")))
    locks = of_type(decided, Locked)
    assert [(lock.ref, lock.status, lock.identity_basis) for lock in locks] == [
        (ref("2:2"), Status.RECOGNIZED, "words")
    ]


def test_un_rival_en_milieu_de_verset_peu_probable_ne_bloque_pas_un_debut_de_verset(
    index: PrefixIndex,
) -> None:
    # « nn oo pp » ouvre 113:2 et se retrouve au milieu de 111:1 : un passage qui démarre au début
    # d'un verset l'emporte largement, le milieu de verset reste une hypothèse de réserve
    tracker = new_tracker(index)
    events = flat(feed(tracker, Clock().say("nn oo pp")))
    assert [lock.ref for lock in of_type(events, Locked)] == [ref("113:2")]


def test_un_rival_en_milieu_de_verset_bloque_s_il_est_probable(index: PrefixIndex) -> None:
    tracker = new_tracker(index, mid_rival_posterior=1e-9)
    events = flat(feed(tracker, Clock().say("nn oo pp")))
    assert not of_type(events, Locked)


def test_le_rival_qui_gagne_au_mot_suivant_ne_nomme_jamais_la_suite_attendue(
    index: PrefixIndex,
) -> None:
    tracker = new_tracker(index)
    clock = Clock()
    feed(tracker, clock.say("pa qa ra"))
    events = flat(feed(tracker, clock.say("sa ta ua wa")))
    assert not [lock for lock in of_type(events, Locked) if lock.ref == ref("2:2")]  # I3


def test_un_verrou_dont_le_posterior_retombe_est_retire_sans_etre_cache(index: PrefixIndex) -> None:
    # mécanisme seul : avec un seuil de retrait à 1, tout posterior un peu inférieur retire le
    # verrou (la vérification acoustique de l'étape 2 s'en servira pour corriger une décision)
    tracker = new_tracker(index, unlock_floor=1.0)
    clock = Clock()
    events = flat(feed(tracker, clock.say("nn oo pp x7654321")))
    order = [type(e).__name__ for e in events if isinstance(e, (Locked, Revision))]
    assert order[:2] == ["Locked", "Revision"]
    revision = of_type(events, Revision)[0]
    assert (revision.ref, revision.reason) == (ref("113:2"), "contradicted")


def test_le_modele_de_mots_refuse_un_mot_vide(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    assert tracker.feed(HeardWord(text="", start_s=0.0, end_s=0.1, arrival_s=0.1)) == []


def test_les_mots_doivent_arriver_dans_l_ordre(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    tracker.feed(HeardWord(text="aa", start_s=1.0, end_s=1.5, arrival_s=1.5))
    with pytest.raises(ValueError):
        tracker.feed(HeardWord(text="bb", start_s=0.0, end_s=0.5, arrival_s=0.5))


# --------------------------------------------------------------------------- pièges de départ
def test_une_phrase_qui_finit_un_verset_ne_nomme_pas_ce_verset(index: PrefixIndex) -> None:
    # comme l'isti'adha, dont les mots finaux sont aussi la fin d'un verset : 4 mots d'une fin de
    # verset ne suffisent pas, il en faut min_words_lock + mid_verse_extra_words
    tracker = new_tracker(index)
    events = flat(feed(tracker, Clock().say("m5 m6 m7 m8")))
    assert not of_type(events, Locked)
    unresolved = of_type(events, Unresolved)
    assert [u.candidates for u in unresolved] == [(ref("114:2"),)]


def test_un_milieu_de_verset_assez_long_se_verrouille_et_garde_son_rang(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    events = flat(feed(tracker, Clock().say("m3 m4 m5 m6 m7")))
    locks = of_type(events, Locked)
    assert [(lock.ref, lock.first_word) for lock in locks] == [(ref("114:2"), 3)]


def test_la_basmala_n_est_jamais_prise_pour_la_fin_d_un_verset(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    events = flat(feed(tracker, Clock().say("bs1 bs2 bs3 bs4")))
    assert of_type(events, BasmalaHeard)
    assert not of_type(events, Locked)
    assert not of_type(events, Candidates)  # rien n'est proposé pendant qu'une basmala se dit


def test_un_verset_qui_s_ouvre_comme_le_milieu_de_la_basmala_n_attend_pas(
    index: PrefixIndex,
) -> None:
    tracker = new_tracker(index)
    events = flat(feed(tracker, Clock().say("bs2 y3")))
    assert [lock.ref for lock in of_type(events, Locked)] == [ref("114:4")]
    assert not of_type(events, BasmalaHeard)


def test_une_basmala_incomplete_suivie_d_un_verset_est_retrouvee(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    events = flat(feed(tracker, Clock().say("bs1 bs2 bs3 pa qa ra")))  # « bs4 » avalé
    assert of_type(events, BasmalaHeard)
    assert [lock.ref for lock in of_type(events, Locked)] == [ref("2:1")]


def test_apres_une_fin_de_verset_une_basmala_puis_un_debut_de_sourate_se_verrouille(
    index: PrefixIndex,
) -> None:
    tracker = new_tracker(index)
    clock = Clock()
    feed(tracker, clock.say("m1 m2 m3 m4 m5 m6 m7 m8"))  # 114:2 ; la suite (114:3) est absente ici
    events = flat(feed(tracker, clock.say("bs1 bs2 bs3 bs4 pa qa ra")))
    assert [lock.ref for lock in of_type(events, Locked)] == [ref("2:1")]


# --------------------------------------------------------------------------- confiance de l'ASR
def _say_with_confidence(
    tracker: HypothesisTracker, text: str, confidence: float
) -> list[LiveEvent]:
    events: list[LiveEvent] = []
    for word in Clock().say(text):
        events.extend(
            tracker.feed(
                HeardWord(
                    word.text,
                    word.start_s,
                    word.end_s,
                    word.arrival_s,
                    confidence=confidence,
                )
            )
        )
    return events


def test_des_mots_peu_surs_ne_verrouillent_pas_meme_s_ils_correspondent(
    index: PrefixIndex,
) -> None:
    # un ASR spécialisé « voit du Coran partout » : ses mots peu sûrs ne nomment pas un verset (I3)
    tracker = new_tracker(index, min_lock_confidence=0.7)
    events = _say_with_confidence(tracker, "nn oo pp qq", confidence=0.4)
    assert not of_type(events, Locked)
    assert of_type(events, Candidates)  # on propose, on ne nomme pas


def test_des_mots_sirs_verrouillent_avec_le_meme_seuil(index: PrefixIndex) -> None:
    tracker = new_tracker(index, min_lock_confidence=0.7)
    events = _say_with_confidence(tracker, "nn oo pp qq", confidence=0.9)
    locks = of_type(events, Locked)
    assert [lock.ref for lock in locks] == [ref("113:2")]
    assert locks[0].mean_confidence == pytest.approx(0.9)


def test_la_confiance_moyenne_se_mesure_sur_les_seuls_mots_qui_correspondent(
    index: PrefixIndex,
) -> None:
    tracker = new_tracker(index, min_lock_confidence=0.7)
    events: list[LiveEvent] = []
    for text, confidence in (("nn", 0.9), ("oo", 0.9), ("x7654321", 0.1), ("pp", 0.9), ("qq", 0.9)):
        events += _say_with_confidence(tracker, text, confidence)
    assert [lock.ref for lock in of_type(events, Locked)] == [ref("113:2")]


def test_sans_seuil_la_confiance_n_empeche_rien(index: PrefixIndex) -> None:
    tracker = new_tracker(index)
    events = _say_with_confidence(tracker, "nn oo pp qq", confidence=0.05)
    assert of_type(events, Locked)


def test_des_mots_seulement_proches_ne_suffisent_pas_a_verrouiller(index: PrefixIndex) -> None:
    # trois mots proches (une lettre de différence) sans un seul mot exact ne nomment rien
    near = "qalphb qbeta2 qgammb"
    control = flat(feed(new_tracker(index), Clock().say(near)))
    assert [lock.ref for lock in of_type(control, Locked)] == [ref("114:5")]  # sans la règle
    strict = flat(feed(new_tracker(index, min_exact_share=0.67), Clock().say(near)))
    assert not of_type(strict, Locked)


def test_le_part_de_mots_exacts_est_comptee_sur_le_minimum_de_mots(index: PrefixIndex) -> None:
    tracker = new_tracker(index, min_exact_share=0.67)
    events = flat(feed(tracker, Clock().say("nn oo pp")))
    assert of_type(events, Locked)  # 3 mots exacts sur 3
    one_exact = flat(
        feed(new_tracker(index, min_exact_share=0.67), Clock().say("qalpha qbeta2 qgammb"))
    )
    assert not of_type(one_exact, Locked)  # 1 mot exact sur 3 : moins de 2 exacts exigés
