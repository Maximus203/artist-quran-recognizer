"""Courbe de dégradation (`aqr.eval.degradation_curve`) : conditions, notation, règle de décision.

Partie pure : aucun modèle, aucun audio, aucun ffmpeg."""

from __future__ import annotations

import pytest

from aqr.domain.models import Status, VerseRef
from aqr.eval.degradation_curve import (
    CLEAN_ID,
    DECISION_RULE,
    FileScore,
    TruthVerse,
    build_conditions,
    conditions_by_id,
    decide,
    family_verdict,
    scale_truth,
    score_file,
    totals,
    wilson_interval,
)
from aqr.eval.recognition import (
    AbstentionInterval,
    NonQuranInterval,
    Recognition,
    VerseInterval,
)


def v(ref: str, t: tuple[float, float], status: Status = Status.RECOGNIZED) -> VerseInterval:
    return VerseInterval(VerseRef.parse(ref), 1, 3, status, t)


def truth(*items: tuple[str, float, float]) -> list[TruthVerse]:
    return [TruthVerse(VerseRef.parse(r), a, b) for r, a, b in items]


def rec(*intervals: object) -> Recognition:
    return Recognition(intervals=tuple(intervals))  # type: ignore[arg-type]


# --- conditions ------------------------------------------------------------------------------


def test_les_conditions_couvrent_les_familles_demandees_avec_leurs_niveaux() -> None:
    conditions = build_conditions()
    ids = [c.id for c in conditions]
    assert len(ids) == len(set(ids))
    assert ids[0] == CLEAN_ID
    by_family: dict[str, list[str]] = {}
    for c in conditions:
        by_family.setdefault(c.family, []).append(c.id)
    assert set(by_family) == {
        "propre",
        "bruit_blanc",
        "bruit_rose",
        "reverberation",
        "telephone",
        "mp3",
        "lent",
        "combinaison",
    }
    for family, members in by_family.items():
        assert len(members) == (1 if family in ("propre", "combinaison") else 3), family


def test_une_ancre_par_famille_et_les_ancres_du_cahier_sont_obligatoires() -> None:
    conditions = [c for c in build_conditions() if c.family != "propre"]
    anchors = {c.family: c for c in conditions if c.anchor}
    assert set(anchors) == {c.family for c in conditions}
    assert {c.id for c in anchors.values() if c.required} == {
        "bruit_blanc_10db",
        "reverberation_moyenne",
        "mp3_48k",
        "lent_x0.6",
    }
    assert anchors["bruit_blanc"].params["snr_db"] == 10
    assert anchors["mp3"].params["kbps"] == 48
    assert anchors["lent"].tempo == 0.6


def test_gravite_croissante_dans_une_famille_et_tempo_seulement_pour_lent() -> None:
    by_family: dict[str, list[int]] = {}
    for c in build_conditions():
        by_family.setdefault(c.family, []).append(c.severity)
        if c.family != "lent":
            assert c.tempo == 1.0
    for family, severities in by_family.items():
        assert severities == sorted(severities), family
        assert len(set(severities)) == len(severities), family


def test_la_cascade_est_mesuree_sur_trois_conditions_cles() -> None:
    cascade = {c.id for c in build_conditions() if c.cascade}
    assert cascade == {CLEAN_ID, "bruit_blanc_10db", "lent_x0.6"}


def test_conditions_par_id_refuse_un_inconnu() -> None:
    assert conditions_by_id(["mp3_48k"])[0].family == "mp3"
    with pytest.raises(KeyError):
        conditions_by_id(["inconnue"])


def test_la_verite_suit_l_etirement_temporel() -> None:
    scaled = scale_truth(truth(("114:1", 2.0, 6.0)), tempo=0.5)
    assert (scaled[0].start_s, scaled[0].end_s) == (4.0, 12.0)
    assert scale_truth(truth(("114:1", 2.0, 6.0)), tempo=1.0)[0].end_s == 6.0
    with pytest.raises(ValueError):
        scale_truth(truth(("114:1", 2.0, 6.0)), tempo=0.0)


# --- notation d'un fichier --------------------------------------------------------------------


EXPECTED = truth(("114:1", 0.0, 5.0), ("114:2", 5.0, 9.0), ("114:3", 9.0, 14.0))


def test_tout_retrouve_et_bien_place() -> None:
    score = score_file(
        EXPECTED,
        rec(v("114:1", (0.2, 4.8)), v("114:2", (5.1, 8.9)), v("114:3", (9.2, 13.5))),
    )
    assert (score.expected, score.recognized, score.located) == (3, 3, 3)
    assert score.missed == 0 and score.false_recognized == 0 and score.recall == 1.0


def test_verset_absent_et_faux_verset_sont_comptes_separement() -> None:
    score = score_file(
        EXPECTED,
        rec(
            v("114:1", (0.0, 5.0)),
            v("112:1", (5.0, 9.0)),
            AbstentionInterval("below_threshold", (9, 14)),
        ),
    )
    assert score.recognized == 1 and score.missed == 2
    assert score.false_recognized == 1  # 112:1 n'était pas attendu : pire qu'un oubli (I3)
    assert score.abstentions == 1 and score.abstention_s == pytest.approx(5.0)


def test_un_verset_infere_ou_incertain_n_est_pas_un_succes() -> None:
    score = score_file(
        EXPECTED,
        rec(
            v("114:1", (0.0, 5.0)),
            v("114:2", (5.0, 9.0), Status.INFERRED),
            v("114:3", (9.0, 14.0), Status.UNCERTAIN),
        ),
    )
    assert score.recognized == 1 and score.inferred == 1 and score.uncertain == 1
    assert score.missed == 0 and score.recall == pytest.approx(1 / 3)


def test_un_verset_infere_hors_attendu_est_un_faux_infere() -> None:
    score = score_file(EXPECTED, rec(v("112:1", (0.0, 5.0), Status.INFERRED)))
    assert score.false_inferred == 1 and score.false_recognized == 0


def test_un_verset_reconnu_mais_au_mauvais_endroit_n_est_pas_bien_place() -> None:
    score = score_file(EXPECTED, rec(v("114:1", (30.0, 34.0))))
    assert score.recognized == 1 and score.located == 0 and score.misplaced == 1


def test_plusieurs_intervalles_d_un_meme_verset_comptent_une_fois() -> None:
    score = score_file(EXPECTED, rec(v("114:1", (0.0, 2.0)), v("114:1", (2.5, 5.0))))
    assert score.recognized == 1 and score.located == 1


def test_la_basmala_non_coranique_n_est_ni_attendue_ni_fausse() -> None:
    score = score_file(
        EXPECTED, rec(NonQuranInterval("basmala", (0.0, 1.0), basmala=True, ref=VerseRef(1, 1)))
    )
    assert score.false_recognized == 0 and score.recognized == 0 and score.missed == 3


def test_tolerance_de_placement() -> None:
    near = score_file(
        EXPECTED,
        rec(v("114:3", (14.5, 16.0))),
    )  # milieu 15,25 s : 1,25 s après la fin
    assert near.located == 0
    near = score_file(EXPECTED, rec(v("114:3", (13.5, 15.0))))  # milieu 14,25 s : dans la tolérance
    assert near.located == 1


def test_aucune_verite_est_une_erreur() -> None:
    with pytest.raises(ValueError):
        score_file([], rec())


# --- agrégation ---------------------------------------------------------------------------------


def fs(expected: int, recognized: int, **kw: float) -> FileScore:
    return FileScore(
        expected=expected,
        recognized=recognized,
        located=kw.get("located", recognized),
        inferred=0,
        uncertain=0,
        missed=expected - recognized,
        false_recognized=int(kw.get("false", 0)),
        false_inferred=0,
        misplaced=0,
        abstentions=0,
        abstention_s=0.0,
    )


def test_les_totaux_somment_les_comptes_et_le_rappel_est_micro() -> None:
    total = totals([fs(30, 30), fs(10, 5, false=1)])
    assert (total.expected, total.recognized, total.false_recognized) == (40, 35, 1)
    assert total.recall == pytest.approx(35 / 40)  # pas la moyenne de 1,0 et 0,5


def test_totaux_vides_sans_division() -> None:
    assert totals([]).recall is None


def test_intervalle_de_wilson() -> None:
    low, high = wilson_interval(190, 200)
    assert 0.90 < low < 0.95 < high < 0.98
    assert wilson_interval(0, 0) == (0.0, 1.0)
    assert wilson_interval(10, 10)[1] == pytest.approx(1.0)


# --- règle de décision écrite d'avance ---------------------------------------------------------


def files(recalls: dict[str, tuple[int, int]]) -> dict[str, FileScore]:
    return {name: fs(n, k) for name, (n, k) in recalls.items()}


CLEAN = files({"a": (30, 30), "b": (20, 20), "c": (10, 10), "d": (10, 10)})


def test_la_regle_est_celle_du_cahier() -> None:
    assert DECISION_RULE.clean_min_recall == 0.95
    assert DECISION_RULE.fail_drop_points == 15.0
    assert DECISION_RULE.robust_drop_points == 5.0


def test_famille_robuste_quand_la_chute_est_petite() -> None:
    anchor = files({"a": (30, 29), "b": (20, 20), "c": (10, 10), "d": (10, 10)})
    verdict = family_verdict("mp3", CLEAN, anchor)
    assert verdict.status == "robuste" and verdict.drop_points == pytest.approx(100 / 70)


def test_famille_en_echec_quand_la_chute_depasse_15_points_dans_la_moitie_des_fichiers() -> None:
    anchor = files({"a": (30, 20), "b": (20, 12), "c": (10, 10), "d": (10, 10)})
    verdict = family_verdict("lent", CLEAN, anchor)
    assert verdict.drop_points == pytest.approx(100 * 18 / 70)  # 25,7 points
    assert verdict.files_hurt == 2 and verdict.status == "échoue"


def test_une_chute_portee_par_un_seul_fichier_ne_suffit_pas() -> None:
    clean = files({"a": (100, 100), "b": (20, 20), "c": (20, 20), "d": (20, 20)})
    anchor = files({"a": (100, 60), "b": (20, 20), "c": (20, 20), "d": (20, 20)})
    verdict = family_verdict("lent", clean, anchor)
    assert verdict.drop_points == pytest.approx(100 * 40 / 160)  # 25 points agrégés
    assert verdict.files_hurt == 1 and verdict.status == "dégradée"


def test_chute_moyenne_est_degradee_sans_echec() -> None:
    anchor = files({"a": (30, 27), "b": (20, 18), "c": (10, 9), "d": (10, 10)})
    assert family_verdict("bruit", CLEAN, anchor).status == "dégradée"  # 6 points


def test_les_fichiers_doivent_etre_les_memes() -> None:
    with pytest.raises(ValueError):
        family_verdict("mp3", CLEAN, files({"a": (30, 30)}))


def test_alerte_precision_quand_des_faux_versets_apparaissent() -> None:
    anchor = {name: fs(s.expected, s.recognized, false=1) for name, s in CLEAN.items()}
    verdict = family_verdict("bruit", CLEAN, anchor)
    assert verdict.false_alert  # 4 faux pour 70 attendus : au-delà d'1 pour 100 (I3)


def test_decision_non_concluante_si_le_propre_est_deja_sous_95() -> None:
    weak = files({"a": (30, 25), "b": (20, 15)})
    decision = decide(weak, {"mp3": family_verdict("mp3", weak, weak)})
    assert decision.verdict == "non concluant"


def test_decision_fine_tuning_justifie_par_une_famille_obligatoire() -> None:
    anchor = files({"a": (30, 15), "b": (20, 8), "c": (10, 5), "d": (10, 5)})
    robust = family_verdict("mp3", CLEAN, CLEAN)
    failing = family_verdict("lent", CLEAN, anchor)
    decision = decide(CLEAN, {"mp3": robust, "lent": failing}, required={"mp3", "lent"})
    assert decision.verdict == "justifié" and decision.failing == ("lent",)


def test_une_famille_complementaire_en_echec_ne_decide_pas_seule() -> None:
    anchor = files({"a": (30, 15), "b": (20, 8), "c": (10, 5), "d": (10, 5)})
    decision = decide(
        CLEAN,
        {
            "mp3": family_verdict("mp3", CLEAN, CLEAN),
            "telephone": family_verdict("telephone", CLEAN, anchor),
        },
        required={"mp3"},
    )
    assert decision.verdict == "non justifié par les familles obligatoires"
    assert decision.failing == ()
    assert decision.secondary_failing == ("telephone",)


def test_decision_non_justifie_quand_tout_est_robuste() -> None:
    decision = decide(CLEAN, {"mp3": family_verdict("mp3", CLEAN, CLEAN)}, required={"mp3"})
    assert decision.verdict == "non justifié par les familles obligatoires"
