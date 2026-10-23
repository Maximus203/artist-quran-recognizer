"""Courbe de vitesse (`aqr.eval.speed_curve`) : grille, estimateurs, règle de décision.

Partie pure : aucun modèle, aucun audio, aucun ffmpeg."""

from __future__ import annotations

import copy
import math

import pytest

from aqr.alignment.verification import AcousticCheckConfig
from aqr.domain.models import Status, VerseRef
from aqr.eval.degradation_curve import FileScore
from aqr.eval.recognition import (
    AbstentionInterval,
    NonQuranInterval,
    Recognition,
    VerseInterval,
)
from aqr.eval.speed_curve import (
    MAX_NET_SPEED,
    REAL_FACTORS,
    SPEED_RULE,
    STRETCHES,
    TEMOIN_COMPENSATIONS,
    aggregate_rate,
    cell_id,
    choose_estimator,
    decide_speed,
    interval_rates,
    leave_reciter_out,
    median,
    profile_recognition,
    real_verdict,
    relative_error,
    rescale_document,
    snap_compensation,
    temoin_cells,
    temoin_rows,
    temoin_verdict,
)


def score(expected: int, recognized: int, false: int = 0) -> FileScore:
    return FileScore(
        expected=expected,
        recognized=recognized,
        located=recognized,
        inferred=0,
        uncertain=0,
        missed=expected - recognized,
        false_recognized=false,
        false_inferred=0,
        misplaced=0,
        abstentions=0,
        abstention_s=0.0,
    )


def verse(ref: str, t: tuple[float, float], words: tuple[int, int] = (1, 4)) -> VerseInterval:
    return VerseInterval(VerseRef.parse(ref), words[0], words[1], Status.RECOGNIZED, t)


# --- grille ----------------------------------------------------------------------------------


def test_la_grille_des_temoins_reste_sous_la_vitesse_nette_maximale() -> None:
    cells = temoin_cells()
    assert (1.0, 1.0) in cells and (0.3, 4.0) in cells and (0.4, 2.5) in cells
    assert all(s * c <= MAX_NET_SPEED + 1e-9 for s, c in cells)
    assert (1.0, 4.0) not in cells  # propre accéléré ×4 : hors cahier
    assert len(cells) == len(set(cells))
    assert {s for s, _c in cells} == set(STRETCHES)
    assert {c for _s, c in cells} <= set(TEMOIN_COMPENSATIONS)


def test_la_grille_des_vrais_fichiers_va_de_1_a_2_5() -> None:
    assert REAL_FACTORS == (1.0, 1.25, 1.5, 2.0, 2.5)


def test_identifiant_de_cellule_stable() -> None:
    assert cell_id(0.4, 2.0) == "s0.4_c2"
    assert cell_id(1.0, 1.25) == "s1_c1.25"


# --- remise à l'échelle -----------------------------------------------------------------------


def document() -> dict[str, object]:
    return {
        "schema": "aqr.recognition/1",
        "source": {"file": "x.wav", "duration_s": 10.0},
        "acoustic_checks": [{"kind": "chain", "t": [1.0, 2.0], "verses": "1:1[1-2]"}],
        "intervals": [
            {
                "kind": "verse",
                "ref": "1:2",
                "t": [1.0, 3.0],
                "word_times": [[1.0, 2.0], [2.0, 3.0]],
                "word_times_source": "ctc-alignment",
            },
            {"kind": "abstention", "reason": "no_candidate", "t": [4.0, 6.0], "best_score": None},
            {"kind": "non_quran", "label": "silence", "t": [7.0, 8.0]},
            {"kind": "verse", "ref": "1:3", "t": None, "status": "inferred"},
        ],
    }


def test_rescale_multiplie_tous_les_temps_par_le_facteur() -> None:
    out = rescale_document(document(), 2.5)
    assert out["source"]["duration_s"] == 25.0  # type: ignore[index]
    assert out["acoustic_checks"][0]["t"] == [2.5, 5.0]  # type: ignore[index]
    first = out["intervals"][0]  # type: ignore[index]
    assert first["t"] == [2.5, 7.5]
    assert first["word_times"] == [[2.5, 5.0], [5.0, 7.5]]
    assert out["intervals"][1]["t"] == [10.0, 15.0]  # type: ignore[index]
    assert out["intervals"][2]["t"] == [17.5, 20.0]  # type: ignore[index]
    assert out["intervals"][3]["t"] is None  # type: ignore[index]
    assert out["speed_compensation"] == 2.5


def test_rescale_ne_modifie_pas_le_document_d_origine() -> None:
    original = document()
    snapshot = copy.deepcopy(original)
    rescale_document(original, 3.0)
    assert original == snapshot


def test_rescale_facteur_un_ne_change_aucun_temps() -> None:
    out = rescale_document(document(), 1.0)
    assert out["intervals"][0]["t"] == [1.0, 3.0]  # type: ignore[index]


@pytest.mark.parametrize("factor", [0.0, -1.0])
def test_rescale_refuse_un_facteur_invalide(factor: float) -> None:
    with pytest.raises(ValueError):
        rescale_document(document(), factor)


def test_rescale_arrondit_a_la_milliseconde() -> None:
    doc = document()
    doc["intervals"][0]["t"] = [0.1234, 0.5678]  # type: ignore[index]
    doc["intervals"][0]["word_times"] = [[0.1234, 0.3], [0.3, 0.5678]]  # type: ignore[index]
    out = rescale_document(doc, 1.25)
    assert out["intervals"][0]["t"] == [0.154, 0.71]  # type: ignore[index]


# --- choix de la compensation -----------------------------------------------------------------


def test_pas_de_compensation_au_dessus_du_seuil_d_activation() -> None:
    assert snap_compensation(1.0) == 1.0
    assert snap_compensation(0.76) == 1.0
    assert snap_compensation(2.0) == 1.0  # plus rapide que la normale


def test_la_compensation_est_l_inverse_ramene_a_la_grille() -> None:
    assert snap_compensation(0.5) == 2.0
    assert snap_compensation(0.4) == 2.5
    assert snap_compensation(0.3) == 3.0
    assert snap_compensation(0.7) == 1.5  # 1/0,7 = 1,43 -> 1,5
    assert snap_compensation(0.55) == 2.0  # 1/0,55 = 1,82 -> 2 (échelle logarithmique)


def test_la_compensation_est_bornee_par_la_grille() -> None:
    assert snap_compensation(0.1) == max(SPEED_RULE.compensations)
    assert snap_compensation(0.0) == max(SPEED_RULE.compensations)


def test_la_compensation_se_limite_a_une_grille_donnee() -> None:
    assert snap_compensation(0.25, grid=(1.25, 1.5, 2.0, 2.5)) == 2.5


# --- estimateurs ------------------------------------------------------------------------------


def test_debit_agrege_somme_des_poids_sur_somme_des_durees() -> None:
    assert aggregate_rate([(4, 2.0), (6, 3.0)]) == pytest.approx(2.0)
    assert aggregate_rate([]) is None


def test_les_intervalles_courts_et_non_reconnus_ne_comptent_pas() -> None:
    rec = Recognition(
        intervals=(
            verse("1:2", (0.0, 4.0), (1, 4)),  # 4 mots / 4 s
            verse("1:3", (5.0, 6.0), (1, 2)),  # 2 mots : trop court pour l'estimateur
            VerseInterval(VerseRef.parse("1:4"), 1, 5, Status.INFERRED, None),
            VerseInterval(VerseRef.parse("1:5"), 1, 5, Status.UNCERTAIN, (7.0, 9.0)),
            AbstentionInterval("no_candidate", (10.0, 12.0)),
            NonQuranInterval("silence", (13.0, 14.0)),
        )
    )
    assert interval_rates(rec, lambda i: i.last_word - i.first_word + 1) == [(4, 4.0)]
    assert interval_rates(rec, lambda i: 10, min_words=2) == [(10, 4.0), (10, 1.0)]


def test_mediane() -> None:
    assert median([3.0, 1.0, 2.0]) == 2.0
    assert median([1.0, 2.0, 3.0, 4.0]) == 2.5
    with pytest.raises(ValueError):
        median([])


def test_le_debit_typique_d_un_fichier_exclut_son_recitant() -> None:
    raw = {"A-1": 1.0, "A-2": 1.2, "B-1": 2.0, "C-1": 3.0}
    reciter = {"A-1": "A", "A-2": "A", "B-1": "B", "C-1": "C"}
    typical = leave_reciter_out(raw, reciter)
    assert typical["A-1"] == typical["A-2"] == 2.5  # médiane de B et C
    assert typical["B-1"] == 1.2  # médiane de 1,0 ; 1,2 ; 3,0
    assert typical["C-1"] == 1.2


def test_leave_reciter_out_exige_un_autre_recitant() -> None:
    with pytest.raises(ValueError):
        leave_reciter_out({"A-1": 1.0, "A-2": 1.1}, {"A-1": "A", "A-2": "A"})


def test_erreur_relative() -> None:
    assert relative_error(0.45, 0.5) == pytest.approx(0.1)
    assert relative_error(0.55, 0.5) == pytest.approx(0.1)
    with pytest.raises(ValueError):
        relative_error(0.5, 0.0)


def test_l_estimateur_retenu_a_la_plus_petite_erreur_mediane() -> None:
    errors = {"a": [0.1, 0.5, 0.2], "b": [0.15, 0.16, 0.17], "c": [0.4, 0.4, 0.4]}
    assert choose_estimator(errors) == "b"
    assert choose_estimator({"y": [0.2], "x": [0.2]}) == "x"  # égalité : ordre alphabétique


# --- profil d'une reconnaissance (vrais fichiers, sans vérité) -------------------------------


def test_profil_compte_versets_distincts_suites_et_temps() -> None:
    rec = Recognition(
        intervals=(
            verse("2:1", (0.0, 2.0)),
            verse("2:2", (2.0, 5.0)),
            verse("2:2", (5.0, 6.0)),  # redit : même verset distinct
            verse("2:3", (6.0, 8.0)),
            verse("2:10", (20.0, 24.0)),  # isolé
            VerseInterval(VerseRef.parse("2:20"), 1, 3, Status.UNCERTAIN, (30.0, 31.0)),
            VerseInterval(VerseRef.parse("2:21"), 1, 3, Status.INFERRED, None),
            AbstentionInterval("below_threshold", (9.0, 12.0), 0.2),
            AbstentionInterval("no_candidate", (11.0, 14.0)),  # recouvre : l'union compte une fois
            NonQuranInterval("istiadha", (15.0, 16.0)),
        )
    )
    profile = profile_recognition(rec, duration_s=40.0)
    assert profile.recognized == frozenset(VerseRef.parse(r) for r in ("2:1", "2:2", "2:3", "2:10"))
    assert profile.inferred == frozenset({VerseRef.parse("2:21")})
    assert profile.recognized_intervals == 5
    assert profile.uncertain_intervals == 1
    assert profile.runs == (3, 1)  # 2:1-2:3 puis 2:10
    assert profile.coherent_share == pytest.approx(3 / 4)
    assert profile.abstention_s == pytest.approx(5.0)  # 9 -> 14
    assert profile.abstention_share == pytest.approx(5.0 / 40.0)
    assert profile.recognized_s == pytest.approx(8.0 + 4.0)  # 0->8 puis 20->24
    assert profile.duration_s == 40.0


def test_une_suite_traverse_la_frontiere_de_sourate() -> None:
    rec = Recognition(intervals=(verse("1:7", (0.0, 2.0)), verse("2:1", (2.0, 4.0))))
    assert profile_recognition(rec, duration_s=10.0).runs == (2,)


def test_profil_d_une_reconnaissance_vide() -> None:
    profile = profile_recognition(Recognition(intervals=()), duration_s=10.0)
    assert profile.recognized == frozenset() and profile.runs == ()
    assert profile.coherent_share == 0.0
    assert profile.abstention_share == 0.0


# --- règle de décision ------------------------------------------------------------------------


def test_la_regle_est_celle_ecrite_d_avance() -> None:
    rule = SPEED_RULE
    assert rule.judged_stretches == (0.4, 0.3)
    assert rule.min_gain_points == 10.0
    assert rule.max_false == 0
    assert rule.activation_ratio == 0.75
    assert rule.min_new_verses == 3
    assert rule.max_new_on_controls == 0
    assert rule.max_regression_points == 2.0
    assert rule.min_words_per_interval == 3
    assert rule.compensations == (1.25, 1.5, 2.0, 2.5, 3.0, 4.0)


def test_le_seuil_acoustique_de_la_regle_est_celui_de_la_cascade() -> None:
    assert AcousticCheckConfig().min_llr_per_frame == SPEED_RULE.min_llr_per_frame


def matrix(
    recall_by_cell: dict[tuple[float, float], tuple[int, int]],
    files: tuple[str, ...] = ("f1", "f2"),
    false_by_cell: dict[tuple[float, float], int] | None = None,
) -> dict[tuple[float, float], dict[str, FileScore]]:
    out: dict[tuple[float, float], dict[str, FileScore]] = {}
    for cell, (expected, recognized) in recall_by_cell.items():
        false = (false_by_cell or {}).get(cell, 0)
        out[cell] = {f: score(expected, recognized, false if f == files[0] else 0) for f in files}
    return out


def full_matrix(slow_gain: int, false_est: int = 0, regression: int = 0):  # type: ignore[no-untyped-def]
    cells: dict[tuple[float, float], tuple[int, int]] = {}
    for s in STRETCHES:
        for c in TEMOIN_COMPENSATIONS:
            cells[(s, c)] = (10, 10)
    cells[(1.0, 1.0)] = (10, 10)
    for s, base in ((0.4, 6), (0.3, 3)):
        cells[(s, 1.0)] = (10, base)
        cells[(s, snap_compensation(s))] = (10, min(10, base + slow_gain))
    cells[(0.6, snap_compensation(0.6))] = (10, 10 - regression)
    return matrix(cells, false_by_cell={(0.3, snap_compensation(0.3)): false_est})


def chosen_for(files: tuple[str, ...] = ("f1", "f2")) -> dict[tuple[float, str], float]:
    return {(s, f): snap_compensation(s) for s in STRETCHES for f in files}


def test_le_gain_du_facteur_estime_est_mesure_contre_le_facteur_un() -> None:
    rows = temoin_rows(full_matrix(slow_gain=4), chosen_for())
    by_stretch = {r.stretch: r for r in rows}
    assert by_stretch[0.4].recall_one == pytest.approx(0.6)
    assert by_stretch[0.4].recall_estimated == pytest.approx(1.0)
    assert by_stretch[0.4].gain_points == pytest.approx(40.0)
    assert by_stretch[1.0].gain_points == pytest.approx(0.0)


def test_verdict_temoins_vrai_quand_le_gain_et_la_precision_suffisent() -> None:
    ok, reasons = temoin_verdict(temoin_rows(full_matrix(slow_gain=4), chosen_for()))
    assert ok and reasons == ()


def test_verdict_temoins_faux_quand_le_gain_est_trop_petit() -> None:
    ok, reasons = temoin_verdict(temoin_rows(full_matrix(slow_gain=0), chosen_for()))
    assert not ok
    assert any("×0,4" in r and "gain" in r for r in reasons)


def test_verdict_temoins_faux_au_moindre_faux_verset_a_vitesse_basse() -> None:
    ok, reasons = temoin_verdict(temoin_rows(full_matrix(slow_gain=4, false_est=1), chosen_for()))
    assert not ok
    assert any("faux" in r for r in reasons)


def test_verdict_temoins_faux_si_le_facteur_estime_degrade_une_vitesse_moderee() -> None:
    ok, reasons = temoin_verdict(
        temoin_rows(full_matrix(slow_gain=4, regression=5), chosen_for())
    )  # ×0,6 : 10 -> 5 sur 10 pour les deux fichiers
    assert not ok
    assert any("×0,6" in r for r in reasons)


def test_une_cellule_absente_de_la_matrice_est_une_erreur_explicite() -> None:
    chosen = chosen_for()
    chosen[(0.4, "f1")] = 3.5  # facteur hors grille
    with pytest.raises(KeyError):
        temoin_rows(full_matrix(slow_gain=4), chosen)


def test_verdict_vrais_fichiers() -> None:
    ok, reasons = real_verdict(slow_supported={"a": 5, "b": 0}, controls_new={"c": 0, "d": 0})
    assert ok and reasons == ()


def test_verdict_vrais_fichiers_exige_assez_de_versets_soutenus() -> None:
    ok, reasons = real_verdict(slow_supported={"a": 2, "b": 1}, controls_new={"c": 0})
    assert not ok
    assert any("soutenus" in r for r in reasons)


def test_verdict_vrais_fichiers_refuse_un_verset_nouveau_sur_un_fichier_sans_coran() -> None:
    ok, reasons = real_verdict(slow_supported={"a": 9}, controls_new={"c": 1})
    assert not ok
    assert any("c" in r and "sans Coran" in r for r in reasons)


def test_decision_finale() -> None:
    assert decide_speed(True, True).startswith("implémenter")
    assert decide_speed(True, False).startswith("ne pas implémenter")
    assert decide_speed(False, True).startswith("ne pas implémenter")
    assert math.isfinite(SPEED_RULE.min_gain_points)
