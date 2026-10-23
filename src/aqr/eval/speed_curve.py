"""Courbe de vitesse : réécouter un audio ACCÉLÉRÉ aide-t-il le moteur sur une récitation lente ?

Partie PURE de la campagne `scripts/measure_speed.py` (ni modèle, ni audio, ni ffmpeg) :

- la grille : étirements des témoins EveryAyah x facteurs de compensation (`temoin_cells`), facteurs
  appliqués aux vrais fichiers lents (`REAL_FACTORS`) ;
- la remise à l'échelle d'une sortie `aqr.recognition/1` calculée sur l'audio accéléré
  (`rescale_document`) : les temps reviennent à l'échelle de l'audio d'origine ;
- les estimateurs du débit de récitation, SANS vérité (`aggregate_rate`, `leave_reciter_out`,
  `choose_estimator`) et le choix du facteur de compensation à partir de l'estimation
  (`snap_compensation`) ;
- le profil d'une reconnaissance sans vérité (`profile_recognition`) : versets distincts, suites
  sans trou, temps non reconnu — des PROXYS, jamais un rappel ;
- la règle de décision (`SPEED_RULE`, `temoin_verdict`, `real_verdict`, `decide_speed`), écrite
  AVANT la mesure : elle dit quand un étage « candidat de vitesse » vaut d'être implémenté.

Le texte coranique n'apparaît nulle part ici (I1) : seules des références de versets et des temps.
"""

from __future__ import annotations

import copy
import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

from aqr.domain.models import Status, VerseRef
from aqr.eval.degradation_curve import FileScore, totals
from aqr.eval.recognition import (
    AbstentionInterval,
    Recognition,
    VerseInterval,
)

STRETCHES: Final = (1.0, 0.8, 0.6, 0.5, 0.4, 0.3)
"""Étirements des témoins : 1,0 = propre ; les autres sont ceux de la courbe de dégradation."""
TEMOIN_COMPENSATIONS: Final = (1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0)
"""Facteurs d'accélération essayés sur chaque témoin (`atempo`, hauteur conservée)."""
REAL_FACTORS: Final = (1.0, 1.25, 1.5, 2.0, 2.5)
"""Facteurs appliqués aux vrais fichiers : 1,0 est la référence."""
MAX_NET_SPEED: Final = 3.2
"""Au-delà (étirement x compensation), l'audio est plus rapide que toute récitation : la cellule n'a
aucun intérêt. Ne sert qu'à borner la grille."""
ROUND_S: Final = 3
EPSILON: Final = 1e-9

Cell = tuple[float, float]
"""(étirement du témoin, facteur de compensation)."""


# --- grille -----------------------------------------------------------------------------------


def temoin_cells() -> tuple[Cell, ...]:
    return tuple(
        (stretch, comp)
        for stretch in STRETCHES
        for comp in TEMOIN_COMPENSATIONS
        if stretch * comp <= MAX_NET_SPEED + EPSILON
    )


def cell_id(stretch: float, comp: float) -> str:
    """`s0.4_c2` : témoin étiré à ×0,4, accéléré ×2."""
    return f"s{stretch:g}_c{comp:g}"


def factor_label(value: float) -> str:
    return f"×{value:g}".replace(".", ",")


# --- remise à l'échelle -----------------------------------------------------------------------


def _scaled(pair: Any, factor: float) -> Any:
    if pair is None:
        return None
    return [round(float(x) * factor, ROUND_S) for x in pair]


def rescale_document(document: Mapping[str, Any], factor: float) -> dict[str, Any]:
    """Copie d'une sortie `aqr.recognition/1` calculée sur un audio ACCÉLÉRÉ de `factor`, dont tous
    les temps sont ramenés à l'échelle de l'audio d'origine (t x factor). Le document d'origine
    n'est jamais modifié. Champ additif `speed_compensation` : la provenance du facteur."""
    if factor <= 0 or not math.isfinite(factor):
        raise ValueError(f"facteur de compensation invalide : {factor}")
    out: dict[str, Any] = copy.deepcopy(dict(document))
    source = out.get("source")
    if isinstance(source, dict) and source.get("duration_s") is not None:
        source["duration_s"] = round(float(source["duration_s"]) * factor, ROUND_S)
    for check in out.get("acoustic_checks") or []:
        check["t"] = _scaled(check.get("t"), factor)
    for interval in out.get("intervals") or []:
        interval["t"] = _scaled(interval.get("t"), factor)
        if interval.get("word_times") is not None:
            interval["word_times"] = [_scaled(w, factor) for w in interval["word_times"]]
    out["speed_compensation"] = factor
    return out


# --- règle de décision, écrite avant la mesure --------------------------------------------------


@dataclass(frozen=True)
class SpeedRule:
    """Quand un étage « candidat de vitesse » est-il justifié ?

    Il l'est SEULEMENT si les deux parties sont vraies.

    (i) TÉMOINS (EveryAyah étiré, vérité exacte). Le facteur de compensation n'est PAS donné : il
    est ESTIMÉ fichier par fichier à partir de la première passe (×1,0), par l'estimateur de plus
    petite erreur relative médiane, puis ramené à la grille (`snap_compensation`). Aux étirements
    jugés (×0,4 et ×0,3), le rappel avec le facteur estimé gagne au moins `min_gain_points` points
    sur le rappel sans compensation, avec `max_false` faux verset. Aux autres étirements, le facteur
    estimé n'ajoute aucun faux verset et ne fait pas perdre plus de `max_regression_points`.

    (ii) VRAIS LENTS (sans vérité). Sur au moins un vrai fichier lent, le facteur estimé fait
    apparaître au moins `min_new_verses` versets DISTINCTS absents de la référence (×1,0), chacun
    soutenu par l'audio D'ORIGINE (alignement du texte du corpus, `llr` par trame au moins
    `min_llr_per_frame`) ; et sur chaque fichier sans Coran, `max_new_on_controls` verset nouveau
    (aucun) soutenu à n'importe quel facteur de la grille. L'étage ajoute des candidats sans jamais
    en retirer : aucun verset de la référence ne disparaît.
    """

    judged_stretches: tuple[float, ...] = (0.4, 0.3)
    min_gain_points: float = 10.0
    max_false: int = 0
    max_regression_points: float = 2.0
    activation_ratio: float = 0.75
    """Sous ce rapport (débit estimé / débit typique), la compensation s'active ; au-dessus, ×1."""
    compensations: tuple[float, ...] = (1.25, 1.5, 2.0, 2.5, 3.0, 4.0)
    min_words_per_interval: int = 3
    """Un intervalle reconnu de moins de mots ne compte pas dans l'estimateur de débit."""
    min_new_verses: int = 3
    max_new_on_controls: int = 0
    min_llr_per_frame: float = -1.0
    """Seuil de l'arbitre acoustique : celui de la cascade (`AcousticCheckConfig`)."""
    new_verse_pad_s: float = 0.5
    """Marge ajoutée de part et d'autre de l'intervalle d'un verset nouveau pour l'arbitrer."""


SPEED_RULE: Final = SpeedRule()


def snap_compensation(
    ratio: float, rule: SpeedRule = SPEED_RULE, grid: Sequence[float] | None = None
) -> float:
    """Facteur de compensation pour un rapport de débit estimé (débit / débit typique) : ×1,0 si la
    récitation n'est pas nettement plus lente que la normale ; sinon la valeur de la grille la plus
    proche de 1/ratio en échelle logarithmique (borne haute : la plus grande de la grille)."""
    choices = tuple(grid if grid is not None else rule.compensations)
    if ratio >= rule.activation_ratio:
        return 1.0
    if ratio <= 0:
        return max(choices)
    target = 1.0 / ratio
    return min(choices, key=lambda g: (abs(math.log(target / g)), g))


# --- estimateurs du débit (sans vérité) ---------------------------------------------------------


def interval_rates(
    recognition: Recognition,
    weight: Callable[[VerseInterval], int],
    min_words: int = SPEED_RULE.min_words_per_interval,
) -> list[tuple[int, float]]:
    """(poids, durée) de chaque intervalle `recognized` d'au moins `min_words` mots ; le poids est
    donné par l'appelant (mots, lettres du corpus)."""
    out: list[tuple[int, float]] = []
    for item in recognition.intervals:
        if (
            isinstance(item, VerseInterval)
            and item.status is Status.RECOGNIZED
            and item.t is not None
            and item.last_word - item.first_word + 1 >= min_words
            and item.t[1] > item.t[0]
        ):
            out.append((weight(item), item.t[1] - item.t[0]))
    return out


def aggregate_rate(pairs: Sequence[tuple[float, float]]) -> float | None:
    """Débit d'un fichier = somme des poids / somme des durées (None sans intervalle)."""
    duration = sum(d for _w, d in pairs)
    return sum(w for w, _d in pairs) / duration if duration > 0 else None


def median(values: Sequence[float]) -> float:
    if not values:
        raise ValueError("médiane d'une liste vide")
    ordered = sorted(values)
    middle = len(ordered) // 2
    return ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2


def leave_reciter_out(raw: Mapping[str, float], reciter_of: Mapping[str, str]) -> dict[str, float]:
    """Débit typique de chaque fichier propre = médiane des débits des fichiers des AUTRES
    récitants : le fichier étiré n'a jamais servi à calibrer le débit auquel on le compare."""
    out: dict[str, float] = {}
    for name in raw:
        others = [v for other, v in raw.items() if reciter_of[other] != reciter_of[name]]
        if not others:
            raise ValueError(f"{name} : aucun autre récitant pour établir le débit typique")
        out[name] = median(others)
    return out


def relative_error(estimate: float, truth: float) -> float:
    if truth <= 0:
        raise ValueError(f"vérité invalide : {truth}")
    return abs(estimate - truth) / truth


def choose_estimator(errors: Mapping[str, Sequence[float]]) -> str:
    """L'estimateur de plus petite erreur relative médiane ; à égalité, l'ordre alphabétique."""
    if not errors:
        raise ValueError("aucun estimateur")
    return min(errors, key=lambda name: (median(errors[name]), name))


# --- profil d'une reconnaissance, sans vérité -------------------------------------------------


def _union_length(spans: Sequence[tuple[float, float]]) -> float:
    total, end = 0.0, -math.inf
    for start, stop in sorted(spans):
        if start > end:
            total += stop - start
            end = stop
        elif stop > end:
            total += stop - end
            end = stop
    return total


@dataclass(frozen=True)
class Profile:
    """Ce qu'une reconnaissance dit d'un fichier SANS vérité : des proxys, pas un rappel."""

    duration_s: float
    recognized: frozenset[VerseRef]
    inferred: frozenset[VerseRef]
    recognized_intervals: int
    uncertain_intervals: int
    runs: tuple[int, ...]
    """Longueurs des suites de versets `recognized` consécutifs dans le Mushaf (sans trou)."""
    recognized_s: float
    abstention_s: float

    @property
    def coherent_share(self) -> float:
        """Part des versets distincts reconnus qui appartiennent à une suite d'au moins deux."""
        total = sum(self.runs)
        return sum(n for n in self.runs if n >= 2) / total if total else 0.0

    @property
    def abstention_share(self) -> float:
        return self.abstention_s / self.duration_s if self.duration_s else 0.0

    @property
    def recognized_share(self) -> float:
        return self.recognized_s / self.duration_s if self.duration_s else 0.0


def _runs(refs: frozenset[VerseRef]) -> tuple[int, ...]:
    runs: list[int] = []
    previous: VerseRef | None = None
    for ref in sorted(refs):
        if previous is not None and previous.next() == ref:
            runs[-1] += 1
        else:
            runs.append(1)
        previous = ref
    return tuple(runs)


def profile_recognition(recognition: Recognition, duration_s: float) -> Profile:
    recognized_refs: set[VerseRef] = set()
    inferred_refs: set[VerseRef] = set()
    recognized_spans: list[tuple[float, float]] = []
    abstentions: list[tuple[float, float]] = []
    recognized_intervals = uncertain_intervals = 0
    for item in recognition.intervals:
        if isinstance(item, VerseInterval):
            if item.status is Status.RECOGNIZED:
                recognized_refs.add(item.ref)
                recognized_intervals += 1
                if item.t is not None:
                    recognized_spans.append(item.t)
            elif item.status is Status.INFERRED:
                inferred_refs.add(item.ref)
            else:
                uncertain_intervals += 1
        elif isinstance(item, AbstentionInterval):
            abstentions.append(item.t)
    refs = frozenset(recognized_refs)
    return Profile(
        duration_s=duration_s,
        recognized=refs,
        inferred=frozenset(inferred_refs - recognized_refs),
        recognized_intervals=recognized_intervals,
        uncertain_intervals=uncertain_intervals,
        runs=_runs(refs),
        recognized_s=_union_length(recognized_spans),
        abstention_s=_union_length(abstentions),
    )


# --- témoins : le facteur estimé contre le facteur un -----------------------------------------

Matrix = Mapping[Cell, Mapping[str, FileScore]]


@dataclass(frozen=True)
class TemoinRow:
    """Un étirement : rappel sans compensation, rappel avec le facteur estimé de chaque fichier."""

    stretch: float
    recall_one: float
    recall_estimated: float
    false_one: int
    false_estimated: int

    @property
    def gain_points(self) -> float:
        return (self.recall_estimated - self.recall_one) * 100


def temoin_rows(
    matrix: Matrix,
    chosen: Mapping[tuple[float, str], float],
    stretches: Sequence[float] = STRETCHES,
) -> list[TemoinRow]:
    """`chosen[(étirement, fichier)]` = facteur estimé pour ce fichier. Une cellule absente de la
    matrice est une erreur (`KeyError`) : on ne remplace jamais une mesure manquante."""
    rows: list[TemoinRow] = []
    for stretch in stretches:
        baseline = matrix[(stretch, 1.0)]
        picked = {name: matrix[(stretch, chosen[(stretch, name)])][name] for name in baseline}
        one, estimated = totals(baseline.values()), totals(picked.values())
        rows.append(
            TemoinRow(
                stretch=stretch,
                recall_one=one.recognized / one.expected,
                recall_estimated=estimated.recognized / estimated.expected,
                false_one=one.false_recognized,
                false_estimated=estimated.false_recognized,
            )
        )
    return rows


def temoin_verdict(
    rows: Sequence[TemoinRow], rule: SpeedRule = SPEED_RULE
) -> tuple[bool, tuple[str, ...]]:
    reasons: list[str] = []
    for row in rows:
        label = factor_label(row.stretch)
        if row.stretch in rule.judged_stretches:
            if row.gain_points < rule.min_gain_points - EPSILON:
                reasons.append(
                    f"{label} : gain {row.gain_points:.1f} points < {rule.min_gain_points:g}"
                )
            if row.false_estimated > rule.max_false:
                reasons.append(
                    f"{label} : {row.false_estimated} faux verset(s) avec le facteur estimé"
                )
        else:
            if row.false_estimated > row.false_one:
                reasons.append(f"{label} : le facteur estimé ajoute des faux versets")
            if -row.gain_points > rule.max_regression_points + EPSILON:
                reasons.append(
                    f"{label} : le facteur estimé fait perdre {-row.gain_points:.1f} points "
                    f"(> {rule.max_regression_points:g})"
                )
    return not reasons, tuple(reasons)


def real_verdict(
    slow_supported: Mapping[str, int],
    controls_new: Mapping[str, int],
    rule: SpeedRule = SPEED_RULE,
) -> tuple[bool, tuple[str, ...]]:
    """`slow_supported` : versets nouveaux soutenus par l'audio, par vrai fichier lent, au facteur
    estimé ; `controls_new` : versets nouveaux soutenus, par fichier sans Coran, à tout facteur."""
    reasons: list[str] = []
    best = max(slow_supported.values(), default=0)
    if best < rule.min_new_verses:
        reasons.append(
            f"aucun vrai fichier lent ne gagne {rule.min_new_verses} versets nouveaux soutenus "
            f"(maximum : {best})"
        )
    for name, count in sorted(controls_new.items()):
        if count > rule.max_new_on_controls:
            reasons.append(f"{name} (sans Coran) : {count} verset(s) nouveau(x) soutenu(s)")
    return not reasons, tuple(reasons)


def decide_speed(temoin_ok: bool, real_ok: bool) -> str:
    if temoin_ok and real_ok:
        return "implémenter l'étage « candidat de vitesse » (les deux parties de la règle tiennent)"
    failing = [name for name, ok in (("témoins", temoin_ok), ("vrais fichiers", real_ok)) if not ok]
    return f"ne pas implémenter l'étage (partie en échec : {', '.join(failing)})"
