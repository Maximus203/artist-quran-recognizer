"""Exactitude d'identification (sourate / verset exact / plage), non reconnus, faux positifs."""

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
from aqr.eval.identification import (
    aggregate_identification,
    evaluate_identification,
)
from aqr.eval.metrics import EvaluationRefused

HUMAN = Annotation("human", "rel-01")


def _exp(ref: str, a: float, b: float, words: str = "all") -> ExpectedItem:
    return ExpectedItem((a, b), VerseRef.parse(ref), WordRange.parse(words), Status.RECOGNIZED)


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
        duree_s=60.0,
        statut="annote",
        split="dev",
        expected=tuple(expected),
        non_quran=tuple(non_quran),
        annotation=HUMAN,
    )
    base.update(over)
    return AudioCase(**base)


def _verse(ref: str, a: float, b: float, status: str = "recognized") -> dict[str, Any]:
    return {"kind": "verse", "ref": ref, "words": [1, 5], "status": status, "t": [a, b]}


def test_plage_exacte_quand_la_suite_de_versets_est_identique():
    case = _case([_exp("67:1", 0, 5), _exp("67:2", 5, 10), _exp("67:3", 10, 15)])
    result = evaluate_identification(
        case, [_verse("67:1", 0, 5), _verse("67:2", 5, 10), _verse("67:3", 10, 15)]
    )
    assert result.kind == "reference"
    assert result.surah_hits == result.exact_hits == result.n_expected == 3
    assert result.range_exact is True and result.unrecognized is False
    assert result.extra_refs == ()


def test_sourate_juste_verset_faux_n_est_pas_un_verset_exact():
    case = _case([_exp("67:1", 0, 5), _exp("67:2", 5, 10)])
    result = evaluate_identification(case, [_verse("67:1", 0, 5), _verse("67:9", 5, 10)])
    assert result.n_expected == 2
    assert result.surah_hits == 2  # 67 est bien la sourate
    assert result.exact_hits == 1
    assert result.range_exact is False
    assert [str(r) for r in result.extra_refs] == ["67:9"]  # faux verset nommé (I3)


def test_mauvaise_sourate_aucun_point():
    case = _case([_exp("67:1", 0, 5)])
    result = evaluate_identification(case, [_verse("112:1", 0, 5)])
    assert result.surah_hits == 0 and result.exact_hits == 0 and not result.range_exact
    assert result.unrecognized is False  # il a nommé autre chose : faux, pas « non reconnu »


def test_non_reconnu_quand_aucun_verset_recognized():
    case = _case([_exp("67:1", 0, 5)])
    for status in ("inferred", "uncertain"):  # jamais une reconnaissance
        result = evaluate_identification(case, [_verse("67:1", 0, 5, status)])
        assert result.unrecognized is True and result.exact_hits == 0
    abstention = {"kind": "abstention", "reason": "below_threshold", "t": [0.0, 5.0]}
    assert evaluate_identification(case, [abstention]).unrecognized is True
    assert evaluate_identification(case, []).unrecognized is True


def test_verset_decoupe_en_deux_detections_compte_une_fois():
    case = _case([_exp("2:255", 0, 20)])
    result = evaluate_identification(case, [_verse("2:255", 0, 9), _verse("2:255", 9.5, 20)])
    assert result.predicted_refs == (VerseRef(2, 255),) and result.range_exact is True


def test_ordre_ou_ajout_casse_la_plage_exacte():
    case = _case([_exp("67:1", 0, 5), _exp("67:2", 5, 10)])
    swapped = [_verse("67:2", 0, 5), _verse("67:1", 5, 10)]
    assert evaluate_identification(case, swapped).range_exact is False
    extra = [_verse("67:1", 0, 5), _verse("67:2", 5, 10), _verse("67:3", 10, 15)]
    result = evaluate_identification(case, extra)
    assert result.range_exact is False and result.exact_hits == 2 and len(result.extra_refs) == 1


def test_cas_silence_et_hors_cible_faux_positifs():
    silence = _case(non_quran=[NonQuranItem((0, 30), NonQuranKind.SILENCE)], id="s1")
    french = _case(non_quran=[NonQuranItem((0, 30), NonQuranKind.FRENCH)], id="f1")
    arabic = _case(non_quran=[NonQuranItem((0, 30), NonQuranKind.ARABIC_SPEECH)], id="a1")
    noisy = _case(non_quran=[NonQuranItem((0, 30), NonQuranKind.NOISE)], id="n1")
    assert evaluate_identification(silence, []).kind == "silence"
    assert evaluate_identification(noisy, []).kind == "silence"
    assert evaluate_identification(french, []).kind == "off_target"
    assert evaluate_identification(arabic, []).kind == "off_target"
    bad = evaluate_identification(french, [_verse("1:2", 3, 6), _verse("1:3", 6, 9)])
    assert bad.n_false_positive_verses == 2
    clean = evaluate_identification(french, [_verse("1:2", 3, 6, "uncertain")])
    assert clean.n_false_positive_verses == 0  # uncertain n'est pas une reconnaissance


def test_condition_declaree_par_le_corpus_de_reference_prime_sur_les_zones():
    zones = [NonQuranItem((0, 30), NonQuranKind.FRENCH)]
    silence = _case(non_quran=zones, extra={"ref": {"schema": 1, "condition": "silence"}})
    off_target = _case(
        non_quran=[NonQuranItem((0, 30), NonQuranKind.SILENCE)],
        extra={"ref": {"schema": 1, "condition": "off_target"}},
    )
    other = _case(non_quran=zones, extra={"ref": {"schema": 1, "condition": "clean"}})
    assert evaluate_identification(silence, []).kind == "silence"
    assert evaluate_identification(off_target, []).kind == "off_target"
    assert evaluate_identification(other, []).kind == "off_target"  # repli : les zones


def test_cas_sans_expected_ne_compte_pas_dans_les_taux_de_versets():
    cases = [
        (_case([_exp("67:1", 0, 5)], id="r1"), [_verse("67:1", 0, 5)]),
        (_case([_exp("67:2", 0, 5)], id="r2"), []),
        (_case(non_quran=[NonQuranItem((0, 30), NonQuranKind.SILENCE)], id="s1"), []),
        (
            _case(non_quran=[NonQuranItem((0, 30), NonQuranKind.FRENCH)], id="f1"),
            [_verse("1:2", 1, 4)],
        ),
        (_case(non_quran=[NonQuranItem((0, 30), NonQuranKind.FRENCH)], id="f2"), []),
    ]
    agg = aggregate_identification([evaluate_identification(c, p) for c, p in cases])
    assert agg["n_reference_cases"] == 2 and agg["n_expected_verses"] == 2
    assert agg["verse_exact"]["hits"] == 1 and agg["verse_exact"]["total"] == 2
    assert agg["verse_exact"]["rate"] == pytest.approx(0.5)
    assert agg["verse_exact"]["ci95"] is not None
    assert agg["surah"]["hits"] == 1
    assert agg["range_exact"] == {**agg["range_exact"], "hits": 1, "total": 2}
    assert agg["unrecognized"] == {"n_cases": 1, "case_ids": ["r2"]}
    assert agg["silence"] == {
        "n_cases": 1,
        "n_false_positive_cases": 0,
        "n_false_positive_verses": 0,
    }
    assert agg["off_target"] == {
        "n_cases": 2,
        "n_false_positive_cases": 1,
        "n_false_positive_verses": 1,
    }


def test_agregat_vide_sans_taux_inventes():
    agg = aggregate_identification([])
    assert agg["verse_exact"]["rate"] is None and agg["surah"]["ci95"] is None
    assert agg["unrecognized"]["n_cases"] == 0


def test_fenetres_annotees_seul_le_milieu_dans_la_fenetre_est_juge():
    case = _case([_exp("67:1", 0, 5)], annotated_windows=((0.0, 10.0),))
    result = evaluate_identification(case, [_verse("67:1", 0, 5), _verse("67:9", 40, 45)])
    assert result.extra_refs == () and result.range_exact is True


def test_refuse_une_verite_non_controlee():
    case = _case([_exp("67:1", 0, 5)], annotation=None)
    with pytest.raises(EvaluationRefused):
        evaluate_identification(case, [])


@pytest.mark.parametrize("status", ["inferred", "uncertain"])
def test_inferred_et_uncertain_ne_comptent_dans_aucun_indicateur_d_identification(status):
    # Même verset, même sourate, bon temps : si le statut n'est pas `recognized`, aucun point.
    case = _case([_exp("67:1", 0, 5), _exp("67:2", 6, 11)])
    result = evaluate_identification(case, [_verse("67:1", 0, 5, status), _verse("67:2", 6, 11)])
    assert result.predicted_refs == (VerseRef.parse("67:2"),)  # seul le recognized est une réponse
    assert (
        result.exact_hits == 1 and result.surah_hits == 2
    )  # 67:2 nomme la sourate 67 pour les deux
    none = evaluate_identification(
        case, [_verse("67:1", 0, 5, status), _verse("67:2", 6, 11, status)]
    )
    assert (none.surah_hits, none.exact_hits, none.range_exact) == (0, 0, False)
    assert none.unrecognized is True and none.n_recognized == 0
    agg = aggregate_identification([none])
    assert agg["surah"]["hits"] == 0 and agg["surah"]["total"] == 2
    assert agg["verse_exact"]["hits"] == 0 and agg["range_exact"]["hits"] == 0
    assert agg["unrecognized"]["n_cases"] == 1


def test_le_denominateur_fusionne_les_versets_attendus_consecutifs_identiques():
    # deux entrées consécutives du MÊME verset comptent une fois ici (waqf : un verset annoté en
    # deux plages de mots ; répétition : un verset puis la reprise de ses derniers mots), alors
    # que `n_reference_verses` du bloc de localisation compte chaque entrée : 232 contre 216 au dev
    case = _case([_exp("67:1", 0, 5), _exp("67:1", 6, 11), _exp("67:2", 12, 17)])
    result = evaluate_identification(case, [_verse("67:1", 0, 5)])
    assert result.n_expected == 2 and result.expected_refs == (
        VerseRef.parse("67:1"),
        VerseRef.parse("67:2"),
    )
    agg = aggregate_identification([result])
    assert agg["n_expected_verses"] == 2 and agg["surah"]["total"] == 2
    assert len(case.expected) == 3  # le cas, lui, porte trois versets de référence
