"""Étiquettes Audacity <-> manifeste (docs/DATA-COLLECTION.md §5, étapes 2-4).

Une ligne par zone, séparée par des tabulations : `début  fin  étiquette`.
- verset : `67:4|recognized`, plage de mots partielle `2:255[1-9]|recognized` (ou `[5]`) ;
- non coranique : `NON_QURAN:<nature>` (french, arabic_speech, istiadha, takbir, …).
Seuls `recognized` et `inferred` sont acceptés : une vérité terrain est tranchée, jamais
`uncertain`. Les temps sont écrits au microseconde (`%.6f`, comme Audacity).
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Protocol

from aqr.data.config import DataConfig
from aqr.data.manifest import (
    AudioCase,
    ExpectedItem,
    Manifest,
    NonQuranItem,
    WordRange,
)
from aqr.domain.models import NonQuranKind, Status, VerseRef

_VERSE = re.compile(r"(\d+):(\d+)(?:\[(\d+)(?:-(\d+))?\])?\|([a-z]+)", re.IGNORECASE)
_NON_QURAN = re.compile(r"NON_QURAN:([a-z_]+)", re.IGNORECASE)
_TRUTH_STATUSES = (Status.RECOGNIZED, Status.INFERRED)


class LabelError(ValueError):
    """Fichier d'étiquettes invalide : `problems` liste toutes les lignes en défaut."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


def _time(value: float) -> str:
    return f"{value:.6f}"


def format_labels(expected: Sequence[ExpectedItem], non_quran: Sequence[NonQuranItem]) -> str:
    rows: list[tuple[float, float, str]] = []
    for item in expected:
        words = "" if item.words.is_all else f"[{item.words}]"
        rows.append((item.t[0], item.t[1], f"{item.ref}{words}|{item.status.value}"))
    for zone in non_quran:
        rows.append((zone.t[0], zone.t[1], f"NON_QURAN:{zone.kind.value}"))
    rows.sort(key=lambda r: (r[0], r[1], r[2]))
    return "".join(f"{_time(a)}\t{_time(b)}\t{label}\n" for a, b, label in rows)


def _parse_label(label: str) -> ExpectedItem | NonQuranItem | str:
    """Renvoie l'élément (sans temps : `t` à (0, 0)) ou un message d'erreur."""
    if (match := _NON_QURAN.fullmatch(label)) is not None:
        try:
            return NonQuranItem((0.0, 0.0), NonQuranKind(match.group(1).lower()))
        except ValueError:
            kinds = ", ".join(k.value for k in NonQuranKind)
            return f"nature non coranique inconnue {match.group(1)!r} (attendu {kinds})"
    if (match := _VERSE.fullmatch(label)) is None:
        return f"étiquette illisible {label!r} (attendu 67:4|recognized ou NON_QURAN:french)"
    surah, ayah, first, last, status_text = match.groups()
    try:
        ref = VerseRef(int(surah), int(ayah))
        words = WordRange(int(first), int(last or first)) if first else WordRange.all()
        status = Status(status_text.lower())
    except ValueError as exc:
        return str(exc)
    if status not in _TRUTH_STATUSES:
        return f"statut {status.value!r} interdit en vérité terrain (recognized ou inferred)"
    return ExpectedItem((0.0, 0.0), ref, words, status)


def parse_labels(text: str) -> tuple[tuple[ExpectedItem, ...], tuple[NonQuranItem, ...]]:
    expected: list[ExpectedItem] = []
    non_quran: list[NonQuranItem] = []
    problems: list[str] = []
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith(("#", "\\")):
            continue  # vide, commentaire, ou sélection spectrale d'Audacity
        columns = raw.rstrip("\n").split("\t")
        if len(columns) < 3:
            problems.append(f"ligne {number} : 3 colonnes séparées par des tabulations attendues")
            continue
        try:
            start, end = float(columns[0]), float(columns[1])
        except ValueError:
            problems.append(f"ligne {number} : temps illisibles {columns[0]!r}, {columns[1]!r}")
            continue
        if start < 0 or end <= start:
            problems.append(f"ligne {number} : intervalle invalide {start} -> {end}")
            continue
        parsed = _parse_label("\t".join(columns[2:]).strip())
        if isinstance(parsed, str):
            problems.append(f"ligne {number} : {parsed}")
            continue
        span = (round(start, 6), round(end, 6))
        if isinstance(parsed, ExpectedItem):
            expected.append(replace(parsed, t=span))
        else:
            non_quran.append(replace(parsed, t=span))
    if problems:
        raise LabelError(problems)
    return tuple(expected), tuple(non_quran)


# --- services sur le manifeste -------------------------------------------------------------


def labels_path(audio_dir: Path, case_id: str) -> Path:
    return audio_dir / "labels" / f"{case_id}.txt"


def _write_labels(path: Path, text: str, force: bool) -> Path:
    if path.exists() and not force:
        raise FileExistsError(
            f"{path} existe déjà (peut contenir des corrections manuelles) : "
            "relancer avec force pour l'écraser"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    return path


def export_labels(
    manifest_path: Path, audio_dir: Path, case_id: str, *, force: bool = False
) -> Path:
    case = Manifest.load(manifest_path).get(case_id)
    return _write_labels(
        labels_path(audio_dir, case_id), format_labels(case.expected, case.non_quran), force
    )


def import_labels(
    manifest_path: Path, audio_dir: Path, case_id: str, *, config: DataConfig
) -> AudioCase:
    manifest = Manifest.load(manifest_path)
    case = manifest.get(case_id)
    path = labels_path(audio_dir, case_id)
    if not path.exists():
        raise FileNotFoundError(f"fichier d'étiquettes introuvable : {path}")
    expected, non_quran = parse_labels(path.read_text(encoding="utf-8"))
    if case.duree_s is not None:
        limit = case.duree_s + config.tolerance_ms / 1000
        ends = [i.t[1] for i in expected] + [i.t[1] for i in non_quran]
        late = [end for end in ends if end > limit]
        if late:
            raise LabelError(
                [
                    f"étiquette hors de la durée de l'audio ({case.duree_s} s) : fin à {end} s"
                    for end in late
                ]
            )
    updated = replace(case, expected=expected, non_quran=non_quran, statut=config.statut_annote)
    manifest.upsert(updated)
    manifest.save(manifest_path)
    return updated


# --- pré-annotation (interface seulement : le moteur arrive en phase 5) --------------------


@dataclass(frozen=True)
class PreAnnotation:
    """Proposition de timeline pour un audio, versets ET zones non coraniques mêlés.

    Une assise ou un prêche (C09/C11) cite ponctuellement un verset ou un hadith au milieu
    de français ; une khutba (C10/C11) cite versets et hadiths en arabe : la proposition doit
    donc pouvoir entrelacer librement les deux sortes d'éléments, sans hypothèse de contenu pur.
    """

    expected: tuple[ExpectedItem, ...] = ()
    non_quran: tuple[NonQuranItem, ...] = ()


class PreAnnotator(Protocol):
    def preannotate(self, wav: Path) -> PreAnnotation: ...


class PreannotationUnavailable(RuntimeError):
    pass


class UnavailablePreAnnotator:
    """Remplaçant tant que le pipeline (B1–B7) n'est pas câblé."""

    def preannotate(self, wav: Path) -> PreAnnotation:
        raise PreannotationUnavailable(
            "pré-annotation indisponible : le moteur de reconnaissance sera branché en phase 5 "
            "(pipeline de bout en bout) ; d'ici là, annoter à la main dans Audacity."
        )


def preannotate(
    manifest_path: Path,
    audio_dir: Path,
    case_id: str,
    annotator: PreAnnotator,
    *,
    force: bool = False,
) -> Path:
    """Écrit les étiquettes proposées (à corriger dans Audacity) ; le cas reste `a_annoter`."""
    Manifest.load(manifest_path).get(case_id)  # le cas doit exister
    wav = audio_dir / "_derived" / f"{case_id}.wav"
    if not wav.exists():
        raise FileNotFoundError(
            f"WAV dérivé introuvable : {wav} (lancer d'abord `aqr data ingest`)"
        )
    proposal = annotator.preannotate(wav)
    return _write_labels(
        labels_path(audio_dir, case_id), format_labels(proposal.expected, proposal.non_quran), force
    )
