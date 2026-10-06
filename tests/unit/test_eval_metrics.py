"""Métriques d'évaluation : cas synthétiques, définitions de docs/EVALUATION-METRICS.md."""

from __future__ import annotations

from typing import Any

import pytest

from aqr.data.manifest import (
    Annotation,
    AudioCase,
    ExpectedItem,
    NonQuranItem,
    WordRange,
)
from aqr.domain.models import NonQuranKind, Status, VerseRef
from aqr.eval.metrics import (
    EvaluationRefused,
    MatchPolicy,
    aggregate,
    evaluate_case,
    evaluate_recognition,
)
from aqr.eval.recognition import RecognitionError, parse_intervals, parse_recognition

POLICY = MatchPolicy(min_overlap=0.5)
HUMAN = Annotation("human", "rel-01", "2026-10-06", None)


def _exp(ref: str, a: float, b: float, words: str = "all", status=Status.RECOGNIZED):
    return ExpectedItem((a, b), VerseRef.parse(ref), WordRange.parse(words), status)


def _case(expected=(), non_quran=(), **over: Any) -> AudioCase:
    base: dict[str, Any] = dict(
        id="c1",
        file="C01/c1.mp3",
        sha256="a" * 64,
        categorie=("C01",),
        recitant="r",
        riwaya="hafs",
        langues=("ar",),
        license="x",
        duree_s=100.0,
        statut="annote",
        split="dev",
        tolerance_ms=300,
        expected=tuple(expected),
        non_quran=tuple(non_quran),
        annotation=HUMAN,
    )
    base.update(over)
    return AudioCase(**base)


def _verse(ref, t, status="recognized", words=None, **over):
    out = {
        "kind": "verse",
        "ref": ref,
        "words": words or [1, 10],
        "status": status,
        "t": t,
        "time_interpolated": False,
        "confidence": 1.0,
        "candidates": [],
    }
    out.update(over)
    return out


def _abst(t, reason="below_threshold"):
    return {"kind": "abstention", "reason": reason, "t": t, "best_score": 0.5}


def _nq(t, label="unclassified"):
    return {"kind": "non_quran", "label": label, "t": t}


def _ev(case, intervals, **kw):
    return evaluate_case(case, intervals, policy=POLICY, **kw)


# --- cas exact, limites ------------------------------------------------------------------


def test_verset_exact_retrouve_sans_faux_ni_omission():
    case = _case([_exp("67:4", 0, 6), _exp("67:5", 6, 11)])
    res = _ev(case, [_verse("67:4", [0.05, 6.0]), _verse("67:5", [6.0, 11.1])])
    assert res.n_reference_verses == 2 and res.n_found == 2
    assert res.false_verses == () and res.omissions == ()
    assert [b.start_error_ms for b in res.boundaries] == pytest.approx([50, 0])
    assert [b.end_error_ms for b in res.boundaries] == pytest.approx([0, 100])
    assert all(b.within_tolerance for b in res.boundaries)


def test_decalage_hors_tolerance_retrouve_mais_limite_fausse():
    case = _case([_exp("67:4", 0, 6)])
    res = _ev(case, [_verse("67:4", [0.8, 6.0])])
    assert res.n_found == 1 and res.omissions == ()
    b = res.boundaries[0]
    assert b.start_error_ms == pytest.approx(800) and not b.start_within
    assert b.end_within and not b.within_tolerance


def test_tolerance_du_cas_est_utilisee():
    case = _case([_exp("67:4", 0, 6)], tolerance_ms=1000)
    res = _ev(case, [_verse("67:4", [0.8, 6.0])])
    assert res.boundaries[0].within_tolerance


def test_verset_omis_sans_aucune_sortie():
    case = _case([_exp("67:4", 0, 6), _exp("67:5", 6, 11)])
    res = _ev(case, [_verse("67:4", [0, 6])])
    assert res.n_found == 1
    assert [(o.ref, o.cause) for o in res.omissions] == [("67:5", "no_output")]


def test_omission_par_abstention_et_part_d_abstention():
    case = _case([_exp("67:4", 0, 6), _exp("67:5", 6, 11)])
    res = _ev(case, [_verse("67:4", [0, 6]), _abst([6.0, 11.0])])
    assert [o.cause for o in res.omissions] == ["abstention"]
    assert res.reference_quran_s == pytest.approx(11.0)
    assert res.abstained_s == pytest.approx(5.0)


def test_abstention_hors_du_coranique_de_reference_ne_compte_pas():
    case = _case([_exp("67:4", 0, 6)], non_quran=[NonQuranItem((6, 20), NonQuranKind.FRENCH)])
    res = _ev(case, [_verse("67:4", [0, 6]), _abst([6, 20])])
    assert res.abstained_s == 0.0 and res.reference_quran_s == pytest.approx(6.0)


def test_faux_verset_a_la_place_du_bon():
    case = _case([_exp("67:4", 0, 6), _exp("67:5", 6, 11)])
    res = _ev(case, [_verse("67:4", [0, 6]), _verse("67:9", [6, 11])])
    assert [(f.ref, f.reason) for f in res.false_verses] == [("67:9", "wrong_verse")]
    assert [(o.ref, o.cause) for o in res.omissions] == [("67:5", "wrong_verse")]
    assert res.n_found == 1


def test_citation_reconnue_dans_du_francais_est_une_zone_non_coranique():
    case = _case(
        [_exp("112:1", 20, 22)],
        non_quran=[
            NonQuranItem((0, 20), NonQuranKind.FRENCH),
            NonQuranItem((22, 60), NonQuranKind.FRENCH),
        ],
    )
    res = _ev(case, [_verse("112:1", [20.1, 22.1]), _verse("1:2", [30, 34])])
    assert res.n_found == 1
    assert [(f.ref, f.reason) for f in res.false_verses] == [("1:2", "non_quran_zone")]


def test_verset_reconnu_hors_de_toute_reference():
    case = _case([_exp("112:1", 20, 22)])
    res = _ev(case, [_verse("112:1", [20, 22]), _verse("112:2", [50, 52])])
    assert [f.reason for f in res.false_verses] == ["unreferenced"]


def test_bon_verset_au_mauvais_endroit():
    case = _case([_exp("112:1", 20, 22)])
    res = _ev(case, [_verse("112:1", [21.9, 40])])
    assert [f.reason for f in res.false_verses] == ["misplaced"]
    assert [o.cause for o in res.omissions] == ["no_output"]


def test_repetition_chaque_occurrence_est_comptee():
    case = _case([_exp("112:1", 0, 3), _exp("112:1", 3, 6)])
    both = _ev(case, [_verse("112:1", [0, 3]), _verse("112:1", [3, 6])])
    assert both.n_found == 2 and both.omissions == () and both.false_verses == ()
    one = _ev(case, [_verse("112:1", [3, 6])])
    assert one.n_found == 1 and [o.t for o in one.omissions] == [(0.0, 3.0)]


def test_prediction_recouvrant_deux_occurrences_ne_double_pas_le_trouve():
    case = _case([_exp("112:1", 0, 3), _exp("112:1", 3, 6)])
    res = _ev(case, [_verse("112:1", [0, 6])])
    assert res.n_found == 1 and res.false_verses == ()
    assert [o.t for o in res.omissions] == [(3.0, 6.0)]


def test_inferred_n_est_jamais_reconnu():
    case = _case([_exp("67:4", 0, 6), _exp("67:5", 6, 11)])
    res = _ev(
        case,
        [
            _verse("67:4", [0, 6]),
            _verse("67:5", [6, 11], status="inferred", time_interpolated=True),
        ],
    )
    assert res.n_found == 1 and res.n_recognized_predictions == 1
    assert [(o.cause, o.ref_correct) for o in res.omissions] == [("inferred", True)]
    assert res.false_verses == ()
    assert res.abstained_s == 0.0  # inferred est une décision, pas une abstention


def test_inferred_a_un_mauvais_verset_est_signale_sans_etre_un_faux_verset():
    case = _case([_exp("67:5", 6, 11)])
    res = _ev(case, [_verse("67:9", [6, 11], status="inferred", time_interpolated=True)])
    assert res.false_verses == ()
    assert [(o.cause, o.ref_correct) for o in res.omissions] == [("inferred", False)]


def test_uncertain_n_est_jamais_reconnu_et_compte_comme_abstention():
    case = _case([_exp("67:5", 6, 11)])
    res = _ev(
        case,
        [_verse("67:6", [6, 11], status="uncertain", candidates=["67:6", "67:5"])],
    )
    assert res.n_found == 0 and res.false_verses == ()
    o = res.omissions[0]
    assert o.cause == "uncertain" and o.candidate_hit is True
    assert res.abstained_s == pytest.approx(5.0)


def test_uncertain_sans_la_bonne_reponse_dans_les_candidats():
    case = _case([_exp("67:5", 6, 11)])
    res = _ev(case, [_verse("67:6", [6, 11], status="uncertain", candidates=["67:6", "67:7"])])
    assert res.omissions[0].candidate_hit is False


def test_omission_par_etiquette_non_coranique_du_moteur():
    case = _case([_exp("67:5", 6, 11)])
    res = _ev(case, [_nq([6, 11], "takbir")])
    assert res.omissions[0].cause == "non_quran"


def test_plages_de_mots_partielles():
    case = _case(
        [_exp("2:255", 0, 4, words="1-5"), _exp("2:255", 4, 8, words="6-10")],
    )
    ok = _ev(
        case,
        [_verse("2:255", [0, 4], words=[1, 5]), _verse("2:255", [4, 8], words=[6, 10])],
    )
    assert ok.n_found == 2 and ok.false_verses == ()
    swapped = _ev(case, [_verse("2:255", [0, 4], words=[6, 10])])
    assert swapped.n_found == 0
    assert [f.reason for f in swapped.false_verses] == ["wrong_verse"]


def test_prediction_partielle_d_un_verset_de_reference_entier():
    case = _case([_exp("2:255", 0, 8)])
    res = _ev(case, [_verse("2:255", [0, 4], words=[1, 5]), _verse("2:255", [4, 8], words=[6, 10])])
    assert res.n_found == 1 and res.false_verses == ()
    # limites : union des intervalles reconnus qui correspondent
    assert res.boundaries[0].start_error_ms == pytest.approx(0)
    assert res.boundaries[0].end_error_ms == pytest.approx(0)


def test_facteur_temps_reel():
    case = _case([_exp("67:4", 0, 6)], duree_s=200.0)
    res = _ev(case, [_verse("67:4", [0, 6])], timing={"total_s": 50.0})
    assert res.realtime_factor == pytest.approx(0.25)
    assert _ev(case, [_verse("67:4", [0, 6])]).realtime_factor is None


def test_intervalle_sans_temps_est_compte_non_localise_et_ignore():
    case = _case([_exp("67:5", 6, 11)])
    res = _ev(case, [_verse("67:5", None, status="uncertain", candidates=["67:5", "67:6"])])
    assert res.n_unlocated_intervals == 1 and res.omissions[0].cause == "no_output"


def test_politique_de_chevauchement_est_obligatoire_et_validee():
    with pytest.raises(TypeError):
        MatchPolicy()  # type: ignore[call-arg]
    with pytest.raises(ValueError):
        MatchPolicy(min_overlap=0.0)


# --- refus -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "over",
    [
        {"statut": "a_annoter"},
        {"annotation": None},
        {"annotation": Annotation("model_preannotation", "rel-01")},
        {"annotation": Annotation("human", None)},
        {"annotation": Annotation("human", "  ")},
    ],
)
def test_refus_d_un_cas_non_annote_ou_non_controle(over):
    case = _case([_exp("67:4", 0, 6)], **over)
    with pytest.raises(EvaluationRefused):
        _ev(case, [_verse("67:4", [0, 6])])


def test_refus_d_un_cas_annote_sans_aucune_etiquette():
    with pytest.raises(EvaluationRefused, match="vide"):
        _ev(_case([]), [])


def test_cas_mix_synthetique_evaluable_sans_relecteur():
    case = _case([_exp("67:4", 0, 6)], origine="mix", annotation=None)
    assert _ev(case, [_verse("67:4", [0, 6])]).n_found == 1


# --- lecteur de sortie aqr.recognition/1 ---------------------------------------------------


def _doc(intervals, sha="a" * 64, total=10.0):
    return {
        "schema": "aqr.recognition/1",
        "source": {"file": "c1.mp3", "sha256": sha, "duration_s": 100.0},
        "engine": {"asr": "x"},
        "decoder": {},
        "timing": {"total_s": total},
        "intervals": intervals,
    }


def test_lecteur_valide_le_schema():
    rec = parse_recognition(_doc([_verse("67:4", [0, 6]), _nq([6, 7], "amin"), _abst([7, 8])]))
    assert [type(i).__name__ for i in rec.intervals] == [
        "VerseInterval",
        "NonQuranInterval",
        "AbstentionInterval",
    ]
    with pytest.raises(RecognitionError, match="schema"):
        parse_recognition({**_doc([]), "schema": "autre/9"})
    with pytest.raises(RecognitionError):
        parse_intervals([{"kind": "poesie", "t": [0, 1]}])
    with pytest.raises(RecognitionError, match="recognized"):
        parse_intervals([_verse("67:4", None)])
    with pytest.raises(RecognitionError):
        parse_intervals([_verse("67:4", [5, 1])])
    with pytest.raises(RecognitionError):
        parse_intervals([_verse("999:4", [0, 1])])


def test_evaluate_recognition_refuse_un_mauvais_fichier_audio():
    case = _case([_exp("67:4", 0, 6)])
    ok = evaluate_recognition(case, _doc([_verse("67:4", [0, 6])]), policy=POLICY)
    assert ok.n_found == 1 and ok.realtime_factor == pytest.approx(0.1)
    with pytest.raises(EvaluationRefused, match="sha256"):
        evaluate_recognition(case, _doc([], sha="b" * 64), policy=POLICY)


# --- agrégation --------------------------------------------------------------------------


def test_agregation_par_sommes_jamais_moyenne_de_ratios():
    # cas A : 1 verset de référence, 1 prédiction juste, 0 faux.
    a = _ev(_case([_exp("67:4", 0, 6)], id="a"), [_verse("67:4", [0, 6])])
    # cas B : 9 versets de référence, 9 prédictions dont 3 fausses (à la place des vrais).
    refs = [_exp(f"67:{i}", i * 10, i * 10 + 5) for i in range(1, 10)]
    preds = [_verse(f"67:{i}", [i * 10, i * 10 + 5]) for i in range(1, 7)]
    preds += [_verse("67:30", [i * 10, i * 10 + 5]) for i in range(7, 10)]
    b = _ev(_case(refs, id="b", categorie=("C09", "C11")), preds)
    agg = aggregate([a, b], min_reference_verses=10)
    total = agg["overall"]
    assert total["n_cases"] == 2 and total["n_reference_verses"] == 10
    assert total["n_recognized_predictions"] == 10 and total["n_false_verses"] == 3
    assert total["false_verse_rate"] == pytest.approx(3 / 10)  # pas (0 + 1/3) / 2
    assert total["n_omissions"] == 3 and total["omission_rate"] == pytest.approx(0.3)
    assert total["recall"] == pytest.approx(0.7)
    assert total["omissions_by_cause"]["wrong_verse"] == 3
    assert total["defensible"] is True
    lo, hi = total["false_verse_rate_ci95"]
    assert 0.0 < lo < 0.3 < hi < 1.0


def test_agregation_par_categorie_et_defensible():
    a = _ev(_case([_exp("67:4", 0, 6)], id="a", categorie=("C01",)), [_verse("67:4", [0, 6])])
    b = _ev(_case([_exp("67:4", 0, 6)], id="b", categorie=("C09", "C01")), [])
    agg = aggregate([a, b], min_reference_verses=2)
    assert set(agg["by_category"]) == {"C01", "C09"}
    assert agg["by_category"]["C01"]["n_cases"] == 2
    assert agg["by_category"]["C09"]["n_cases"] == 1
    assert agg["by_category"]["C01"]["defensible"] is True
    assert agg["by_category"]["C09"]["defensible"] is False
    assert agg["by_category"]["C09"]["n_reference_verses"] == 1
    assert agg["min_reference_verses"] == 2


def test_agregation_limites_abstention_et_temps_reel_en_sommes():
    a = _ev(
        _case([_exp("67:4", 0, 10)], id="a", duree_s=100.0),
        [_verse("67:4", [0.5, 10.0])],
        timing={"total_s": 10.0},
    )
    b = _ev(
        _case([_exp("67:4", 0, 30)], id="b", duree_s=300.0),
        [_abst([0, 15])],
        timing={"total_s": 60.0},
    )
    t = aggregate([a, b], min_reference_verses=1)["overall"]
    assert t["abstention_share"] == pytest.approx(15 / 40)
    assert t["realtime_factor"] == pytest.approx(70 / 400)
    assert t["n_boundary_pairs"] == 1
    assert t["start_within_tolerance"] == 0 and t["end_within_tolerance"] == 1
    assert t["both_within_tolerance"] == 0
    assert t["start_abs_error_ms_median"] == pytest.approx(500)


def test_agregation_vide_ne_renvoie_aucun_taux():
    agg = aggregate([], min_reference_verses=5)
    assert agg["overall"]["n_cases"] == 0
    assert agg["overall"]["false_verse_rate"] is None and agg["overall"]["defensible"] is False


def test_agregation_exclut_les_limites_approximatives():
    approx = _ev(
        _case([_exp("67:4", 0, 6)], id="x", boundaries="approximate"),
        [_verse("67:4", [1.0, 6])],
    )
    t = aggregate([approx], min_reference_verses=1)["overall"]
    assert t["n_boundary_pairs"] == 0 and t["n_boundary_excluded_approximate"] == 1
