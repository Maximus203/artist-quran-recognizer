"""Le calque de décisions humaines `aqr.decisions/1` (ADR-0014) : lecture stricte.

Une décision dit « voici la vérité, entendue, pour ce passage ». Elle ne réécrit jamais la
prédiction du moteur (`aqr.recognition/1`) : elle est accrochée à un intervalle par son empreinte
(`fingerprint.py`) et se superpose à lui. Annuler une décision la marque `withdrawn_at`, elle n'est
jamais supprimée (historique, et vérité terrain proposée à partir d'elle).

Aucun accès au corpus ici : le calque ne porte que des références, des plages de mots et des temps.
Le texte arabe est lu dans le corpus au moment du rendu (I1), la traduction vient de QuranEnc (I2).
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Final

from aqr.domain.models import VerseRef

SCHEMA: Final = "aqr.decisions/1"

KINDS: Final = (
    "choose",
    "set_ref",
    "confirm_inferred",
    "confirm_partial",
    "exclude",
    "adjust_time",
    "translation_scope",
    "dismiss_report",
    "ignore",
)
"""Genres de décision. `ignore`, `dismiss_report`, `translation_scope` ne sont jamais une vérité
terrain : elles disent comment exporter ou que le signalement est faux, pas ce qui est récité."""

FACTUAL_KINDS: Final = frozenset(
    {
        "choose",
        "set_ref",
        "confirm_inferred",
        "confirm_partial",
        "exclude",
        "adjust_time",
    }
)
"""Les décisions de nature factuelle : seules elles peuvent devenir une proposition de vérité
terrain (si elles ont été écoutées et que le consentement est donné)."""

REPORT_KINDS: Final = frozenset({"set_ref", "dismiss_report", "ignore"})
"""Genres permis quand la cible est un signalement sans intervalle du moteur."""

EXCLUDE_REASONS: Final = ("not_quran", "not_heard", "unwanted")
TRANSLATION_SCOPES: Final = ("verse", "fragment", "none")

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_REF = re.compile(r"^\d{1,3}:\d{1,3}$")
_USER = re.compile(r"^[\w.\-]{1,64}$")


class DecisionsError(ValueError):
    """Document de décisions incohérent (message en français, avec le chemin du champ fautif)."""


@dataclass(frozen=True)
class Consent:
    """Accord d'utiliser les décisions écoutées pour améliorer le moteur (ADR-0014 §6)."""

    training: bool
    by: str
    at: str


@dataclass(frozen=True)
class Target:
    """Ce que le moteur avait dit au moment de la décision, figé.

    `fingerprint` (voir `fingerprint.py`) fait foi ; `index` n'est qu'un indice de position.
    Sans empreinte, la cible est un signalement de revue (`review_ids`) qui n'a pas d'intervalle."""

    fingerprint: str | None
    index: int | None
    snapshot: Mapping[str, Any]
    review_ids: tuple[str, ...]


@dataclass(frozen=True)
class Evidence:
    listened: bool
    listened_s: float
    device: str


@dataclass(frozen=True)
class Value:
    """Valeur d'une décision ; les champs requis dépendent du genre (`parse_value`)."""

    ref: str | None = None
    words: tuple[int, int] | None = None
    t: tuple[float, float] | None = None
    reason: str | None = None
    scope: str | None = None


@dataclass(frozen=True)
class Decision:
    id: str
    kind: str
    target: Target
    value: Value
    evidence: Evidence
    use_for_training: bool
    decided_by: str
    decided_at: str
    revision: int
    superseded_by: str | None = None
    withdrawn_at: str | None = None

    @property
    def active(self) -> bool:
        return self.withdrawn_at is None and self.superseded_by is None

    @property
    def is_factual(self) -> bool:
        return self.kind in FACTUAL_KINDS


@dataclass(frozen=True)
class DecisionsDocument:
    session_id: str
    prediction_sha256: str | None
    consent: Consent
    revision: int
    updated_at: str
    decisions: tuple[Decision, ...] = field(default_factory=tuple)


# --- lecture ---------------------------------------------------------------------------------


def _fail(where: str, message: str) -> DecisionsError:
    return DecisionsError(f"{where} : {message}")


def _mapping(raw: object, where: str) -> Mapping[str, Any]:
    if not isinstance(raw, Mapping):
        raise _fail(where, "objet attendu")
    return raw


def _string(
    raw: Mapping[str, Any], key: str, where: str, *, pattern: re.Pattern[str] | None = None
) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value or (pattern and not pattern.match(value)):
        raise _fail(f"{where}.{key}", "valeur invalide")
    return value


def _optional_string(raw: Mapping[str, Any], key: str, where: str) -> str | None:
    if raw.get(key) is None:
        return None
    return _string(raw, key, where)


def _iso(raw: Mapping[str, Any], key: str, where: str) -> str:
    value = _string(raw, key, where)
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise _fail(f"{where}.{key}", "date ISO 8601 attendue") from None
    return value


def _optional_iso(raw: Mapping[str, Any], key: str, where: str) -> str | None:
    return None if raw.get(key) is None else _iso(raw, key, where)


def _integer(raw: Mapping[str, Any], key: str, where: str, *, minimum: int) -> int:
    value = raw.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise _fail(f"{where}.{key}", f"entier ≥ {minimum} attendu")
    return value


def _number(value: object, where: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise _fail(where, "nombre attendu")
    return float(value)


def _words(raw: object, where: str) -> tuple[int, int]:
    if (
        not isinstance(raw, Sequence)
        or isinstance(raw, str)
        or len(raw) != 2
        or any(isinstance(n, bool) or not isinstance(n, int) or n < 1 for n in raw)
        or raw[0] > raw[1]
    ):
        raise _fail(where, "plage de mots [début, fin] attendue (entiers ≥ 1, début ≤ fin)")
    return (int(raw[0]), int(raw[1]))


def _span(raw: object, where: str) -> tuple[float, float]:
    if not isinstance(raw, Sequence) or isinstance(raw, str) or len(raw) != 2:
        raise _fail(where, "temps [début, fin] attendu")
    start, end = _number(raw[0], where), _number(raw[1], where)
    if start < 0 or end <= start:
        raise _fail(where, "temps [début, fin] attendu (0 ≤ début < fin)")
    return (start, end)


def _ref(raw: object, where: str) -> str:
    if not isinstance(raw, str) or not _REF.match(raw):
        raise _fail(where, "référence « sourate:verset » attendue")
    try:
        VerseRef.parse(raw)
    except ValueError as exc:
        raise _fail(where, str(exc)) from None
    return raw


def parse_value(kind: str, raw: object, where: str) -> Value:
    """Valeur d'une décision d'après son genre ; tout champ superflu ou manquant est refusé."""
    data = _mapping(raw, where)
    allowed = {
        "choose": {"ref", "words", "t"},
        "set_ref": {"ref", "words", "t"},
        "confirm_inferred": {"t"},
        "confirm_partial": set(),
        "exclude": {"reason"},
        "adjust_time": {"t"},
        "translation_scope": {"scope"},
        "dismiss_report": set(),
        "ignore": set(),
    }[kind]
    extra = set(data) - allowed
    if extra:
        raise _fail(where, f"champ(s) inattendu(s) pour « {kind} » : {sorted(extra)}")
    ref = words = t = reason = scope = None
    if kind in ("choose", "set_ref"):
        if "ref" not in data:
            raise _fail(f"{where}.ref", "requis")
        if "words" not in data:
            raise _fail(f"{where}.words", "requis")
        ref, words = _ref(data["ref"], f"{where}.ref"), _words(data["words"], f"{where}.words")
    if kind == "adjust_time" and "t" not in data:
        raise _fail(f"{where}.t", "requis")
    if "t" in data and data["t"] is not None:
        t = _span(data["t"], f"{where}.t")
    if kind == "exclude":
        reason = data.get("reason")
        if reason not in EXCLUDE_REASONS:
            raise _fail(f"{where}.reason", f"raison attendue parmi {list(EXCLUDE_REASONS)}")
    if kind == "translation_scope":
        scope = data.get("scope")
        if scope not in TRANSLATION_SCOPES:
            raise _fail(f"{where}.scope", f"portée attendue parmi {list(TRANSLATION_SCOPES)}")
    return Value(ref=ref, words=words, t=t, reason=reason, scope=scope)


def _target(raw: object, kind: str, value: Value, where: str) -> Target:
    data = _mapping(raw, where)
    fingerprint = data.get("fingerprint")
    if fingerprint is not None and (
        not isinstance(fingerprint, str) or not _HEX64.match(fingerprint)
    ):
        raise _fail(
            f"{where}.fingerprint", "empreinte SHA-256 (64 caractères hexadécimaux) attendue"
        )
    ids = data.get("review_ids", [])
    if (
        not isinstance(ids, Sequence)
        or isinstance(ids, str)
        or any(not isinstance(i, str) or not _UUID.match(i) for i in ids)
    ):
        raise _fail(f"{where}.review_ids", "liste d'identifiants de signalement attendue")
    index = data.get("index")
    if index is not None and (isinstance(index, bool) or not isinstance(index, int) or index < 0):
        raise _fail(f"{where}.index", "entier ≥ 0 attendu")
    snapshot = data.get("snapshot", {})
    if not isinstance(snapshot, Mapping):
        raise _fail(f"{where}.snapshot", "objet attendu")
    if fingerprint is None:
        if not ids:
            raise _fail(where, "cible sans empreinte ni signalement")
        if kind not in REPORT_KINDS:
            raise _fail(where, f"« {kind} » ne s'applique pas à un signalement sans intervalle")
        if kind == "set_ref" and value.t is None:
            raise _fail(
                f"{where}", "une référence posée sur un signalement exige ses temps (value.t)"
            )
    return Target(
        fingerprint=fingerprint,
        index=index,
        snapshot=dict(snapshot),
        review_ids=tuple(ids),
    )


def _evidence(raw: object, where: str) -> Evidence:
    data = _mapping(raw if raw is not None else {}, where)
    listened = data.get("listened", False)
    if not isinstance(listened, bool):
        raise _fail(f"{where}.listened", "booléen attendu")
    seconds = _number(data.get("listened_s", 0.0), f"{where}.listened_s")
    if seconds < 0:
        raise _fail(f"{where}.listened_s", "durée ≥ 0 attendue")
    device = data.get("device", "unknown")
    if not isinstance(device, str) or len(device) > 32:
        raise _fail(f"{where}.device", "texte court attendu")
    return Evidence(listened=listened, listened_s=seconds, device=device)


def _decision(raw: object, where: str) -> Decision:
    data = _mapping(raw, where)
    kind = data.get("kind")
    if kind not in KINDS:
        raise _fail(f"{where}.kind", f"genre attendu parmi {list(KINDS)}")
    value = parse_value(str(kind), data.get("value", {}), f"{where}.value")
    use = data.get("use_for_training", False)
    if not isinstance(use, bool):
        raise _fail(f"{where}.use_for_training", "booléen attendu")
    return Decision(
        id=_string(data, "id", where, pattern=_UUID),
        kind=str(kind),
        target=_target(data.get("target"), str(kind), value, f"{where}.target"),
        value=value,
        evidence=_evidence(data.get("evidence"), f"{where}.evidence"),
        use_for_training=use,
        decided_by=_string(data, "decided_by", where, pattern=_USER),
        decided_at=_iso(data, "decided_at", where),
        revision=_integer(data, "revision", where, minimum=1),
        superseded_by=_optional_string(data, "superseded_by", where),
        withdrawn_at=_optional_iso(data, "withdrawn_at", where),
    )


def parse_decisions(raw: object) -> DecisionsDocument:
    """Lit un document `aqr.decisions/1` ; lève `DecisionsError` au premier champ incohérent."""
    data = _mapping(raw, "document")
    if data.get("schema") != SCHEMA:
        raise _fail("schema", f"schéma attendu : {SCHEMA}")
    sha = data.get("prediction_sha256")
    if sha is not None and (not isinstance(sha, str) or not _HEX64.match(sha.lower())):
        raise _fail("prediction_sha256", "empreinte SHA-256 attendue")
    consent_raw = _mapping(data.get("consent"), "consent")
    training = consent_raw.get("training")
    if not isinstance(training, bool):
        raise _fail("consent.training", "booléen attendu")
    consent = Consent(
        training=training,
        by=_string(consent_raw, "by", "consent", pattern=_USER),
        at=_iso(consent_raw, "at", "consent"),
    )
    items = data.get("decisions")
    if not isinstance(items, Sequence) or isinstance(items, str):
        raise _fail("decisions", "liste attendue")
    decisions = tuple(_decision(item, f"decisions[{n}]") for n, item in enumerate(items))
    ids = [d.id for d in decisions]
    if len(set(ids)) != len(ids):
        raise _fail("decisions", "identifiant en double")
    return DecisionsDocument(
        session_id=_string(data, "session_id", "document", pattern=_UUID),
        prediction_sha256=None if sha is None else sha.lower(),
        consent=consent,
        revision=_integer(data, "revision", "document", minimum=0),
        updated_at=_iso(data, "updated_at", "document"),
        decisions=decisions,
    )
