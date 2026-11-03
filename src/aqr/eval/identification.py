"""Exactitude d'IDENTIFICATION des versets, sans horodatage (complète `aqr.eval.metrics`).

`metrics.py` juge où le moteur place chaque verset dans le temps ; ce module juge seulement QUEL
verset il nomme, ce qui suffit pour un corpus de clips (un verset ou une plage par fichier). Mêmes
règles de fond : seul un intervalle `verse` au statut `recognized` (horodaté) est une réponse ;
`inferred`, `uncertain` et `abstention` n'en sont jamais une (I3, I5).

Séquences. Attendu = refs de `expected` triées par temps ; prédit = refs des versets `recognized`
(dans la fenêtre annotée) triées par temps ; les doublons CONSÉCUTIFS sont fusionnés (un verset
coupé
en deux détections ou en plages de mots compte une fois).

Niveaux (par verset attendu, agrégés par sommes) :
- `surah`  : le moteur a nommé, quelque part, un verset de la même sourate ;
- `verse_exact` : le moteur a nommé exactement ce verset (sourate:verset) ;
et par cas :
- `range_exact` : la suite prédite est IDENTIQUE à la suite attendue (mêmes versets, même ordre,
  rien en plus, rien en moins).

Cas sans verset attendu (annotation = zones `non_quran` seulement) : `silence` si toutes les zones
sont du silence ou du bruit, `off_target` sinon (français, arabe non coranique, autre langue,
formules). Tout verset `recognized` y est un FAUX POSITIF (I3, I4). Un cas avec versets attendus
mais aucun verset `recognized` est `unrecognized` (omission totale : moins grave qu'un faux verset).
`extra_refs` : versets nommés qui ne figurent pas dans l'attendu (faux versets, sans le temps).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from aqr.data.manifest import AudioCase
from aqr.domain.models import NonQuranKind, Status, VerseRef
from aqr.eval.metrics import refuse_unless_trusted, restrict_to_windows, wilson_interval
from aqr.eval.recognition import Interval, VerseInterval, parse_intervals

KIND_REFERENCE = "reference"
KIND_SILENCE = "silence"
KIND_OFF_TARGET = "off_target"
_SILENT_KINDS = {NonQuranKind.SILENCE, NonQuranKind.NOISE}


def _collapse(refs: Sequence[VerseRef]) -> tuple[VerseRef, ...]:
    out: list[VerseRef] = []
    for ref in refs:
        if not out or out[-1] != ref:
            out.append(ref)
    return tuple(out)


@dataclass(frozen=True)
class IdentificationResult:
    case_id: str
    kind: str
    expected_refs: tuple[VerseRef, ...]
    predicted_refs: tuple[VerseRef, ...]
    n_recognized: int
    """Versets `recognized` jugés (dans la fenêtre annotée), avant fusion des doublons."""

    @property
    def n_expected(self) -> int:
        return len(self.expected_refs)

    @property
    def surah_hits(self) -> int:
        named = {r.surah for r in self.predicted_refs}
        return sum(1 for r in self.expected_refs if r.surah in named)

    @property
    def exact_hits(self) -> int:
        named = set(self.predicted_refs)
        return sum(1 for r in self.expected_refs if r in named)

    @property
    def range_exact(self) -> bool:
        return self.kind == KIND_REFERENCE and self.predicted_refs == self.expected_refs

    @property
    def unrecognized(self) -> bool:
        return self.kind == KIND_REFERENCE and self.n_recognized == 0

    @property
    def extra_refs(self) -> tuple[VerseRef, ...]:
        if self.kind != KIND_REFERENCE:
            return ()
        expected = set(self.expected_refs)
        return tuple(r for r in self.predicted_refs if r not in expected)

    @property
    def n_false_positive_verses(self) -> int:
        return self.n_recognized if self.kind != KIND_REFERENCE else 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "kind": self.kind,
            "expected_refs": [str(r) for r in self.expected_refs],
            "predicted_refs": [str(r) for r in self.predicted_refs],
            "n_expected": self.n_expected,
            "surah_hits": self.surah_hits,
            "exact_hits": self.exact_hits,
            "range_exact": self.range_exact,
            "unrecognized": self.unrecognized,
            "extra_refs": [str(r) for r in self.extra_refs],
            "n_false_positive_verses": self.n_false_positive_verses,
        }


def _case_kind(case: AudioCase) -> str:
    if case.expected:
        return KIND_REFERENCE
    ref_block = case.extra.get("ref")  # corpus de référence : condition déclarée par le cas
    condition = ref_block.get("condition") if isinstance(ref_block, Mapping) else None
    if condition in (KIND_SILENCE, KIND_OFF_TARGET):
        return str(condition)
    if all(z.kind in _SILENT_KINDS for z in case.non_quran):
        return KIND_SILENCE
    return KIND_OFF_TARGET


def evaluate_identification(
    case: AudioCase, intervals: Sequence[Interval | Mapping[str, Any]]
) -> IdentificationResult:
    """Identification d'un cas : mêmes refus que `metrics.evaluate_case` (vérité non contrôlée)."""
    refuse_unless_trusted(case)
    parsed = tuple(parse_intervals([i])[0] if isinstance(i, Mapping) else i for i in intervals)
    scoped, _ = restrict_to_windows(case, parsed)
    recognized = sorted(
        (
            i
            for i in scoped
            if isinstance(i, VerseInterval) and i.status is Status.RECOGNIZED and i.t is not None
        ),
        key=lambda v: v.t or (0.0, 0.0),
    )
    expected = sorted(case.expected, key=lambda e: e.t)
    return IdentificationResult(
        case_id=case.id,
        kind=_case_kind(case),
        expected_refs=_collapse([e.ref for e in expected]),
        predicted_refs=_collapse([v.ref for v in recognized]),
        n_recognized=len(recognized),
    )


def _proportion(hits: int, total: int) -> dict[str, Any]:
    return {
        "hits": hits,
        "total": total,
        "rate": hits / total if total else None,
        "ci95": wilson_interval(hits, total),
    }


def _control(results: Sequence[IdentificationResult]) -> dict[str, int]:
    return {
        "n_cases": len(results),
        "n_false_positive_cases": sum(1 for r in results if r.n_false_positive_verses),
        "n_false_positive_verses": sum(r.n_false_positive_verses for r in results),
    }


def aggregate_identification(results: Sequence[IdentificationResult]) -> dict[str, Any]:
    """Agrège par SOMMES (jamais de moyenne de taux) ; aucun taux quand le dénominateur est nul."""
    reference = [r for r in results if r.kind == KIND_REFERENCE]
    n_expected = sum(r.n_expected for r in reference)
    unrecognized = [r.case_id for r in reference if r.unrecognized]
    return {
        "n_reference_cases": len(reference),
        "n_expected_verses": n_expected,
        "surah": _proportion(sum(r.surah_hits for r in reference), n_expected),
        "verse_exact": _proportion(sum(r.exact_hits for r in reference), n_expected),
        "range_exact": _proportion(sum(1 for r in reference if r.range_exact), len(reference)),
        "unrecognized": {"n_cases": len(unrecognized), "case_ids": unrecognized},
        "n_extra_refs": sum(len(r.extra_refs) for r in reference),
        "silence": _control([r for r in results if r.kind == KIND_SILENCE]),
        "off_target": _control([r for r in results if r.kind == KIND_OFF_TARGET]),
    }
