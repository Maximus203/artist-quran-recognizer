"""Promotion d'un verset `uncertain` qui est membre d'une suite acceptée par l'audio (ADR-0013).

Cas réel (lot3-04, 1,3-16,2 s) : 1:1 [2-4] et 1:2 [1-4] restent `uncertain` (le décodeur les
trouve à égalité avec un homonyme au moment où il les voit) alors que la suite 1:1-1:5 a été
acceptée par l'alignement du texte du corpus (llr −0,25). La suite lève l'ambiguïté, que le
décodeur ne revoit pas.
"""

from __future__ import annotations

from aqr.decoding.chain_members import ChainProof, promote_chain_members
from aqr.domain.models import Detection, Status, TimeSpan, VerseRef, WordSpan


def uncertain(ref: str, first: int, last: int, start: float, end: float) -> Detection:
    ref_ = VerseRef.parse(ref)
    return Detection(
        WordSpan(ref_, first, last),
        TimeSpan(start, end),
        Status.UNCERTAIN,
        0.75,
        candidates=(ref_, VerseRef(6, 45)),
    )


def recognized(ref: str, first: int, last: int, start: float, end: float) -> Detection:
    return Detection(
        WordSpan(VerseRef.parse(ref), first, last), TimeSpan(start, end), Status.RECOGNIZED, 0.75
    )


def proof(passage: tuple[float, float], *spans: tuple[str, int, int], accepted: bool = True):
    return ChainProof(
        TimeSpan(*passage),
        tuple(WordSpan(VerseRef.parse(r), a, b) for r, a, b in spans),
        accepted,
    )


FATIHA = proof((1.43, 30.9), ("1:1", 2, 4), ("1:2", 1, 4), ("1:3", 1, 2), ("1:4", 1, 3))


def test_un_membre_incertain_d_une_suite_acceptee_est_reconnu():
    items = [uncertain("1:1", 2, 4, 2.23, 9.51), uncertain("1:2", 1, 4, 9.51, 16.15)]
    out = promote_chain_members(items, [FATIHA])
    assert [d.status for d in out] == [Status.RECOGNIZED, Status.RECOGNIZED]
    assert all(d.promoted_by == "chain" and d.candidates == () for d in out)
    assert [(d.span, d.time) for d in out] == [
        (d.span, d.time) for d in items
    ]  # rien d'autre ne bouge


def test_une_suite_refusee_par_l_audio_ne_promeut_rien():  # I3
    refused = proof((1.43, 30.9), ("1:1", 2, 4), ("1:2", 1, 4), accepted=False)
    items = [uncertain("1:1", 2, 4, 2.23, 9.51)]
    assert promote_chain_members(items, [refused]) == items


def test_sans_suite_rien_n_est_promu():
    items = [uncertain("1:1", 2, 4, 2.23, 9.51)]
    assert promote_chain_members(items, []) == items


def test_un_verset_hors_des_plages_de_la_suite_reste_incertain():
    items = [uncertain("1:2", 1, 4, 9.51, 16.15)]
    other_verse = proof((1.43, 30.9), ("1:1", 2, 4), ("1:3", 1, 2))
    other_words = proof((1.43, 30.9), ("1:2", 1, 2), ("1:3", 1, 2))
    assert promote_chain_members(items, [other_verse]) == items
    assert promote_chain_members(items, [other_words]) == items


def test_un_verset_hors_du_passage_de_la_suite_reste_incertain():
    items = [uncertain("1:2", 1, 4, 100.0, 106.0)]
    assert promote_chain_members(items, [FATIHA]) == items


def test_deux_suites_parallelement_acceptees_ne_departagent_rien():  # homonymes
    twin = proof((1.43, 30.9), ("6:45", 1, 4), ("6:46", 1, 3))
    items = [uncertain("1:2", 1, 4, 9.51, 16.15)]
    assert promote_chain_members(items, [FATIHA, twin]) == items


def test_une_suite_concurrente_refusee_ne_gene_pas():
    twin = proof((1.43, 30.9), ("6:45", 1, 4), ("6:46", 1, 3), accepted=False)
    items = [uncertain("1:2", 1, 4, 9.51, 16.15)]
    assert promote_chain_members(items, [FATIHA, twin])[0].status is Status.RECOGNIZED


def test_deux_morceaux_de_la_meme_suite_ne_se_font_pas_concurrence():
    long = proof((159.1, 239.6), ("2:196", 53, 73), ("2:197", 1, 15))
    short = proof((210.7, 239.6), ("2:197", 1, 15))
    items = [uncertain("2:197", 1, 15, 211.5, 239.0)]
    assert promote_chain_members(items, [long, short])[0].status is Status.RECOGNIZED


def test_un_verset_deja_reconnu_ou_infere_n_est_pas_touche():
    inferred = Detection(WordSpan(VerseRef(1, 3), 1, 4), None, Status.INFERRED, 0.0)
    items = [recognized("1:3", 1, 2, 17.0, 22.3), inferred]
    assert promote_chain_members(items, [FATIHA]) == items


def test_la_tolerance_de_bord_est_reglable():
    items = [uncertain("1:1", 2, 4, 1.2, 9.51)]  # commence 0,23 s avant le passage
    assert promote_chain_members(items, [FATIHA])[0].status is Status.UNCERTAIN
    assert promote_chain_members(items, [FATIHA], tolerance_s=0.5)[0].status is Status.RECOGNIZED
