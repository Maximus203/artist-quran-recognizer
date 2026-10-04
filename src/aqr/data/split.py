"""Découpage dev/test groupé par récitant (docs/DATA-COLLECTION.md §5).

Les récitants sont ordonnés par un hachage salé (déterministe, indépendant de l'ordre
d'entrée) puis affectés un à un du côté qui rapproche le plus la part de durée de `dev`
de `config.dev_ratio`. Une affectation déjà écrite dans le manifeste n'est JAMAIS modifiée :
les données arrivent par lots, un récitant ne doit pas passer de dev à test (fuite).
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence

from aqr.data.config import DataConfig
from aqr.data.manifest import AudioCase


def assign_splits(cases: Sequence[AudioCase], config: DataConfig) -> dict[str, str]:
    """{récitant: 'dev' | 'test'} pour tous les récitants des cas donnés."""
    weight: dict[str, float] = {}
    pinned: dict[str, str] = {}
    for case in cases:
        weight[case.recitant] = weight.get(case.recitant, 0.0) + (case.duree_s or 1.0)
        if case.split is not None:
            previous = pinned.setdefault(case.recitant, case.split)
            if previous != case.split:
                raise ValueError(
                    f"récitant {case.recitant!r} présent à la fois en {previous} et en "
                    f"{case.split} dans le manifeste : fuite dev/test à corriger à la main"
                )

    dev = sum(weight[r] for r, side in pinned.items() if side == "dev")
    total = sum(weight[r] for r in pinned)
    mapping = dict(pinned)

    def order_key(recitant: str) -> str:
        return hashlib.sha256(f"{config.split_seed}:{recitant}".encode()).hexdigest()

    for recitant in sorted((r for r in weight if r not in pinned), key=order_key):
        w = weight[recitant]
        share_if_dev = (dev + w) / (total + w)
        share_if_test = dev / (total + w)
        if abs(share_if_dev - config.dev_ratio) <= abs(share_if_test - config.dev_ratio):
            mapping[recitant] = "dev"
            dev += w
        else:
            mapping[recitant] = "test"
        total += w
    return mapping
