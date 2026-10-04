"""Manifeste de vérité terrain (docs/TEST-CORPUS.md) : lecture/écriture fidèles et idempotentes.

Format YAML compatible avec `tests/acceptance/test_manifest.py` : chaque cas porte
`expected` (versets, avec plage de mots et statut) et `non_quran` (zones non coraniques).
"""

from __future__ import annotations

import os
import re
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from aqr.domain.models import NonQuranKind, Status, VerseRef

MANIFEST_VERSION = 1
_HEADER = (
    "# Vérité terrain du corpus de test audio — protocole : docs/TEST-CORPUS.md\n"
    "# Les fichiers audio ne sont PAS versionnés (tests/fixtures/audio/files/ ou $AQR_AUDIO_DIR).\n"
)
_RANGE = re.compile(r"(\d+)(?:-(\d+))?")


class ManifestError(ValueError):
    pass


@dataclass(frozen=True)
class WordRange:
    """Plage de mots d'un verset (index à partir de 1, bornes incluses) ou « all »."""

    first: int | None = None
    last: int | None = None

    def __post_init__(self) -> None:
        if (self.first is None) != (self.last is None):
            raise ValueError("plage de mots incomplète")
        if (
            self.first is not None
            and self.last is not None
            and (self.first < 1 or self.last < self.first)
        ):
            raise ValueError(f"plage de mots invalide : {self.first}-{self.last}")

    @classmethod
    def all(cls) -> WordRange:
        return cls()

    @property
    def is_all(self) -> bool:
        return self.first is None

    @classmethod
    def parse(cls, text: str) -> WordRange:
        text = str(text).strip().lower()
        if text == "all":
            return cls.all()
        match = _RANGE.fullmatch(text)
        if match is None:
            raise ValueError(f"plage de mots illisible : {text!r} (attendu all, 4 ou 3-7)")
        first = int(match.group(1))
        return cls(first, int(match.group(2)) if match.group(2) else first)

    def __str__(self) -> str:
        if self.first is None:
            return "all"
        return str(self.first) if self.first == self.last else f"{self.first}-{self.last}"


@dataclass(frozen=True)
class ExpectedItem:
    t: tuple[float, float]
    ref: VerseRef
    words: WordRange
    status: Status


@dataclass(frozen=True)
class NonQuranItem:
    t: tuple[float, float]
    kind: NonQuranKind


@dataclass(frozen=True)
class AudioCase:
    id: str
    file: str
    sha256: str
    categorie: tuple[str, ...]
    recitant: str
    riwaya: str
    langues: tuple[str, ...]
    license: str
    duree_s: float | None = None
    statut: str = "a_annoter"
    split: str | None = None
    source: str | None = None
    tolerance_ms: int = 300
    origine: str = "reel"
    """`reel` (enregistrement annoté à la main) ou `mix` (synthétique, vérité exacte)."""
    boundaries: str = "exact"
    """`approximate` quand une frontière interne est estimée (ex. coupure au milieu d'un verset)."""
    expected: tuple[ExpectedItem, ...] = ()
    non_quran: tuple[NonQuranItem, ...] = ()
    extra: Mapping[str, Any] = field(default_factory=dict)


class _Flow(dict[str, Any]):
    """Dictionnaire écrit en style « flow » ({t: [..], ref: ..}), une ligne par élément."""


yaml.SafeDumper.add_representer(
    _Flow,
    lambda dumper, data: dumper.represent_mapping("tag:yaml.org,2002:map", data, flow_style=True),
)

_KNOWN = {
    "id", "file", "sha256", "categorie", "recitant", "riwaya", "langues", "license", "duree_s",
    "statut", "split", "source", "tolerance_ms", "origine", "boundaries", "expected", "non_quran",
}  # fmt: skip


def _span(raw: object, where: str) -> tuple[float, float]:
    if not (isinstance(raw, list) and len(raw) == 2):
        raise ManifestError(f"{where} : t doit être [début, fin]")
    return float(raw[0]), float(raw[1])


def _case_from_dict(raw: Mapping[str, Any]) -> AudioCase:
    where = f"cas {raw.get('id', '?')}"
    try:
        expected = tuple(
            ExpectedItem(
                _span(i["t"], where),
                VerseRef.parse(i["ref"]),
                WordRange.parse(i.get("words", "all")),
                Status(i["status"]),
            )
            for i in raw.get("expected") or []
        )
        non_quran = tuple(
            NonQuranItem(_span(i["t"], where), NonQuranKind(i["kind"]))
            for i in raw.get("non_quran") or []
        )
    except (KeyError, ValueError) as exc:
        raise ManifestError(f"{where} : {exc}") from exc
    return AudioCase(
        id=str(raw["id"]),
        file=str(raw["file"]),
        sha256=str(raw["sha256"]),
        categorie=tuple(raw.get("categorie") or ()),
        recitant=str(raw.get("recitant", "")),
        riwaya=str(raw.get("riwaya", "inconnu")),
        langues=tuple(raw.get("langues") or ()),
        license=str(raw.get("license", "")),
        duree_s=float(raw["duree_s"]) if raw.get("duree_s") is not None else None,
        statut=str(raw.get("statut", "a_annoter")),
        split=raw.get("split"),
        source=raw.get("source"),
        tolerance_ms=int(raw.get("tolerance_ms", 300)),
        origine=str(raw.get("origine", "reel")),
        boundaries=str(raw.get("boundaries", "exact")),
        expected=expected,
        non_quran=non_quran,
        extra={k: v for k, v in raw.items() if k not in _KNOWN},
    )


def _case_to_dict(case: AudioCase) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": case.id,
        "file": case.file,
        "sha256": case.sha256,
        "categorie": list(case.categorie),
        "recitant": case.recitant,
        "riwaya": case.riwaya,
        "langues": list(case.langues),
        "license": case.license,
    }
    if case.source:
        out["source"] = case.source
    out.update(
        duree_s=case.duree_s,
        statut=case.statut,
        split=case.split,
        origine=case.origine,
        boundaries=case.boundaries,
        tolerance_ms=case.tolerance_ms,
        expected=[
            _Flow(t=list(i.t), ref=str(i.ref), words=str(i.words), status=i.status.value)
            for i in case.expected
        ],
        non_quran=[_Flow(t=list(i.t), kind=i.kind.value) for i in case.non_quran],
    )
    out.update(case.extra)
    return out


@dataclass
class Manifest:
    cases: list[AudioCase] = field(default_factory=list)

    @classmethod
    def load(cls, path: Path) -> Manifest:
        if not path.exists():
            return cls()
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if data.get("version") != MANIFEST_VERSION:
            raise ManifestError(
                f"version de manifeste {data.get('version')!r} non gérée "
                f"(attendu {MANIFEST_VERSION})"
            )
        cases = [_case_from_dict(c) for c in data.get("cases") or []]
        ids = [c.id for c in cases]
        duplicates = sorted({i for i in ids if ids.count(i) > 1})
        if duplicates:
            raise ManifestError(f"identifiants de cas dupliqués : {', '.join(duplicates)}")
        return cls(cases=cases)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        body = yaml.safe_dump(
            {"version": MANIFEST_VERSION, "cases": [_case_to_dict(c) for c in self.cases]},
            allow_unicode=True,
            sort_keys=False,
            width=100,
        )
        fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(_HEADER + body)
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def get(self, case_id: str) -> AudioCase:
        for case in self.cases:
            if case.id == case_id:
                return case
        raise KeyError(f"cas inconnu : {case_id}")

    def by_sha(self, sha256: str) -> AudioCase | None:
        return next((c for c in self.cases if c.sha256 == sha256), None)

    def upsert(self, case: AudioCase) -> None:
        for index, existing in enumerate(self.cases):
            if existing.id == case.id:
                self.cases[index] = case
                return
        self.cases.append(case)
