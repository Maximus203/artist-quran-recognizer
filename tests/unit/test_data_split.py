"""Découpage dev/test 70/30 groupé par récitant : déterministe, sans fuite."""

from __future__ import annotations

import dataclasses
import random

import pytest

from aqr.data.config import DataConfig
from aqr.data.manifest import AudioCase
from aqr.data.split import assign_splits, quarantine_recitant


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


# --- Quarantaine : récitant exposé pendant le réglage (protocole-reglage-evaluation.md)


def _groupe_expose() -> list[AudioCase]:
    """Un récitant `test` exposé (parent, dérivé bruité, autre cas) + un récitant `dev` voisin."""
    return [
        _case("p1", "expose", 100.0, "test"),
        _case("p1--noise-snr10", "expose", 100.0, "test"),
        _case("p2", "expose", 50.0, None),
        _case("d1", "voisin", 80.0, "dev"),
    ]


def test_quarantaine_deplace_tout_le_groupe():
    cases = _groupe_expose()
    config = DataConfig()

    moved = quarantine_recitant(cases, "expose", config)

    by_id = {c.id: c for c in moved}
    assert [c.id for c in moved] == [c.id for c in cases]  # ordre conservé
    for cid in ("p1", "p1--noise-snr10", "p2"):
        assert by_id[cid].split == config.quarantine_split == "quarantaine"
    assert by_id["d1"] is cases[3]  # récitant dev intact (même objet)
    assert cases[0].split == "test"  # l'entrée n'est pas mutée
    mapping = assign_splits(moved, config)  # ne lève pas
    assert mapping == {"expose": "quarantaine", "voisin": "dev"}


def test_quarantaine_est_idempotente_et_complete_un_groupe_partiel():
    config = DataConfig()
    once = quarantine_recitant(_groupe_expose(), "expose", config)
    assert quarantine_recitant(once, "expose", config) == once  # no-op explicite
    partial = [*once, _case("p3--mp3-64k", "expose", 10.0, "test")]  # dérivé ajouté après coup
    assert {
        c.split for c in quarantine_recitant(partial, "expose", config) if c.recitant == "expose"
    } == {"quarantaine"}


def test_quarantaine_refuse_un_recitant_inconnu():
    with pytest.raises(ValueError, match="inconnu"):
        quarantine_recitant(_groupe_expose(), "personne", DataConfig())


def test_quarantaine_refuse_un_recitant_dev_ou_non_affecte():
    # dev : jamais exposé par construction ; le retirer du réglage serait une perte silencieuse
    with pytest.raises(ValueError, match="dev"):
        quarantine_recitant(_groupe_expose(), "voisin", DataConfig())
    # mélange dev/test = fuite à corriger à la main, pas à masquer par une quarantaine
    mixed = [_case("a", "x", 10.0, "dev"), _case("b", "x", 10.0, "test")]
    with pytest.raises(ValueError, match="dev"):
        quarantine_recitant(mixed, "x", DataConfig())
    # aucune affectation : rien n'a pu être exposé
    with pytest.raises(ValueError, match="affect"):
        quarantine_recitant([_case("n", "x", 10.0, None)], "x", DataConfig())


def test_la_quarantaine_n_est_ni_dev_ni_test_ni_dans_le_ratio():
    config = DataConfig()
    assert config.quarantine_split not in config.splits
    base = [_case("a", "r1", 1000.0, "dev")]
    newcomer = [_case("n", "n", 500.0)]
    # sans quarantaine : dev est à 100 %, le nouveau récitant rééquilibre vers test
    assert assign_splits([*base, *newcomer], config)["n"] == "test"
    # 10 000 s en quarantaine ne comptent pour rien : même affectation, et aucune levée
    heavy = [*base, _case("q", "q", 10_000.0, config.quarantine_split), *newcomer]
    result = assign_splits(heavy, config)
    assert result == {"r1": "dev", "q": "quarantaine", "n": "test"}


def test_quarantaine_melangee_a_un_autre_split_est_signalee():
    for other in ("dev", "test"):
        cases = [_case("a", "x", 10.0, "quarantaine"), _case("b", "x", 10.0, other)]
        with pytest.raises(ValueError, match="x"):
            assign_splits(cases, DataConfig())
