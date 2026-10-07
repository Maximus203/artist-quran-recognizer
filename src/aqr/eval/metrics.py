"""Métriques d'évaluation d'une sortie `aqr.recognition/1` contre une vérité terrain humaine.

Définitions EXACTES (reprises dans docs/EVALUATION-METRICS.md ; toute modification doit
modifier les deux). Notations : « référence » = `expected` et `non_quran` du cas annoté ;
« prédiction » = un intervalle de la sortie ; `t` = (début, fin) en secondes.

Principe : `inferred` et `uncertain` ne sont JAMAIS une reconnaissance ; `abstention` est
l'absence de décision, pas un verset. Seuls les intervalles `verse` au statut `recognized`
(et horodatés) comptent comme « versets reconnus ».

Recouvrement. `ratio(a, b) = durée(a ∩ b) / min(durée(a), durée(b))`. Une prédiction `p`
CORRESPOND à un verset de référence `e` si : même `ref`, plages de mots qui se recouvrent
(`all` recouvre tout) et `ratio(p.t, e.t) >= policy.min_overlap`. Chaque prédiction est
rattachée au seul `e` correspondant au meilleur (ratio, recouvrement, début le plus tôt).
Plusieurs prédictions peuvent se rattacher au même `e` (verset coupé en deux intervalles).

(a) FAUX VERSET : prédiction `recognized` rattachée à AUCUN `e`. Raison (premier critère vrai) :
  `non_quran_zone` : >= min_overlap de sa durée tombe dans les zones `non_quran` de référence ;
  `wrong_verse` : ratio >= min_overlap avec un `e` auquel elle ne correspond pas (autre ref ou
    autres mots) ; `misplaced` : bon verset et bons mots mais ratio < min_overlap (recouvrement
    strictement positif) ; `unreferenced` : aucun des cas précédents (rien dans la référence).
  taux = faux versets / versets reconnus (dénominateur : prédictions `recognized` localisées).

(b) OMISSION : `e` auquel aucune prédiction `recognized` n'est rattachée. Cause (premier critère
  vrai, ratio >= min_overlap avec `e`) : `wrong_verse` (une prédiction `recognized` d'un autre
  verset/mots), `merged` (une prédiction du bon verset, déjà rattachée à une autre occurrence),
  `inferred`, `uncertain`, `abstention`, `non_quran` (le moteur a dit « pas du Coran »),
  `no_output`. Pour `inferred`/`uncertain` : `ref_correct` (le verset nommé est le bon) et, pour
  `uncertain`, `candidate_hit` (le bon verset figure parmi les candidats).
  taux d'omission = omissions / versets de référence ; rappel = 1 - taux.

(c) ERREURS DE LIMITES : pour chaque `e` retrouvé, début = min des débuts des prédictions
  rattachées, fin = max des fins ; `start_error_ms = (début_prédit - début_ref) * 1000` (signé),
  idem fin. `within` si |erreur| <= `tolerance_ms` du cas ; `within_tolerance` = début ET fin.

(d) ABSTENTION : durée de (union des intervalles `abstention` ET `uncertain` localisés)
  ∩ (union des versets de référence), rapportée à la durée de cette union de référence
  (`reference_quran_s`). `inferred` n'est pas une abstention.

(e) TEMPS DE CALCUL : facteur temps réel = timing.total_s / durée audio (cas.duree_s, sinon la
  durée de la source) ; < 1 = plus rapide que le temps réel.

Annotation par fenêtres (`annotated_windows`) : seules les prédictions dont le milieu tombe dans
une fenêtre sont jugées (`n_out_of_scope_intervals` compte les autres) ; une étiquette de référence
hors fenêtre est une erreur d'annotation (`EvaluationRefused`).

Les intervalles sans `t` (verse inferred/uncertain non localisés) sont comptés dans
`n_unlocated_intervals` et ignorés partout ailleurs. Aucune valeur n'est tirée d'un modèle :
tout vient du cas annoté et de la sortie.

REFUS : `evaluate_case` lève `EvaluationRefused` si le cas n'est pas `statut: annote`, si sa
provenance n'est pas humaine et relue (`has_trusted_truth`), ou si l'annotation est vide.
"""

from __future__ import annotations

import math
import statistics
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from aqr.data.manifest import AudioCase, ExpectedItem, provenance_problems
from aqr.domain.models import Status
from aqr.eval.recognition import (
    AbstentionInterval,
    Interval,
    NonQuranInterval,
    Recognition,
    VerseInterval,
    parse_intervals,
    parse_recognition,
)

OMISSION_CAUSES = (
    "wrong_verse",
    "merged",
    "inferred",
    "uncertain",
    "abstention",
    "non_quran",
    "no_output",
)
FALSE_VERSE_REASONS = ("non_quran_zone", "wrong_verse", "misplaced", "unreferenced")
_WILSON_Z_95 = 1.959963984540054  # quantile normal à 97,5 % : intervalle de confiance à 95 %


class EvaluationRefused(ValueError):
    """Le cas ne peut pas servir de référence (non annoté, non relu, vide, mauvais audio)."""


@dataclass(frozen=True)
class MatchPolicy:
    """Paramètres de rattachement ; aucune valeur par défaut cachée."""

    min_overlap: float
    """Part minimale de recouvrement (voir `ratio`), dans ]0, 1]."""

    def __post_init__(self) -> None:
        if not 0.0 < self.min_overlap <= 1.0:
            raise ValueError("min_overlap doit être dans ]0, 1]")


@dataclass(frozen=True)
class FalseVerse:
    ref: str
    words: tuple[int, int]
    t: tuple[float, float]
    reason: str


@dataclass(frozen=True)
class Omission:
    ref: str
    words: str
    t: tuple[float, float]
    cause: str
    reference_status: str
    ref_correct: bool | None = None
    candidate_hit: bool | None = None


@dataclass(frozen=True)
class BoundaryError:
    ref: str
    t: tuple[float, float]
    start_error_ms: float
    end_error_ms: float
    tolerance_ms: int
    interpolated: bool

    @property
    def start_within(self) -> bool:
        return abs(self.start_error_ms) <= self.tolerance_ms

    @property
    def end_within(self) -> bool:
        return abs(self.end_error_ms) <= self.tolerance_ms

    @property
    def within_tolerance(self) -> bool:
        return self.start_within and self.end_within


@dataclass(frozen=True)
class CaseResult:
    case_id: str
    categories: tuple[str, ...]
    boundaries_exact: bool
    n_reference_verses: int
    n_reference_inferred_truth: int
    n_found: int
    n_recognized_predictions: int
    n_unlocated_intervals: int
    n_out_of_scope_intervals: int
    false_verses: tuple[FalseVerse, ...]
    omissions: tuple[Omission, ...]
    boundaries: tuple[BoundaryError, ...]
    reference_quran_s: float
    abstained_s: float
    duration_s: float | None
    total_s: float | None

    @property
    def realtime_factor(self) -> float | None:
        if self.duration_s and self.total_s is not None and self.duration_s > 0:
            return self.total_s / self.duration_s
        return None

    def to_dict(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "categories": list(self.categories),
            "boundaries_exact": self.boundaries_exact,
            "n_reference_verses": self.n_reference_verses,
            "n_found": self.n_found,
            "n_recognized_predictions": self.n_recognized_predictions,
            "n_unlocated_intervals": self.n_unlocated_intervals,
            "n_out_of_scope_intervals": self.n_out_of_scope_intervals,
            "false_verses": [
                {"ref": f.ref, "words": list(f.words), "t": list(f.t), "reason": f.reason}
                for f in self.false_verses
            ],
            "omissions": [
                {
                    "ref": o.ref,
                    "words": o.words,
                    "t": list(o.t),
                    "cause": o.cause,
                    "reference_status": o.reference_status,
                    "ref_correct": o.ref_correct,
                    "candidate_hit": o.candidate_hit,
                }
                for o in self.omissions
            ],
            "boundaries": [
                {
                    "ref": b.ref,
                    "t": list(b.t),
                    "start_error_ms": b.start_error_ms,
                    "end_error_ms": b.end_error_ms,
                    "within_tolerance": b.within_tolerance,
                    "interpolated": b.interpolated,
                }
                for b in self.boundaries
            ],
            "reference_quran_s": self.reference_quran_s,
            "abstained_s": self.abstained_s,
            "duration_s": self.duration_s,
            "total_s": self.total_s,
            "realtime_factor": self.realtime_factor,
        }


# --- géométrie d'intervalles ---------------------------------------------------------------

Span = tuple[float, float]


def _overlap(a: Span, b: Span) -> float:
    return max(0.0, min(a[1], b[1]) - max(a[0], b[0]))


def _ratio(a: Span, b: Span) -> float:
    return _overlap(a, b) / min(a[1] - a[0], b[1] - b[0])


def _merge(spans: Iterable[Span]) -> list[Span]:
    merged: list[Span] = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _length(spans: Sequence[Span]) -> float:
    return sum(end - start for start, end in spans)


def _intersection_length(a: Sequence[Span], b: Sequence[Span]) -> float:
    return sum(_overlap(x, y) for x in a for y in b)  # a et b sont déjà fusionnés (disjoints)


# --- évaluation d'un cas -------------------------------------------------------------------


def _words_overlap(expected: ExpectedItem, p: VerseInterval) -> bool:
    words = expected.words
    if words.is_all or words.first is None or words.last is None:
        return True
    return words.first <= p.last_word and p.first_word <= words.last


def _matches(expected: ExpectedItem, p: VerseInterval, policy: MatchPolicy) -> bool:
    assert p.t is not None
    return (
        expected.ref == p.ref
        and _words_overlap(expected, p)
        and _ratio(p.t, expected.t) >= policy.min_overlap
    )


def _refuse_unless_trusted(case: AudioCase) -> None:
    problems = provenance_problems(case)
    if problems:
        raise EvaluationRefused(
            f"cas {case.id} : pas de métrique sur une vérité non contrôlée humainement — "
            + " ; ".join(problems)
        )
    if not case.expected and not case.non_quran:
        raise EvaluationRefused(f"cas {case.id} : annotation vide (ni versets ni zones)")


def evaluate_case(
    case: AudioCase,
    intervals: Sequence[Interval | Mapping[str, Any]],
    *,
    policy: MatchPolicy,
    timing: Mapping[str, Any] | None = None,
    audio_duration_s: float | None = None,
) -> CaseResult:
    """Évalue les `intervals` (JSON brut ou objets de `aqr.eval.recognition`) contre `case`."""
    _refuse_unless_trusted(case)
    parsed = tuple(parse_intervals([i])[0] if isinstance(i, Mapping) else i for i in intervals)
    parsed, out_of_scope = _restrict_to_windows(case, parsed)
    verses = [i for i in parsed if isinstance(i, VerseInterval)]
    unlocated = sum(1 for v in verses if v.t is None)
    recognized = [v for v in verses if v.status is Status.RECOGNIZED and v.t is not None]
    inferred = [v for v in verses if v.status is Status.INFERRED and v.t is not None]
    uncertain = [v for v in verses if v.status is Status.UNCERTAIN and v.t is not None]
    abstentions = [i for i in parsed if isinstance(i, AbstentionInterval)]
    non_quran_preds = [i for i in parsed if isinstance(i, NonQuranInterval)]

    refs = list(case.expected)
    zones = _merge(z.t for z in case.non_quran)

    # Rattachement prédiction -> verset de référence.
    assigned: dict[int, list[VerseInterval]] = {k: [] for k in range(len(refs))}
    false_verses: list[FalseVerse] = []
    for p in recognized:
        assert p.t is not None
        pt = p.t
        options = [k for k, e in enumerate(refs) if _matches(e, p, policy)]
        if options:
            best = max(
                options,
                key=lambda k: (_ratio(pt, refs[k].t), _overlap(pt, refs[k].t), -refs[k].t[0]),
            )
            assigned[best].append(p)
            continue
        false_verses.append(_classify_false_verse(p, refs, zones, policy))

    boundaries: list[BoundaryError] = []
    omissions: list[Omission] = []
    for k, e in enumerate(refs):
        matched = assigned[k]
        if matched:
            starts = [p.t[0] for p in matched if p.t]
            ends = [p.t[1] for p in matched if p.t]
            boundaries.append(
                BoundaryError(
                    ref=str(e.ref),
                    t=e.t,
                    start_error_ms=(min(starts) - e.t[0]) * 1000.0,
                    end_error_ms=(max(ends) - e.t[1]) * 1000.0,
                    tolerance_ms=case.tolerance_ms,
                    interpolated=any(p.time_interpolated for p in matched),
                )
            )
        else:
            omissions.append(
                _classify_omission(
                    e, recognized, inferred, uncertain, abstentions, non_quran_preds, policy
                )
            )

    quran = _merge(e.t for e in refs)
    silent = _merge([a.t for a in abstentions] + [u.t for u in uncertain if u.t is not None])
    duration = audio_duration_s if audio_duration_s is not None else case.duree_s
    total = (timing or {}).get("total_s")
    return CaseResult(
        case_id=case.id,
        categories=case.categorie,
        boundaries_exact=case.boundaries == "exact",
        n_reference_verses=len(refs),
        n_reference_inferred_truth=sum(1 for e in refs if e.status is Status.INFERRED),
        n_found=sum(1 for k in assigned if assigned[k]),
        n_recognized_predictions=len(recognized),
        n_unlocated_intervals=unlocated,
        n_out_of_scope_intervals=out_of_scope,
        false_verses=tuple(false_verses),
        omissions=tuple(omissions),
        boundaries=tuple(boundaries),
        reference_quran_s=_length(quran),
        abstained_s=_intersection_length(quran, silent),
        duration_s=float(duration) if duration is not None else None,
        total_s=float(total) if total is not None else None,
    )


def _restrict_to_windows(
    case: AudioCase, intervals: Sequence[Interval]
) -> tuple[tuple[Interval, ...], int]:
    """Cas annoté par fenêtres : seules les prédictions dont le milieu tombe dans une fenêtre
    sont jugées (hors fenêtre il n'y a pas de vérité) ; les intervalles sans `t` sont conservés
    (comptés « non localisés »). Une référence hors fenêtre rend l'annotation incohérente."""
    if not case.annotated_windows:
        return tuple(intervals), 0
    windows = case.annotated_windows
    for ref_t in [e.t for e in case.expected] + [z.t for z in case.non_quran]:
        if not any(w[0] - 1e-6 <= ref_t[0] and ref_t[1] <= w[1] + 1e-6 for w in windows):
            raise EvaluationRefused(
                f"cas {case.id} : étiquette {ref_t} hors de toute fenêtre annotée {list(windows)}"
            )
    kept: list[Interval] = []
    dropped = 0
    for interval in intervals:
        t = interval.t
        if t is None:
            kept.append(interval)
            continue
        middle = (t[0] + t[1]) / 2
        if any(w[0] <= middle <= w[1] for w in windows):
            kept.append(interval)
        else:
            dropped += 1
    return tuple(kept), dropped


def _classify_false_verse(
    p: VerseInterval, refs: Sequence[ExpectedItem], zones: Sequence[Span], policy: MatchPolicy
) -> FalseVerse:
    assert p.t is not None
    duration = p.t[1] - p.t[0]
    in_zone = sum(_overlap(p.t, z) for z in zones) / duration
    if in_zone >= policy.min_overlap:
        reason = "non_quran_zone"
    elif any(_ratio(p.t, e.t) >= policy.min_overlap for e in refs):
        reason = "wrong_verse"
    elif any(e.ref == p.ref and _words_overlap(e, p) and _overlap(p.t, e.t) > 0 for e in refs):
        reason = "misplaced"
    else:
        reason = "unreferenced"
    return FalseVerse(str(p.ref), (p.first_word, p.last_word), p.t, reason)


def _classify_omission(
    e: ExpectedItem,
    recognized: Sequence[VerseInterval],
    inferred: Sequence[VerseInterval],
    uncertain: Sequence[VerseInterval],
    abstentions: Sequence[AbstentionInterval],
    non_quran_preds: Sequence[NonQuranInterval],
    policy: MatchPolicy,
) -> Omission:
    def hits(spans: Iterable[Span]) -> bool:
        return any(_ratio(s, e.t) >= policy.min_overlap for s in spans)

    def over(items: Sequence[VerseInterval]) -> list[VerseInterval]:
        return [v for v in items if v.t is not None and _ratio(v.t, e.t) >= policy.min_overlap]

    def make(cause: str, **extra: bool | None) -> Omission:
        return Omission(str(e.ref), str(e.words), e.t, cause, e.status.value, **extra)

    rec = over(recognized)
    if any(not (p.ref == e.ref and _words_overlap(e, p)) for p in rec):
        return make("wrong_verse")
    if rec:
        return make("merged")
    for cause, items in (("inferred", over(inferred)), ("uncertain", over(uncertain))):
        if items:
            correct = any(v.ref == e.ref and _words_overlap(e, v) for v in items)
            if cause == "inferred":
                return make(cause, ref_correct=correct)
            hit = any(v.ref == e.ref or e.ref in v.candidates for v in items)
            return make(cause, ref_correct=correct, candidate_hit=hit)
    if hits(a.t for a in abstentions):
        return make("abstention")
    if hits(n.t for n in non_quran_preds):
        return make("non_quran")
    return make("no_output")


def evaluate_recognition(
    case: AudioCase, recognition: Mapping[str, Any] | Recognition, *, policy: MatchPolicy
) -> CaseResult:
    """Évalue une sortie complète `aqr.recognition/1` ; refuse un fichier d'un autre audio."""
    rec = parse_recognition(recognition) if isinstance(recognition, Mapping) else recognition
    sha = rec.source.get("sha256")
    if not sha:
        raise EvaluationRefused(f"cas {case.id} : source.sha256 absent, audio non vérifiable")
    if str(sha) != case.sha256:
        raise EvaluationRefused(
            f"cas {case.id} : sha256 de la prédiction ({str(sha)[:12]}…) différent de celui du "
            f"manifeste ({case.sha256[:12]}…) : sortie d'un autre fichier"
        )
    duration = rec.source.get("duration_s") if case.duree_s is None else None
    return evaluate_case(
        case,
        rec.intervals,
        policy=policy,
        timing=rec.timing,
        audio_duration_s=float(duration) if duration is not None else None,
    )


# --- agrégation ----------------------------------------------------------------------------


def wilson_interval(successes: int, n: int) -> tuple[float, float] | None:
    """Intervalle de Wilson à 95 % d'une proportion ; None si n == 0."""
    if n == 0:
        return None
    z = _WILSON_Z_95
    p = successes / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def _rate(k: int, n: int) -> float | None:
    return k / n if n else None


def _median(values: Sequence[float]) -> float | None:
    return statistics.median(values) if values else None


def _summarize(results: Sequence[CaseResult], min_reference_verses: int) -> dict[str, Any]:
    n_ref = sum(r.n_reference_verses for r in results)
    n_pred = sum(r.n_recognized_predictions for r in results)
    n_false = sum(len(r.false_verses) for r in results)
    n_omit = sum(len(r.omissions) for r in results)
    pairs = [b for r in results if r.boundaries_exact for b in r.boundaries]
    start_abs = [abs(b.start_error_ms) for b in pairs]
    end_abs = [abs(b.end_error_ms) for b in pairs]
    timed = [r for r in results if r.realtime_factor is not None]
    quran_s = sum(r.reference_quran_s for r in results)
    abstained_s = sum(r.abstained_s for r in results)
    total_s = sum(r.total_s or 0.0 for r in timed)
    duration_s = sum(r.duration_s or 0.0 for r in timed)
    return {
        "n_cases": len(results),
        "n_reference_verses": n_ref,
        "n_reference_verses_inferred_truth": sum(r.n_reference_inferred_truth for r in results),
        "n_found": sum(r.n_found for r in results),
        "n_recognized_predictions": n_pred,
        "n_unlocated_intervals": sum(r.n_unlocated_intervals for r in results),
        "n_out_of_scope_intervals": sum(r.n_out_of_scope_intervals for r in results),
        "n_false_verses": n_false,
        "false_verses_by_reason": {
            reason: sum(1 for r in results for f in r.false_verses if f.reason == reason)
            for reason in FALSE_VERSE_REASONS
        },
        "false_verse_rate": _rate(n_false, n_pred),
        "false_verse_rate_ci95": wilson_interval(n_false, n_pred),
        "n_omissions": n_omit,
        "omissions_by_cause": {
            cause: sum(1 for r in results for o in r.omissions if o.cause == cause)
            for cause in OMISSION_CAUSES
        },
        "omission_rate": _rate(n_omit, n_ref),
        "omission_rate_ci95": wilson_interval(n_omit, n_ref),
        "recall": _rate(n_ref - n_omit, n_ref),
        "n_boundary_pairs": len(pairs),
        "n_boundary_interpolated": sum(1 for b in pairs if b.interpolated),
        "n_boundary_excluded_approximate": sum(
            len(r.boundaries) for r in results if not r.boundaries_exact
        ),
        "start_within_tolerance": sum(1 for b in pairs if b.start_within),
        "end_within_tolerance": sum(1 for b in pairs if b.end_within),
        "both_within_tolerance": sum(1 for b in pairs if b.within_tolerance),
        "both_within_rate": _rate(sum(1 for b in pairs if b.within_tolerance), len(pairs)),
        "start_abs_error_ms_median": _median(start_abs),
        "end_abs_error_ms_median": _median(end_abs),
        "start_abs_error_ms_max": max(start_abs) if start_abs else None,
        "end_abs_error_ms_max": max(end_abs) if end_abs else None,
        "reference_quran_s": quran_s,
        "abstained_s": abstained_s,
        "abstention_share": abstained_s / quran_s if quran_s else None,
        "n_cases_with_timing": len(timed),
        "total_s": total_s,
        "audio_duration_s": duration_s,
        "realtime_factor": total_s / duration_s if duration_s else None,
        "defensible": n_ref >= min_reference_verses,
    }


def aggregate(results: Sequence[CaseResult], *, min_reference_verses: int) -> dict[str, Any]:
    """Agrège des résultats par SOMMES (jamais de moyenne de ratios), en tout et par catégorie.

    Un cas à plusieurs catégories compte dans chacune (les totaux par catégorie se recouvrent).
    `defensible` est faux sous `min_reference_verses` versets de référence : l'échantillon est
    alors trop petit pour affirmer quoi que ce soit (le seuil est choisi par l'appelant).
    """
    categories = sorted({c for r in results for c in r.categories})
    return {
        "min_reference_verses": min_reference_verses,
        "overall": _summarize(results, min_reference_verses),
        "by_category": {
            c: _summarize([r for r in results if c in r.categories], min_reference_verses)
            for c in categories
        },
    }
