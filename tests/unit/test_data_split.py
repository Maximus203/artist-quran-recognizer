"""Découpage dev/test 70/30 groupé par récitant : déterministe, sans fuite."""

from __future__ import annotations

import dataclasses
import random

import pytest

from aqr.data.config import DataConfig
from aqr.data.manifest import AudioCase
from aqr.data.split import assign_splits


def _case(cid: str, recitant: str, duree: float, split: str | None = None) -> AudioCase:
    return AudioCase(
        id=cid,
        file=f"C01/{cid}.wav",
        sha256=cid.ljust(64, "0"),
        categorie=("C01",),
        recitant=recitant,
        riwaya="hafs",
        langues=("ar",),
        license="x",
        duree_s=duree,
        statut="annote",
        split=split,
    )


def _lot1_like() -> list[AudioCase]:
    spec = [
        ("orateur_c", 1576), ("assise_a", 4531), ("orateur_d", 4010), ("orateur_c", 8056),
        ("recitant_f", 1709), ("imam_e", 3128), ("imam_g", 2500), ("imam_h", 3300),
        ("recitant_i", 1800), ("assise_b", 2200),
    ]  # fmt: skip
    return [_case(f"k{i}", r, float(d)) for i, (r, d) in enumerate(spec)]


def test_aucun_recitant_des_deux_cotes():
    cases = _lot1_like()
    mapping = assign_splits(cases, DataConfig())
    sides: dict[str, set[str]] = {}
    for c in cases:
        sides.setdefault(c.recitant, set()).add(mapping[c.recitant])
    assert all(len(s) == 1 for s in sides.values())


def test_deterministe_et_independant_de_l_ordre():
    cases = _lot1_like()
    shuffled = cases[:]
    random.Random(3).shuffle(shuffled)
    assert assign_splits(cases, DataConfig()) == assign_splits(shuffled, DataConfig())


def test_ratio_proche_de_70_30_en_duree():
    cases = _lot1_like()
    mapping = assign_splits(cases, DataConfig())
    total = sum(c.duree_s or 0 for c in cases)
    dev = sum(c.duree_s or 0 for c in cases if mapping[c.recitant] == "dev")
    assert 0.55 <= dev / total <= 0.85


def test_le_ratio_est_une_configuration():
    all_dev = assign_splits(_lot1_like(), DataConfig(dev_ratio=1.0))
    assert set(all_dev.values()) == {"dev"}


def test_affectations_existantes_jamais_modifiees():
    cases = _lot1_like()
    first = assign_splits(cases, DataConfig())
    pinned = [dataclasses.replace(c, split=first[c.recitant]) for c in cases]
    newcomers = [*pinned, _case("z1", "nouveau_1", 3000.0), _case("z2", "nouveau_2", 900.0)]
    second = assign_splits(newcomers, DataConfig())
    for recitant, side in first.items():
        assert second[recitant] == side
    assert {"nouveau_1", "nouveau_2"} <= set(second)


def test_recitant_incoherent_dans_le_manifeste_est_signale():
    cases = [_case("a", "x", 10.0, "dev"), _case("b", "x", 10.0, "test")]
    with pytest.raises(ValueError, match="x"):
        assign_splits(cases, DataConfig())
