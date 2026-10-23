"""Rapport de la courbe de dégradation : tableaux, courbes ASCII et verdicts (partie pure).

Lit des `ScoreRecord` (`aqr.eval.degradation_curve`) et ne rend que du texte Markdown : aucune
valeur n'est écrite à la main, tout vient des enregistrements de la campagne.
"""

from __future__ import annotations

from collections.abc import Mapping

from aqr.eval.degradation_curve import (
    CLEAN_ID,
    DECISION_RULE,
    Condition,
    Decision,
    FamilyVerdict,
    ScoreRecord,
    all_conditions,
    ascii_bar,
    build_conditions,
    decide,
    family_verdict,
    summarize,
)

Campaign = Mapping[str, Mapping[str, ScoreRecord]]
"""{condition: {fichier: enregistrement}} pour un mode."""


def format_percent(value: float | None) -> str:
    return "n/d" if value is None else f"{value * 100:.1f} %".replace(".", ",")


def _number(value: float | None, digits: int = 1) -> str:
    return "n/d" if value is None else f"{value:.{digits}f}".replace(".", ",")


def _measured(campaign: Campaign) -> list[Condition]:
    return [c for c in all_conditions() if c.id in campaign]


def render_table(solo: Campaign, cascade: Campaign | None = None) -> str:
    """Une ligne par condition mesurée : moteur seul (rappel, faux, WER...), cascade si mesurée."""
    cascade = cascade or {}
    lines = [
        "| Condition | Rappel (IC 95 %) | Bien placés | Faux | Inférés | Incertains | Manqués "
        "| Abst. | WER | CER | RTF | Rappel cascade | Faux cascade |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for cond in _measured(solo):
        s = summarize(solo[cond.id].values())
        total = s.score
        low, high = s.recall_ci
        recall = (
            f"{format_percent(total.recall)} ({total.recognized}/{total.expected}; "
            f"{format_percent(low)}-{format_percent(high)})"
        )
        placed = format_percent(total.located / total.expected if total.expected else None)
        cas = cascade.get(cond.id)
        cas_total = summarize(cas.values()).score if cas else None
        cascade_recall = format_percent(cas_total.recall) if cas_total else "-"
        cascade_false = str(cas_total.false_recognized) if cas_total else "-"
        label = f"{cond.label} †" if cond.exploratory else cond.label
        lines.append(
            f"| {label} | {recall} | {placed} | {total.false_recognized} | {total.inferred} "
            f"| {total.uncertain} | {total.missed} | {total.abstentions} | {format_percent(s.wer)} "
            f"| {format_percent(s.cer)} | {_number(s.rtf, 3)} "
            f"| {cascade_recall} | {cascade_false} |"
        )
    return "\n".join(lines)


def render_curves(solo: Campaign, cascade: Campaign | None = None) -> str:
    """Une courbe par famille : le propre, puis les niveaux du moins au plus sévère."""
    cascade = cascade or {}
    clean = next(c for c in build_conditions() if c.id == CLEAN_ID)
    blocks: list[str] = []
    families = dict.fromkeys(c.family for c in all_conditions() if c.family != "propre")
    for family in families:
        members = [c for c in _measured(solo) if c.family == family]
        if not members:
            continue
        lines = [f"### {family}", "", "```"]
        for cond in [clean, *members] if CLEAN_ID in solo else members:
            s = summarize(solo[cond.id].values())
            level = f"{cond.level} †" if cond.exploratory else cond.level
            row = (
                f"{level:<38} {ascii_bar(s.score.recall)} {format_percent(s.score.recall):>8}"
                f"   WER {format_percent(s.wer):>7}"
            )
            if cond.id in cascade:
                cas = summarize(cascade[cond.id].values()).score.recall
                row += f"   cascade {format_percent(cas):>8}"
            lines.append(row)
        lines.append("```")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def compute_verdicts(solo: Campaign) -> tuple[dict[str, FamilyVerdict], Decision]:
    """Verdict de chaque famille dont l'ancre est mesurée, puis la décision (propre requis)."""
    if CLEAN_ID not in solo:
        raise ValueError("la condition propre n'est pas mesurée : aucune comparaison possible")
    clean = {name: rec.score for name, rec in solo[CLEAN_ID].items()}
    verdicts: dict[str, FamilyVerdict] = {}
    for cond in build_conditions():
        if cond.anchor and cond.id in solo:
            anchor = {name: rec.score for name, rec in solo[cond.id].items()}
            verdicts[cond.family] = family_verdict(cond.family, clean, anchor)
    return verdicts, decide(clean, verdicts)


def render_decision(verdicts: Mapping[str, FamilyVerdict], decision: Decision) -> str:
    rule = DECISION_RULE
    anchors = {c.family: c for c in build_conditions() if c.anchor}
    lines = [
        "| Famille | Niveau jugé | Propre | À ce niveau | Chute (points) | Fichiers touchés "
        "| Faux / 100 | Verdict |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for family, v in verdicts.items():
        required = " (obligatoire)" if anchors[family].required else ""
        alert = " ⚠ précision" if v.false_alert else ""
        lines.append(
            f"| {family}{required} | {anchors[family].level} | {format_percent(v.clean_recall)} "
            f"| {format_percent(v.anchor_recall)} | {_number(v.drop_points)} "
            f"| {v.files_hurt}/{v.files_total} | {_number(v.false_per_100, 2)} "
            f"| **{v.status}**{alert} |"
        )
    lines += [
        "",
        f"Règle appliquée : échec = chute > {rule.fail_drop_points:g} points ET au moins "
        f"{rule.file_share:.0%} des fichiers perdent plus de {rule.file_drop_points:g} points ; "
        f"robuste = chute ≤ {rule.robust_drop_points:g} points ; plancher du propre "
        f"{rule.clean_min_recall:.0%}.",
        "",
        f"**Décision : {decision.verdict}** "
        f"(rappel du propre {format_percent(decision.clean_recall)}"
        f" ; {decision.reason}).",
    ]
    if decision.failing:
        lines.append(
            "Familles obligatoires en échec, cibles d'un fine-tuning : "
            f"{', '.join(decision.failing)}."
        )
    if decision.secondary_failing:
        lines.append(
            "Familles complémentaires en échec (à viser aussi, ne décident pas seules) : "
            f"{', '.join(decision.secondary_failing)}."
        )
    return "\n".join(lines)


def render_cascade(solo: Campaign, cascade: Campaign) -> str:
    """La cascade rattrape-t-elle la chute du moteur seul sur les conditions clés ?"""
    if CLEAN_ID not in solo or CLEAN_ID not in cascade:
        return "Cascade : propre non mesuré."
    lines = [
        "| Condition | Seul | Cascade | Gain (points) | Faux seul → cascade "
        "| Temps seul → cascade |",
        "|---|---|---|---|---|---|",
    ]
    for cond in _measured(cascade):
        if cond.id not in solo:
            continue
        a, b = summarize(solo[cond.id].values()), summarize(cascade[cond.id].values())
        gain = ((b.score.recall or 0) - (a.score.recall or 0)) * 100
        lines.append(
            f"| {cond.label} | {format_percent(a.score.recall)} | {format_percent(b.score.recall)} "
            f"| {_number(gain)} | {a.score.false_recognized} → {b.score.false_recognized} "
            f"| {_number(a.wall_s, 0)} s → {_number(b.wall_s, 0)} s |"
        )
    return "\n".join(lines)
