"""Passages alignés puis validés à l'oreille -> vérité terrain du manifeste (étape A, ADR-0006).

L'humain a dit QUOI est récité et a écouté les limites que l'alignement forcé a posées : chaque
passage validé devient une fenêtre annotée (`annotated_windows`) dont les versets sont la vérité
terrain (`annotation.by: human`). Règles du protocole (docs/ANNOTATION-DEV-SET.md) : fichiers DEV
seulement, relecteur désigné par un identifiant anonyme, rien n'est deviné.

Une revalidation remplace les versets de sa fenêtre (milieu dans la fenêtre) et garde le reste ;
une préannotation de modèle n'est jamais fusionnée, elle est remplacée.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from aqr.data.config import DataConfig
from aqr.data.manifest import Annotation, ExpectedItem, Manifest, WordRange
from aqr.domain.models import Status, VerseRef

ALIGNMENT_SCHEMA = "aqr.alignment/2"
_REVIEWER = re.compile(r"^[a-z0-9][a-z0-9._-]{0,31}$")


class AlignmentImportError(ValueError):
    """Document refusé : rien n'est écrit."""


@dataclass(frozen=True)
class ImportReport:
    case_id: str
    verses: int
    windows: tuple[tuple[float, float], ...]


def _merge(windows: list[tuple[float, float]]) -> tuple[tuple[float, float], ...]:
    merged: list[tuple[float, float]] = []
    for start, end in sorted(windows):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return tuple(merged)


def _inside(t: tuple[float, float], windows: list[tuple[float, float]]) -> bool:
    middle = (t[0] + t[1]) / 2
    return any(start <= middle <= end for start, end in windows)


def import_alignment(
    manifest_path: Path,
    document: Mapping[str, Any],
    *,
    reviewed_by: str,
    config: DataConfig,
    date: str | None = None,
    note: str | None = None,
) -> ImportReport:
    if document.get("schema") != ALIGNMENT_SCHEMA:
        raise AlignmentImportError(
            f"schéma {document.get('schema')!r} inattendu (attendu {ALIGNMENT_SCHEMA})"
        )
    if not _REVIEWER.match(reviewed_by or ""):
        raise AlignmentImportError(
            "relecteur : identifiant anonyme requis (minuscules, chiffres, « - », ex. rel-01), "
            "jamais un nom"
        )
    manifest = Manifest.load(manifest_path)
    sha256 = str((document.get("source") or {}).get("sha256", "")).lower()
    case = manifest.by_sha(sha256)
    if case is None:
        raise AlignmentImportError(
            "audio absent du manifeste (empreinte inconnue) : l'ingérer d'abord (aqr data ingest)"
        )
    if case.split != "dev":
        raise AlignmentImportError(
            f"{case.id} est en {case.split or 'split non affecté'} : seuls les fichiers dev sont "
            "annotés (docs/ANNOTATION-DEV-SET.md)"
        )
    passages = document.get("passages") or []
    if not passages:
        raise AlignmentImportError("aucun passage à écrire")
    limit = (case.duree_s or float("inf")) + config.tolerance_ms / 1000
    windows: list[tuple[float, float]] = []
    added: list[ExpectedItem] = []
    for passage in passages:
        if "error" in passage or not passage.get("spans"):
            raise AlignmentImportError(
                f"passage {passage.get('t')} en erreur ou sans verset : ne pas le valider"
            )
        window = (float(passage["t"][0]), float(passage["t"][1]))
        if window[1] > limit:
            raise AlignmentImportError(
                f"passage {window} hors de la durée de l'audio ({case.duree_s} s)"
            )
        windows.append(window)
        for span in passage["spans"]:
            first, last = (int(w) for w in span["words"])
            added.append(
                ExpectedItem(
                    t=(float(span["t"][0]), float(span["t"][1])),
                    ref=VerseRef.parse(str(span["ref"])),
                    words=WordRange(first, last) if span.get("partial") else WordRange.all(),
                    status=Status.RECOGNIZED,
                )
            )

    previous = case.annotation
    human = previous is not None and previous.by == "human"
    kept = tuple(e for e in case.expected if human and not _inside(e.t, windows))
    whole_file = human and case.statut == config.statut_annote and not case.annotated_windows
    merged = () if whole_file else _merge([*(case.annotated_windows if human else ()), *windows])
    engine = (document.get("engine") or {}).get("model", "?")
    ratio = (document.get("config") or {}).get("energy_ratio")
    default_note = (
        f"alignement forcé ({engine}, energy_ratio {ratio}) validé à l'oreille dans l'atelier "
        "(ADR-0006) ; relecteur unique"
    )
    updated = replace(
        case,
        expected=tuple(sorted((*kept, *added), key=lambda e: e.t)),
        non_quran=case.non_quran if human else (),
        statut=config.statut_annote,
        annotation=Annotation("human", reviewed_by, date, note or default_note),
        annotated_windows=merged,
    )
    manifest.upsert(updated)
    manifest.save(manifest_path)
    return ImportReport(case.id, len(updated.expected), merged)
