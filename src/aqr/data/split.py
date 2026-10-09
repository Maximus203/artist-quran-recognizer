"""Découpage dev/test groupé par récitant (docs/DATA-COLLECTION.md §5).

Les récitants sont ordonnés par un hachage salé (déterministe, indépendant de l'ordre
d'entrée) puis affectés un à un du côté qui rapproche le plus la part de durée de `dev`
de `config.dev_ratio`. Une affectation déjà écrite dans le manifeste n'est JAMAIS modifiée :
les données arrivent par lots, un récitant ne doit pas passer de dev à test (fuite).

Seule exception, explicite et à sens unique : `quarantine_recitant` retire un récitant dont le
jeu `test` a été exposé pendant le réglage (docs/evaluation/protocole-reglage-evaluation.md).
Son split `config.quarantine_split` n'est ni évalué ni utilisé au réglage, ne compte pas dans le
ratio dev/test et ne revient jamais à `dev` ni à `test`.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from dataclasses import replace

from aqr.data.config import DataConfig
from aqr.data.manifest import AudioCase


def assign_splits(cases: Sequence[AudioCase], config: DataConfig) -> dict[str, str]:
    """{récitant: 'dev' | 'test' | quarantaine} pour tous les récitants des cas donnés.

    La quarantaine n'est jamais attribuée ici : elle ne vient que d'une affectation déjà écrite
    (`quarantine_recitant`) et son poids est exclu du calcul de la part `dev`.
    """
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
    total = sum(weight[r] for r, side in pinned.items() if side != config.quarantine_split)
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


def quarantine_recitant(
    cases: Sequence[AudioCase], recitant: str, config: DataConfig | None = None
) -> list[AudioCase]:
    """Met TOUT le groupe du récitant (parents, mixes, dérivés `<parent>--<label>`) en quarantaine.

    Ordre des cas conservé, entrées non modifiées. Idempotent (un groupe déjà en quarantaine est
    rendu tel quel ; un dérivé ajouté ensuite en `test` y est ramené). Refus (`ValueError`) :
    récitant inconnu, récitant sans affectation (rien n'a pu être exposé) et récitant en `dev`
    (jamais exposé par construction : le retirer du réglage serait une perte silencieuse, et un
    mélange dev/test est une fuite à corriger à la main).
    """
    cfg = config or DataConfig()
    group = [case for case in cases if case.recitant == recitant]
    if not group:
        raise ValueError(f"récitant inconnu : {recitant!r} (aucun cas dans le manifeste)")
    sides = {case.split for case in group if case.split is not None}
    if not sides:
        raise ValueError(
            f"récitant {recitant!r} sans affectation : aucun jeu test n'a pu être exposé"
        )
    allowed = {"test", cfg.quarantine_split}
    if not sides <= allowed:
        raise ValueError(
            f"récitant {recitant!r} affecté à {', '.join(sorted(sides - allowed))} : seul un "
            f"récitant `test` passe en quarantaine"
        )
    return [
        replace(case, split=cfg.quarantine_split) if case.recitant == recitant else case
        for case in cases
    ]
