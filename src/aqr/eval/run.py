"""Protocole d'un lot de reconnaissance : `run.json` dit CE QUE le lot a écrit, et dans quel état.

Un dossier de prédictions n'est évaluable que si l'on sait de quel run viennent ses fichiers. Le
lot (`scripts/recognize_batch.py`) écrit donc `run.json` (`aqr.recognition-run/1`) au départ
(`running`) puis après chaque cas, et fixe le statut final : `complete` (tous les cas
réussis), `partial` (au moins un cas en échec) ou `interrupted` (arrêt : Ctrl-C, exception, modèle
non chargé). `done` associe chaque cas réussi à l'empreinte sha256 du fichier écrit : l'évaluation
(`scripts/evaluate.py`) ne lit un cas que s'il y figure avec la même empreinte, jamais un fichier
laissé par un autre run (autre moteur, autre code). Un `running` retrouvé après coup signe un
processus tué sans pouvoir conclure : il est refusé comme les autres statuts non `complete`.

Cohérence exigée à la lecture : `done` et `failed` ne contiennent que des cas planifiés, sans
cas commun, et un lot `complete` a tous ses cas planifiés dans `done` et aucun dans `failed`.

Un seul lot à la fois par dossier de sortie : `exclusive_directory` prend un verrou `flock` non
bloquant sur `<dossier>/.lock` (fichier laissé en place, jamais supprimé : le supprimer ouvrirait
une course entre deux lots). Module sans modèle ni réseau (Unix : `fcntl`).
"""

from __future__ import annotations

import fcntl
import json
import os
import tempfile
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any

RUN_SCHEMA = "aqr.recognition-run/1"
RUN_FILE = "run.json"
TIMINGS_FILE = "timings.json"
LOCK_FILE = ".lock"


class RunStatus(StrEnum):
    RUNNING = "running"  # lot en cours, ou processus tué avant la conclusion
    COMPLETE = "complete"  # tous les cas du lot ont réussi
    PARTIAL = "partial"  # le lot est allé au bout mais au moins un cas a échoué
    INTERRUPTED = "interrupted"  # le lot s'est arrêté avant la fin (Ctrl-C, exception, modèle)


class RunError(ValueError):
    """`run.json` illisible, hors schéma ou incohérent ; ou lot non `complete`."""


class RunMissing(RunError):
    """Aucun `run.json` dans le dossier (seul cas où `--allow-unverified-run` s'applique)."""


class DirectoryBusy(RuntimeError):
    """Le dossier de sortie est utilisé par un autre lot (ou ne peut pas être verrouillé)."""


def prediction_file(directory: Path, case_id: str) -> Path:
    """Sortie `aqr.recognition/1` d'un cas : `<dossier>/<id>.json` (une seule définition)."""
    return directory / f"{case_id}.json"


def _current_umask() -> int:
    current = os.umask(0)  # lecture seule : `os.umask` ne sait que remplacer
    os.umask(current)
    return current


def write_text_atomic(path: Path, text: str) -> None:
    """Écrit `text` dans `path` sans jamais exposer un fichier partiel ni laisser de `.tmp`.

    Fichier temporaire dans le MÊME dossier puis `os.replace` (atomique) ; si l'écriture ou le
    remplacement échoue, le temporaire est supprimé et l'éventuel ancien fichier reste intact.
    `mkstemp` crée en 0600 : les droits sont ramenés à ceux d'un fichier ordinaire (umask).
    """
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f"{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        os.chmod(tmp, 0o666 & ~_current_umask())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


@contextmanager
def exclusive_directory(directory: Path) -> Iterator[None]:
    """Verrou exclusif non bloquant du dossier de sortie pendant tout un lot (libéré en sortie,
    même sur exception ou Ctrl-C : la fermeture du descripteur relâche le `flock`)."""
    lock = directory / LOCK_FILE
    try:
        fd = os.open(lock, os.O_RDWR | os.O_CREAT, 0o666)
    except OSError as exc:
        raise DirectoryBusy(f"verrou {lock} impossible à créer : {exc}") from exc
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise DirectoryBusy(
                f"dossier de sortie déjà utilisé par un autre lot (verrou {lock}) : attendre sa "
                "fin ou choisir un autre --out-dir"
            ) from exc
        except OSError as exc:
            raise DirectoryBusy(f"verrou {lock} impossible à prendre : {exc}") from exc
        yield
    finally:
        os.close(fd)


@dataclass(frozen=True)
class RunRecord:
    """Contenu de `run.json` (immuable : le lot en dérive une nouvelle version à chaque cas)."""

    status: RunStatus
    asr: str
    planned: tuple[str, ...]
    options: Mapping[str, Any] = field(default_factory=dict)
    git: Mapping[str, Any] = field(default_factory=dict)
    manifest: Mapping[str, Any] = field(default_factory=dict)
    engine: Mapping[str, Any] | None = None
    """Bloc `engine` des sorties du lot ; inconnu (`None`) tant qu'aucun cas n'a réussi."""
    done: Mapping[str, str] = field(default_factory=dict)
    """cas réussi -> sha256 du fichier `<id>.json` écrit."""
    failed: Mapping[str, str] = field(default_factory=dict)
    timing: Mapping[str, Any] = field(default_factory=dict)
    error: str | None = None

    @property
    def manifest_sha256(self) -> str | None:
        sha = self.manifest.get("sha256")
        return str(sha) if sha else None

    def to_document(self) -> dict[str, Any]:
        return {
            "schema": RUN_SCHEMA,
            "status": self.status.value,
            "asr": self.asr,
            "engine": None if self.engine is None else dict(self.engine),
            "options": dict(self.options),
            "git": dict(self.git),
            "manifest": dict(self.manifest),
            "planned": list(self.planned),
            "done": dict(self.done),
            "failed": dict(self.failed),
            "timing": dict(self.timing),
            "error": self.error,
        }


def save_run(directory: Path, record: RunRecord) -> None:
    write_text_atomic(
        directory / RUN_FILE,
        json.dumps(record.to_document(), ensure_ascii=False, indent=1) + "\n",
    )


def _mapping_of_text(raw: object, key: str) -> dict[str, str]:
    if not isinstance(raw, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in raw.items()
    ):
        raise RunError(f"{RUN_FILE} : {key} doit associer des identifiants de cas à du texte")
    return dict(raw)


def _object(raw: object, key: str) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise RunError(f"{RUN_FILE} : {key} doit être un objet")
    return dict(raw)


def parse_run(data: object) -> RunRecord:
    if not isinstance(data, dict):
        raise RunError(f"{RUN_FILE} : objet JSON attendu")
    if data.get("schema") != RUN_SCHEMA:
        raise RunError(
            f"{RUN_FILE} : schéma {data.get('schema')!r} non géré (attendu {RUN_SCHEMA})"
        )
    try:
        status = RunStatus(str(data.get("status")))
    except ValueError as exc:
        raise RunError(f"{RUN_FILE} : statut {data.get('status')!r} inconnu") from exc
    planned = data.get("planned")
    if not isinstance(planned, list) or not all(isinstance(i, str) for i in planned):
        raise RunError(f"{RUN_FILE} : planned doit être une liste d'identifiants de cas")
    engine = data.get("engine")
    error = data.get("error")
    record = RunRecord(
        status=status,
        asr=str(data.get("asr", "")),
        planned=tuple(planned),
        options=_object(data.get("options", {}), "options"),
        git=_object(data.get("git", {}), "git"),
        manifest=_object(data.get("manifest", {}), "manifest"),
        engine=None if engine is None else _object(engine, "engine"),
        done=_mapping_of_text(data.get("done", {}), "done"),
        failed=_mapping_of_text(data.get("failed", {}), "failed"),
        timing=_object(data.get("timing", {}), "timing"),
        error=None if error is None else str(error),
    )
    _check_consistency(record)
    return record


def _check_consistency(record: RunRecord) -> None:
    """Refuse un `run.json` qui se contredit (édité à la main, ou écrit par un autre outil)."""
    planned = set(record.planned)

    def refuse(problem: str) -> RunError:
        return RunError(f"{RUN_FILE} incohérent : {problem}")

    for key, cases in (("done", record.done), ("failed", record.failed)):
        outside = sorted(set(cases) - planned)
        if outside:
            raise refuse(f"{key} contient des cas absents de planned : {', '.join(outside)}")
    both = sorted(set(record.done) & set(record.failed))
    if both:
        raise refuse(f"cas à la fois dans done et dans failed : {', '.join(both)}")
    if record.status is RunStatus.COMPLETE:
        if record.failed:
            raise refuse("statut complete avec des cas dans failed")
        unwritten = sorted(planned - set(record.done))
        if unwritten:
            raise refuse(
                "statut complete mais cas planifiés sans fichier : " + ", ".join(unwritten)
            )


def load_run(directory: Path) -> RunRecord:
    path = directory / RUN_FILE
    if not path.is_file():
        raise RunMissing(
            f"{RUN_FILE} absent de {directory} : origine des prédictions inconnue "
            "(dossier non produit par scripts/recognize_batch.py)"
        )
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RunError(f"{RUN_FILE} illisible : {exc}") from exc
    return parse_run(data)


def load_complete_run(directory: Path) -> RunRecord:
    """`run.json` d'un lot `complete` ; sinon `RunError` (un lot non terminé n'est pas évalué)."""
    record = load_run(directory)
    if record.status is not RunStatus.COMPLETE:
        raise RunError(
            f"{RUN_FILE} : lot « {record.status.value} » (seul un lot « complete » est évalué ; "
            "relancer scripts/recognize_batch.py)"
        )
    return record
