"""Décisions actives et réconciliation avec une prédiction (ADR-0014).

Rien ici ne modifie la prédiction : `reconcile` rend une vue (quelle décision s'applique à quel
intervalle) et la liste des décisions orphelines, que l'appelant montre à l'utilisateur au lieu de
les appliquer à un autre passage.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from aqr.decisions.fingerprint import interval_fingerprint
from aqr.decisions.model import Decision, DecisionsDocument


def target_key(decision: Decision) -> str:
    """Clé de ce que la décision vise : l'empreinte de l'intervalle, sinon ses signalements."""
    if decision.target.fingerprint is not None:
        return decision.target.fingerprint
    return "report:" + ",".join(sorted(decision.target.review_ids))


def active_decisions(document: DecisionsDocument) -> tuple[Decision, ...]:
    """Une seule décision par cible : ni annulée, ni remplacée, et la plus récente si plusieurs
    restent actives (même cible, deux enregistrements simultanés)."""
    latest: dict[str, Decision] = {}
    for decision in document.decisions:
        if not decision.active:
            continue
        key = target_key(decision)
        current = latest.get(key)
        if current is None or _rank(decision) > _rank(current):
            latest[key] = decision
    return tuple(sorted(latest.values(), key=lambda d: (d.decided_at, d.id)))


def _rank(decision: Decision) -> tuple[str, int, str]:
    return (decision.decided_at, decision.revision, decision.id)


def decisions_digest(decisions: Sequence[Decision]) -> str:
    """SHA-256 des décisions actives (ordre par identifiant) : sert à tracer un export et à mettre
    en cache. Annuler toutes les décisions redonne l'empreinte d'un export sans décision."""
    ordered = sorted(decisions, key=lambda d: d.id)
    payload = [
        {
            "id": d.id,
            "kind": d.kind,
            "target": target_key(d),
            "value": {
                k: v
                for k, v in {
                    "ref": d.value.ref,
                    "words": None if d.value.words is None else list(d.value.words),
                    "t": None if d.value.t is None else list(d.value.t),
                    "reason": d.value.reason,
                    "scope": d.value.scope,
                }.items()
                if v is not None
            },
        }
        for d in ordered
    ]
    text = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Reconciliation:
    applied: Mapping[int, Decision]
    """Index de l'intervalle du moteur -> décision active qui s'y applique."""
    reports: tuple[Decision, ...]
    """Décisions dont la cible est un signalement (sans intervalle) : à vérifier contre la revue."""
    orphans: tuple[Decision, ...]
    """Décisions dont l'intervalle n'existe plus tel quel dans cette prédiction."""


def reconcile(
    intervals: Sequence[Mapping[str, Any]], decisions: Sequence[Decision]
) -> Reconciliation:
    """Accroche chaque décision active à l'intervalle de même empreinte (jamais à une position)."""
    by_fingerprint: dict[str, list[int]] = {}
    for index, interval in enumerate(intervals):
        if interval.get("kind") == "verse":
            by_fingerprint.setdefault(interval_fingerprint(interval), []).append(index)
    applied: dict[int, Decision] = {}
    reports: list[Decision] = []
    orphans: list[Decision] = []
    for decision in decisions:
        if not decision.active:
            continue
        fingerprint = decision.target.fingerprint
        if fingerprint is None:
            reports.append(decision)
            continue
        candidates = [i for i in by_fingerprint.get(fingerprint, []) if i not in applied]
        if not candidates:
            orphans.append(decision)
            continue
        hint = decision.target.index
        applied[hint if hint in candidates else candidates[0]] = decision
    return Reconciliation(applied=applied, reports=tuple(reports), orphans=tuple(orphans))
