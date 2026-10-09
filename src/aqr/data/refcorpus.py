"""Corpus de référence (synthétique + dégradé) : schéma du manifeste, SCHÉMA FIGÉ v1.

Le manifeste `tests/fixtures/ref-corpus/manifest.yaml` est un manifeste ordinaire
(`aqr.data.manifest.Manifest`, `version: 1`) : chaque cas porte les champs d'`AudioCase`
(`id`, `file`, `sha256`, `recitant`, `license`, `source`, `split`, `expected`, `non_quran`,
`boundaries`, `duree_s`, `tolerance_ms`, `statut`, `origine`...) et un bloc supplémentaire `ref`
décrit ici. `scripts/evaluate.py` et `aqr.eval` lisent donc ce manifeste sans modification.

Bloc `ref` (clé de cas, schéma 1) :

    ref:
      schema: 1                    # version du bloc ; toute rupture l'incrémente
      condition: clean             # clean | noise | telephone | reverb | mp3_low | silence_pad
                                   # | silence | off_target
      non_quran: false             # vrai = aucun verset attendu : la bonne sortie est 0 verset
      parent: null                 # id du cas propre dont celui-ci est dérivé (sinon null)
      degradation: null            # null pour un cas propre, sinon :
        # kind: noise              #   = condition du cas
        # params: {snr_db: 10, seed: 3}   # paramètres exacts, reproductibles
        # shift_s: 0.0             #   décalage temporel appliqué à la vérité (silence_pad)

Règles garanties par `validate_ref_manifest` :
- `recitant` = dossier EveryAyah du récitant (ex. `Alafasy_128kbps`) pour tout contenu récité,
  y compris les mixages et les dégradations : c'est l'unité du découpage dev/test ;
- les récitants de `dev` et de `test` sont disjoints ; un cas dérivé a le jeu de son parent ;
- une dégradation ne change jamais la vérité terrain, sauf un décalage temporel déclaré
  (`shift_s`), appliqué à `expected`, `non_quran` et `annotated_windows` ; `shift_s` vaut
  `params.pad_s` pour `silence_pad` et 0 pour toute autre dégradation, et le validateur compare
  chaque dérivé à son parent décalé (vérité, statut, durée) ;
- `license` est renseignée (valeur par défaut : droits non établis, voir
  `docs/data-lots/ref-corpus-provenance.md`) ; aucun audio n'est versionné, seulement son SHA-256.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any

from aqr.data.config import DataConfig
from aqr.data.manifest import AudioCase, ExpectedItem, Manifest, NonQuranItem
from aqr.data.split import assign_splits

REF_SCHEMA_VERSION = 1
REF_KEY = "ref"
DEGRADED_CATEGORY = "C12"
"""Conditions dégradées (docs/TEST-CORPUS.md)."""

CONDITION_CLEAN = "clean"
DEGRADATION_KINDS = ("noise", "telephone", "reverb", "mp3_low", "silence_pad")
GENERATED_CONDITIONS = ("silence", "off_target")
CONDITIONS = (CONDITION_CLEAN, *DEGRADATION_KINDS, *GENERATED_CONDITIONS)

LICENSE_UNESTABLISHED = (
    "droits non établis : usage interne d'évaluation uniquement, jamais redistribué "
    "(docs/data-lots/ref-corpus-provenance.md)"
)

_SHA256 = re.compile(r"[0-9a-f]{64}")
_MS_EPSILON = 1e-6
"""Écart toléré (en ms) entre `pad_s` et sa valeur arrondie : `adelay` travaille à la ms."""
Param = float | int | str


class RefCorpusError(ValueError):
    pass


@dataclass(frozen=True)
class Degradation:
    kind: str
    params: Mapping[str, Param] = field(default_factory=dict)
    shift_s: float = 0.0

    def __post_init__(self) -> None:
        if self.kind not in DEGRADATION_KINDS:
            raise RefCorpusError(
                f"dégradation inconnue : {self.kind!r} (connues : {', '.join(DEGRADATION_KINDS)})"
            )
        if self.shift_s < 0:
            raise RefCorpusError("shift_s négatif : un décalage ne peut qu'ajouter du silence")
        if self.kind == "silence_pad":
            pad = self.params.get("pad_s")
            if (
                isinstance(pad, bool)
                or not isinstance(pad, int | float)
                or pad <= 0
                or abs(pad * 1000 - round(pad * 1000)) > _MS_EPSILON
            ):
                raise RefCorpusError(
                    f"silence_pad exige params.pad_s > 0, en secondes, à la milliseconde : {pad!r}"
                )
            if self.shift_s != pad:
                raise RefCorpusError(
                    f"shift_s ({self.shift_s:g}) doit égaler params.pad_s ({pad:g}) : le silence "
                    "ajouté est exactement le décalage de la vérité"
                )
        elif self.shift_s != 0:
            raise RefCorpusError(
                f"shift_s doit valoir 0 pour {self.kind} (seul silence_pad décale le temps)"
            )

    @property
    def label(self) -> str:
        """Suffixe d'identifiant stable : `noise-snr_db10-seed3`."""
        parts = [f"{key}{_fmt(self.params[key])}" for key in sorted(self.params)]
        return "-".join([self.kind.replace("_", ""), *parts])

    def to_dict(self) -> dict[str, Any]:
        return {"kind": self.kind, "params": dict(self.params), "shift_s": self.shift_s}

    @classmethod
    def from_dict(cls, raw: object) -> Degradation:
        if not isinstance(raw, Mapping):
            raise RefCorpusError("ref.degradation doit être un dictionnaire")
        params = raw.get("params") or {}
        if not isinstance(params, Mapping):
            raise RefCorpusError("ref.degradation.params doit être un dictionnaire")
        return cls(str(raw.get("kind")), dict(params), float(raw.get("shift_s", 0.0)))


def _fmt(value: Param) -> str:
    return f"{value:g}" if isinstance(value, float) else str(value)


@dataclass(frozen=True)
class RefMeta:
    condition: str
    non_quran: bool = False
    parent: str | None = None
    degradation: Degradation | None = None

    def __post_init__(self) -> None:
        if self.condition not in CONDITIONS:
            raise RefCorpusError(f"condition inconnue : {self.condition!r}")
        if self.degradation is None and self.condition in DEGRADATION_KINDS:
            raise RefCorpusError(f"condition {self.condition!r} sans bloc degradation")
        if self.degradation is not None and self.degradation.kind != self.condition:
            raise RefCorpusError("condition et degradation.kind doivent être identiques")
        if (self.parent is None) != (self.degradation is None):
            raise RefCorpusError("parent et degradation vont ensemble (cas dérivé) ou pas du tout")

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema": REF_SCHEMA_VERSION,
            "condition": self.condition,
            "non_quran": self.non_quran,
            "parent": self.parent,
            "degradation": self.degradation.to_dict() if self.degradation else None,
        }

    @classmethod
    def from_dict(cls, raw: object) -> RefMeta:
        if not isinstance(raw, Mapping):
            raise RefCorpusError("bloc ref absent ou illisible")
        if raw.get("schema") != REF_SCHEMA_VERSION:
            raise RefCorpusError(
                f"schéma ref {raw.get('schema')!r} non géré (attendu {REF_SCHEMA_VERSION})"
            )
        degradation = raw.get("degradation")
        parent = raw.get("parent")
        return cls(
            condition=str(raw.get("condition")),
            non_quran=bool(raw.get("non_quran", False)),
            parent=str(parent) if parent is not None else None,
            degradation=Degradation.from_dict(degradation) if degradation is not None else None,
        )


def ref_meta(case: AudioCase) -> RefMeta:
    try:
        return RefMeta.from_dict(case.extra.get(REF_KEY))
    except RefCorpusError as exc:
        raise RefCorpusError(f"cas {case.id} : {exc}") from exc


def with_ref_meta(case: AudioCase, meta: RefMeta) -> AudioCase:
    return replace(case, extra={**case.extra, REF_KEY: meta.to_dict()})


def _shift(span: tuple[float, float], by: float) -> tuple[float, float]:
    return (round(span[0] + by, 3), round(span[1] + by, 3))


def shifted_truth(
    parent: AudioCase, shift: float
) -> tuple[tuple[ExpectedItem, ...], tuple[NonQuranItem, ...], tuple[tuple[float, float], ...]]:
    """Vérité du parent décalée de `shift` secondes : (expected, non_quran, annotated_windows)."""
    return (
        tuple(ExpectedItem(_shift(i.t, shift), i.ref, i.words, i.status) for i in parent.expected),
        tuple(NonQuranItem(_shift(i.t, shift), i.kind) for i in parent.non_quran),
        tuple(_shift(w, shift) for w in parent.annotated_windows),
    )


def degraded_id(parent_id: str, degradation: Degradation) -> str:
    return f"{parent_id}--{degradation.label}"


def degraded_case(
    parent: AudioCase, degradation: Degradation, *, sha256: str, duree_s: float | None
) -> AudioCase:
    """Cas dérivé d'un cas propre : même vérité (décalée de `shift_s` au plus), nouvel audio."""
    parent_meta = ref_meta(parent)
    if parent_meta.parent is not None:
        raise RefCorpusError(f"cas {parent.id} : on ne dégrade pas une dégradation")
    expected, non_quran, windows = shifted_truth(parent, degradation.shift_s)
    case_id = degraded_id(parent.id, degradation)
    derived = replace(
        parent,
        id=case_id,
        file=f"degraded/{case_id}.wav",
        sha256=sha256,
        duree_s=duree_s,
        categorie=tuple(dict.fromkeys((*parent.categorie, DEGRADED_CATEGORY))),
        expected=expected,
        non_quran=non_quran,
        annotated_windows=windows,
    )
    return with_ref_meta(
        derived,
        RefMeta(
            condition=degradation.kind,
            non_quran=parent_meta.non_quran,
            parent=parent.id,
            degradation=degradation,
        ),
    )


def assign_ref_splits(cases: Sequence[AudioCase], config: DataConfig) -> list[AudioCase]:
    """Affecte `split` à chaque cas par récitant (`assign_splits`).

    Un dérivé a le récitant de son parent, donc son jeu ; une affectation déjà écrite est gardée.
    """
    mapping = assign_splits(cases, config)
    return [replace(case, split=case.split or mapping[case.recitant]) for case in cases]


def _derived_problems(
    child: AudioCase, meta: RefMeta, parent: AudioCase, cfg: DataConfig
) -> list[str]:
    """Écarts entre un dérivé et son parent décalé de `shift_s` (vérité, statut, durée)."""
    where = f"cas {child.id}"
    problems: list[str] = []
    try:
        parent_meta = ref_meta(parent)
    except RefCorpusError:
        return problems  # déjà signalé au titre du parent
    if parent_meta.parent is not None:
        problems.append(f"{where} : dégradation d'une dégradation ({parent.id} est déjà dérivé)")
    if meta.non_quran != parent_meta.non_quran:
        problems.append(f"{where} : ref.non_quran diffère de celui du parent {parent.id}")
    shift = meta.degradation.shift_s if meta.degradation else 0.0
    expected, non_quran, windows = shifted_truth(parent, shift)
    for name, got, want in (
        ("expected", child.expected, expected),
        ("non_quran", child.non_quran, non_quran),
        ("annotated_windows", child.annotated_windows, windows),
    ):
        if got != want:
            problems.append(
                f"{where} : {name} diffère de celui du parent {parent.id} décalé de {shift:g} s"
            )
    if child.duree_s is None or parent.duree_s is None:
        problems.append(f"{where} : durée absente, impossible de la comparer à {parent.id}")
    elif abs(child.duree_s - (parent.duree_s + shift)) > cfg.derived_duration_tolerance_s:
        problems.append(
            f"{where} : durée {child.duree_s:g} s != parent {parent.duree_s:g} s + "
            f"décalage {shift:g} s (tolérance {cfg.derived_duration_tolerance_s:g} s)"
        )
    return problems


def validate_ref_manifest(manifest: Manifest, config: DataConfig | None = None) -> list[str]:
    """Problèmes du manifeste (liste vide = conforme au schéma figé)."""
    cfg = config or DataConfig()
    problems: list[str] = []
    by_id = {c.id: c for c in manifest.cases}
    sides: dict[str, set[str]] = {}
    for case in manifest.cases:
        try:
            meta = ref_meta(case)
        except RefCorpusError as exc:
            problems.append(str(exc))
            continue
        where = f"cas {case.id}"
        if not _SHA256.fullmatch(case.sha256):
            problems.append(f"{where} : sha256 invalide")
        if not case.license.strip():
            problems.append(f"{where} : license vide")
        if not case.recitant.strip():
            problems.append(f"{where} : recitant vide")
        if case.split not in cfg.splits:
            problems.append(f"{where} : split {case.split!r} (attendu {', '.join(cfg.splits)})")
        else:
            sides.setdefault(case.recitant, set()).add(case.split)
        if meta.non_quran and case.expected:
            problems.append(f"{where} : non_quran mais des versets sont attendus")
        if not meta.non_quran and not case.expected:
            problems.append(f"{where} : aucun verset attendu et non_quran faux")
        if meta.parent is not None:
            parent = by_id.get(meta.parent)
            if parent is None:
                problems.append(f"{where} : parent {meta.parent!r} absent")
            else:
                if parent.split != case.split or parent.recitant != case.recitant:
                    problems.append(f"{where} : doit avoir le récitant et le split de {parent.id}")
                problems.extend(_derived_problems(case, meta, parent, cfg))
    for recitant, found in sorted(sides.items()):
        if len(found) > 1:
            problems.append(f"récitant {recitant!r} présent en dev et en test (fuite)")
    return problems
