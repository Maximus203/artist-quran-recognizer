"""Promotion par le voisin reconnu (ADR-0010) : quelles détections `uncertain` méritent qu'on
demande à l'audio de les soutenir. Pur : détections et candidats construits à la main.

Cas réel (session 5014015f, Hud 11:61) : la fenêtre 21,5-35,7 s porte 11:61 [1-10], dont le début
ressemble à 7:73 (`uncertain`, deux candidats à égalité) ; la fenêtre suivante, contiguë, est
`recognized` 11:61 [10-17]. Rien ne la promouvait."""

from __future__ import annotations

import pytest

from aqr.decoding.neighbors import NeighborConfig, propose_promotions
from aqr.domain.models import Detection, Status, TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import Candidate

V = VerseRef(11, 61)
RIVAL = VerseRef(7, 73)
FLOOR = 0.75
WORDS = {VerseRef(11, 61): 27, VerseRef(11, 62): 21, VerseRef(7, 73): 31}


class _Corpus:
    def words(self, ref: VerseRef) -> tuple[str, ...]:
        return ("w",) * WORDS[ref]


def span(ref: VerseRef, first: int, last: int) -> WordSpan:
    return WordSpan(ref, first, last)


def cand(ref: VerseRef, first: int, last: int, score: float = 0.88) -> Candidate:
    return Candidate(
        span(ref, first, last), score, quality=score, explained=float(last - first + 1)
    )


def recognized(ref: VerseRef, first: int, last: int, start: float, end: float) -> Detection:
    return Detection(span(ref, first, last), TimeSpan(start, end), Status.RECOGNIZED, 0.85)


def uncertain(
    ref: VerseRef, first: int, last: int, start: float, end: float, *rivals: VerseRef
) -> Detection:
    return Detection(
        span(ref, first, last),
        TimeSpan(start, end),
        Status.UNCERTAIN,
        0.88,
        candidates=tuple(sorted({ref, *(rivals or (RIVAL,))})),
    )


def propose(detections, observations, *, barriers=(), **config):
    return propose_promotions(
        detections,
        observations,
        _Corpus(),
        NeighborConfig(**config),
        floor=FLOOR,
        max_gap_s=5.0,
        barriers=list(barriers),
    )


W1, W2, W3 = TimeSpan(21.5, 35.7), TimeSpan(35.7, 48.1), TimeSpan(55.1, 78.0)
BOTH = [cand(V, 1, 10), cand(RIVAL, 1, 10)]  # le début de 11:61 ressemble à celui de 7:73


def test_un_debut_incertain_suivi_de_sa_suite_reconnue_est_propose():  # cas réel 11:61
    detections = [uncertain(V, 1, 10, 21.5, 35.7), recognized(V, 10, 17, 35.7, 48.1)]
    observations = [(W1, BOTH), (W2, [cand(V, 10, 17)])]
    (promotion,) = propose(detections, observations)
    assert (promotion.index, promotion.neighbor) == (0, 1)
    assert promotion.candidate.span == span(V, 1, 10) and promotion.window == W1


def test_le_candidat_propose_est_celui_qui_prolonge_le_voisin_pas_le_rival():
    # le décodeur a retenu 7:73 ; seul 11:61 [1-10] prolonge le voisin reconnu 11:61 [10-17]
    detections = [uncertain(RIVAL, 1, 10, 21.5, 35.7, V), recognized(V, 10, 17, 35.7, 48.1)]
    observations = [(W1, BOTH), (W2, [cand(V, 10, 17)])]
    (promotion,) = propose(detections, observations)
    assert promotion.candidate.span == span(V, 1, 10)


def test_la_suite_incertaine_apres_un_reconnu_est_proposee_aussi():
    detections = [recognized(V, 1, 10, 21.5, 35.7), uncertain(V, 10, 17, 35.7, 48.1, RIVAL)]
    observations = [(W1, [cand(V, 1, 10)]), (W2, [cand(V, 10, 17), cand(RIVAL, 10, 17)])]
    (promotion,) = propose(detections, observations)
    assert (promotion.index, promotion.neighbor) == (1, 0)
    assert promotion.candidate.span == span(V, 10, 17)


def test_la_suite_peut_ouvrir_le_verset_suivant():
    last = WORDS[V]
    detections = [
        recognized(V, 20, last, 21.5, 35.7),
        uncertain(VerseRef(11, 62), 1, 5, 36.0, 40.0),
    ]
    nxt = VerseRef(11, 62)
    observations = [
        (W1, [cand(V, 20, last)]),
        (TimeSpan(36.0, 40.0), [cand(nxt, 1, 5), cand(RIVAL, 1, 5)]),
    ]
    (promotion,) = propose(detections, observations)
    assert promotion.candidate.span == span(nxt, 1, 5)


@pytest.mark.parametrize(
    ("first", "last", "pourquoi"),
    [
        (1, 5, "trou de trois mots entre les deux plages"),
        (1, 12, "chevauchement de quatre mots (ce n'est pas la même parole)"),
        (12, 14, "la plage commence après son voisin"),
    ],
)
def test_une_plage_qui_ne_se_raccorde_pas_n_est_pas_proposee(first, last, pourquoi):
    detections = [uncertain(V, first, last, 21.5, 35.7), recognized(V, 9, 17, 35.7, 48.1)]
    observations = [(W1, [cand(V, first, last), cand(RIVAL, first, last)]), (W2, [cand(V, 9, 17)])]
    assert propose(detections, observations) == [], pourquoi


def test_un_chevauchement_de_deux_mots_reste_admis():
    detections = [uncertain(V, 1, 10, 21.5, 35.7), recognized(V, 9, 17, 35.7, 48.1)]
    observations = [(W1, BOTH), (W2, [cand(V, 9, 17)])]
    assert len(propose(detections, observations)) == 1


def test_un_ecart_de_temps_trop_grand_interdit_la_promotion():
    detections = [uncertain(V, 1, 10, 21.5, 35.7), recognized(V, 10, 17, 55.1, 78.0)]
    observations = [(W1, BOTH), (W3, [cand(V, 10, 17)])]
    assert propose(detections, observations) == []


def test_une_fenetre_ecartee_entre_les_deux_interdit_la_promotion():
    detections = [uncertain(V, 1, 10, 21.5, 35.7), recognized(V, 10, 17, 40.0, 48.1)]
    observations = [
        (W1, BOTH),
        (TimeSpan(36.0, 39.5), []),
        (TimeSpan(40.0, 48.1), [cand(V, 10, 17)]),
    ]
    assert propose(detections, observations, barriers=[TimeSpan(36.0, 39.5)]) == []


@pytest.mark.parametrize("status", [Status.INFERRED, Status.UNCERTAIN])
def test_un_voisin_qui_n_est_pas_reconnu_ne_prouve_rien(status):
    neighbor = Detection(span(V, 10, 17), TimeSpan(35.7, 48.1), status, 0.8, candidates=(V, RIVAL))
    detections = [uncertain(V, 1, 10, 21.5, 35.7), neighbor]
    observations = [(W1, BOTH), (W2, [cand(V, 10, 17)])]
    assert propose(detections, observations) == []


def test_sans_candidat_viable_dans_la_fenetre_rien_n_est_propose():
    detections = [uncertain(V, 1, 10, 21.5, 35.7), recognized(V, 10, 17, 35.7, 48.1)]
    observations = [(W1, [cand(V, 1, 10, score=0.5), cand(RIVAL, 1, 10)]), (W2, [cand(V, 10, 17)])]
    assert propose(detections, observations) == []


def test_deux_plages_qui_prolongent_le_voisin_avec_le_meme_score_restent_ambigues():
    detections = [uncertain(V, 1, 10, 21.5, 35.7), recognized(V, 10, 17, 35.7, 48.1)]
    observations = [(W1, [cand(V, 1, 10), cand(V, 1, 9)]), (W2, [cand(V, 10, 17)])]
    assert propose(detections, observations) == []


def test_desactivee_ne_propose_rien():
    detections = [uncertain(V, 1, 10, 21.5, 35.7), recognized(V, 10, 17, 35.7, 48.1)]
    observations = [(W1, BOTH), (W2, [cand(V, 10, 17)])]
    assert propose(detections, observations, enabled=False) == []


def test_une_detection_deja_reconnue_n_est_jamais_proposee():
    detections = [recognized(V, 1, 10, 21.5, 35.7), recognized(V, 10, 17, 35.7, 48.1)]
    observations = [(W1, BOTH), (W2, [cand(V, 10, 17)])]
    assert propose(detections, observations) == []
