"""Empreinte d'un intervalle du moteur (ADR-0014) : l'identité d'un passage, figée.

Une décision s'accroche à ce que le moteur avait dit (`kind`, `ref`, `words`, `status`,
`candidates`, `t`), pas à sa position dans la liste. Si l'analyse est relancée et que le moteur
redit exactement la même chose, la décision s'applique encore ; sinon elle devient orpheline et
n'est jamais appliquée en silence.

Le calcul est identique en TypeScript (`web/lib/decisions.ts`) : mêmes clés, mêmes temps en
millisecondes entières, même sérialisation. Les vecteurs de `tests/fixtures/decisions/` le
garantissent des deux côtés.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Mapping
from typing import Any

from aqr.decisions.model import DecisionsError


def _millis(seconds: object) -> int:
    """`floor(x * 1000 + 0.5)` : le demi vers le haut, jamais l'arrondi bancaire de `round`."""
    if isinstance(seconds, bool) or not isinstance(seconds, int | float):
        raise DecisionsError("temps d'intervalle illisible")
    return math.floor(float(seconds) * 1000 + 0.5)


def canonical_interval(interval: Mapping[str, Any]) -> dict[str, Any]:
    """Forme canonique d'un intervalle `verse` : seulement ce que le moteur a dit, temps en ms."""
    if interval.get("kind") != "verse":
        raise DecisionsError("seul un intervalle « verse » a une empreinte")
    t = interval.get("t")
    words = interval.get("words")
    return {
        "candidates": [str(c) for c in interval.get("candidates") or []],
        "kind": "verse",
        "ref": interval.get("ref"),
        "status": interval.get("status"),
        "t": None if t is None else [_millis(t[0]), _millis(t[1])],
        "words": None if words is None else [int(words[0]), int(words[1])],
    }


def interval_fingerprint(interval: Mapping[str, Any]) -> str:
    text = json.dumps(
        canonical_interval(interval), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
