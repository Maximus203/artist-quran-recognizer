"""Rapport de la courbe de dégradation : tableaux, courbes et verdicts (partie pure)."""

from __future__ import annotations

from aqr.eval.degradation_curve import FileScore, ScoreRecord, build_conditions
from aqr.eval.degradation_report import (
    compute_verdicts,
    format_percent,
    render_curves,
    render_decision,
    render_table,
)

FILES = ("a", "b", "c", "d")


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


def rows(condition: str, mode: str, ratio: float, false: int = 0) -> dict[str, ScoreRecord]:
    out = {}
    for name in FILES:
        expected = 20
        out[name] = ScoreRecord(
            condition=condition,
            mode=mode,
            file=name,
            audio_sha256="x",
            audio_s=60.0,
            wall_s=6.0,
            score=score(expected, round(expected * ratio), false),
            word_errors=10,
            word_total=100,
            letter_errors=20,
            letter_total=500,
        )
    return out


def campaign() -> dict[str, dict[str, ScoreRecord]]:
    """Propre à 100 %, tout à 100 % sauf la vitesse ×0,6 à 50 % (toutes les conditions mesurées)."""
    result = {}
    for cond in build_conditions():
        ratio = 0.5 if cond.id == "lent_x0.6" else 1.0
        result[cond.id] = rows(cond.id, "solo", ratio)
    return result


def test_pourcentage_a_la_francaise() -> None:
    assert format_percent(0.923) == "92,3 %"
    assert format_percent(None) == "n/d"
    assert format_percent(1.0) == "100,0 %"


def test_verdicts_designent_la_famille_qui_echoue() -> None:
    verdicts, decision = compute_verdicts(campaign())
    assert verdicts["lent"].status == "échoue"
    assert verdicts["mp3"].status == "robuste"
    assert decision.verdict == "justifié" and decision.failing == ("lent",)


def test_verdicts_sans_les_conditions_manquantes() -> None:
    partial = {k: v for k, v in campaign().items() if k in ("propre", "mp3_48k")}
    verdicts, _decision = compute_verdicts(partial)
    assert set(verdicts) == {"mp3"}  # une famille sans son ancre n'est pas jugée


def test_tableau_liste_chaque_condition_mesuree_avec_sa_cascade() -> None:
    solo = campaign()
    cascade = {
        "propre": rows("propre", "cascade", 1.0),
        "lent_x0.6": rows("lent_x0.6", "cascade", 0.8),
    }
    table = render_table(solo, cascade)
    assert "| propre (référence) |" in table and "| bruit blanc, SNR 10 dB |" in table
    line = next(row for row in table.splitlines() if row.startswith("| vitesse ×0,6"))
    assert "50,0 %" in line and "80,0 %" in line


def test_courbes_par_famille_ordonnees_du_propre_au_plus_severe() -> None:
    text = render_curves(campaign())
    assert text.index("### mp3") < text.index("### lent")
    block = text.split("### lent")[1]
    assert block.index("propre") < block.index("×0,8") < block.index("×0,6") < block.index("×0,5")
    assert "█" in text and "░" in text


def test_decision_ecrite_en_clair() -> None:
    verdicts, decision = compute_verdicts(campaign())
    text = render_decision(verdicts, decision)
    assert "justifié" in text and "lent" in text and "15" in text
