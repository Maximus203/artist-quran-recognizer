"""Analyse des préfixes de versets (scripts/analyze_verse_prefixes.py) : logique pure."""

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _module():
    spec = importlib.util.spec_from_file_location(
        "analyze_verse_prefixes", ROOT / "scripts" / "analyze_verse_prefixes.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # requis par @dataclass
    spec.loader.exec_module(module)
    return module


m = _module()


def test_un_prefixe_unique_se_compte_en_mots() -> None:
    result = m.discriminating_lengths(
        [("a", ("x", "y", "z")), ("b", ("x", "y", "w")), ("c", ("q",))]
    )
    assert result["a"].needed == 3  # partage x y avec b
    assert result["b"].needed == 3
    assert result["c"].needed == 1  # un seul mot suffit


def test_deux_versets_identiques_n_ont_aucun_prefixe_unique() -> None:
    result = m.discriminating_lengths([("a", ("x", "y")), ("b", ("x", "y")), ("c", ("z",))])
    assert result["a"].needed is None and result["a"].blocker == "twin"
    assert result["b"].blocker == "twin"
    assert result["c"].needed == 1


def test_un_verset_qui_est_le_debut_dun_plus_long_ne_se_distingue_pas_par_son_debut() -> None:
    result = m.discriminating_lengths([("court", ("x", "y")), ("long", ("x", "y", "z"))])
    assert result["court"].needed is None and result["court"].blocker == "prefix_of_longer"
    assert result["long"].needed == 3  # le mot en plus le départage


def test_un_seul_element_a_besoin_dun_symbole() -> None:
    assert m.discriminating_lengths([("a", ("x", "y"))])["a"].needed == 1


def test_les_lettres_fonctionnent_comme_les_mots() -> None:
    result = m.discriminating_lengths([("a", "abcd"), ("b", "abxy"), ("c", "zzzz")])
    assert result["a"].needed == 3
    assert result["c"].needed == 1


def test_le_voisin_trie_donne_le_meilleur_prefixe_commun_avec_tous() -> None:
    sequences = [
        (i, seq) for i, seq in enumerate([("a", "b", "c", "d"), ("a", "b", "c", "e"), ("a", "z")])
    ]
    result = m.discriminating_lengths(sequences)
    expected = {}
    for key, seq in sequences:
        best = max(m.common_prefix_length(seq, other) for k, other in sequences if k != key)
        expected[key] = best + 1
    assert {k: r.needed for k, r in result.items()} == expected


def test_resume_statistique() -> None:
    summary = m.summarize([1, 2, 3, 4, 10])
    assert summary == {"count": 5, "median": 3, "p90": 10, "max": 10, "mean": 4.0}
    assert m.summarize([])["median"] is None
    assert m.summarize([1, 3])["median"] == 2


def test_part_resolue_en_au_plus_k_mots() -> None:
    assert m.cumulative_share([1, 2, 2, 5], 5, (1, 2, 5)) == {1: 0.2, 2: 0.6, 5: 0.8}


def test_groupes_de_debut_commun() -> None:
    sequences = {
        "a": ("x", "y", "z", "1"),
        "b": ("x", "y", "z", "2"),
        "c": ("x", "y", "w"),
        "d": ("x", "y"),
        "e": ("q", "r", "s"),
    }
    groups = m.shared_start_groups(sequences, 3)
    assert groups == [["a", "b"]]
    assert m.shared_start_groups(sequences, 2) == [["a", "b", "c", "d"]]


def test_groupes_de_sosies() -> None:
    assert m.twin_groups({"a": ("x",), "b": ("x",), "c": ("y",)}) == [["a", "b"]]


def test_posterior_de_la_suite_baisse_avec_les_rivaux() -> None:
    alone = m.posterior_continuation(0.9, same=(1, 100), other=(0, 6000))
    crowded_elsewhere = m.posterior_continuation(0.9, same=(1, 100), other=(700, 6000))
    crowded_in_surah = m.posterior_continuation(0.9, same=(50, 100), other=(0, 6000))
    assert alone == pytest.approx(1.0)
    assert 0.98 < crowded_elsewhere < alone
    assert crowded_in_surah < crowded_elsewhere  # les rivaux de la sourate pèsent davantage


def test_posterior_cas_extremes() -> None:
    # tous les versets portent les mots : seule la masse de continuation reste
    everything = m.posterior_continuation(0.9, same=(100, 100), other=(6000, 6000))
    assert everything == pytest.approx(0.9 / (0.9 + 0.1))
    # sourate d'un seul verset : la masse « dans la sourate » retombe hors sourate
    lone = m.posterior_continuation(0.9, same=(1, 1), other=(6000, 6000))
    assert lone == pytest.approx(0.9 / (0.9 + 0.1))


def test_posterior_refuse_les_parametres_invalides() -> None:
    with pytest.raises(ValueError):
        m.posterior_continuation(1.0, (1, 10), (0, 10))
    with pytest.raises(ValueError):
        m.posterior_continuation(0.9, (0, 10), (0, 10))
    with pytest.raises(ValueError):
        m.posterior_continuation(0.9, (11, 10), (0, 10))
    with pytest.raises(ValueError):
        m.posterior_continuation(0.9, (1, 10), (0, 10), same_share=1.5)


def test_mots_necessaires_avec_lapriori() -> None:
    crowd = ((60, 100), (3000, 6000))
    few = ((20, 100), (100, 6000))
    alone = ((1, 100), (0, 6000))
    assert m.bayes_words_needed(0.9, 0.99, [crowd, few, alone]) == 3
    assert m.bayes_words_needed(0.9, 0.99, [crowd, crowd]) is None
    assert m.bayes_words_needed(0.9, 0.5, [crowd]) == 1  # un seuil bas se satisfait vite


def test_comptage_des_prefixes() -> None:
    counts = m.prefix_match_counts([("x", "y"), ("x", "z"), ("w",)], 2)
    assert counts[0][("x",)] == 2
    assert counts[1][("x", "y")] == 1
    assert counts[1][("w",)] == 0  # le verset d'un mot ne compte pas à k=2


def test_fin_estimee_dun_mot_a_debit_uniforme() -> None:
    assert m.word_end_time(10.0, 20.0, 1, 5) == pytest.approx(12.0)
    assert m.word_end_time(10.0, 20.0, 5, 5) == pytest.approx(20.0)
    with pytest.raises(ValueError):
        m.word_end_time(10.0, 20.0, 6, 5)


class _Ref:
    def __init__(self, surah: int, ayah: int) -> None:
        self.surah, self.ayah = surah, ayah

    def __hash__(self) -> int:
        return hash((self.surah, self.ayah))

    def __eq__(self, other: object) -> bool:
        return isinstance(other, _Ref) and (self.surah, self.ayah) == (other.surah, other.ayah)


def _verse(ref: str, words: list[int], t: list[float], status: str = "recognized") -> dict:
    return {"kind": "verse", "ref": ref, "words": words, "t": t, "status": status}


def test_rejeu_donne_le_temps_ou_le_verset_devient_unique_avec_et_sans_apriori() -> None:
    flow = {
        _Ref(1, 1): ("a", "b", "c", "d"),
        _Ref(1, 2): ("a", "b", "x", "y"),  # partage a b avec 1:1
        _Ref(2, 1): ("z",),
    }
    everywhere, same_surah = m.start_and_rival_lengths(flow)
    assert everywhere[_Ref(1, 1)].needed == 3
    assert same_surah[_Ref(2, 1)].needed == 1
    document = {
        "intervals": [
            _verse("1:1", [1, 4], [0.0, 4.0]),
            _verse("1:2", [1, 4], [5.0, 9.0]),
            {"kind": "abstention", "t": [9.0, 10.0]},
        ]
    }
    rows = m.replay_document(document, flow, everywhere, same_surah)
    assert [r["ref"] for r in rows] == ["1:1", "1:2"]
    assert rows[0]["t_start"] == pytest.approx(3.0)  # 3 mots sur 4 en 4 s
    assert rows[0]["t_context"] is None  # pas de verset précédent
    assert rows[1]["with_context"] is True
    assert rows[1]["t_context"] == pytest.approx(3.0)  # rival 1:1 partage 2 mots : 3 mots encore
    summary = m.summarize_replay(rows)
    assert summary["no_prior"]["verses"] == 2
    assert summary["expected_next"]["verses"] == 1


def test_rejeu_ignore_les_versets_non_reconnus_ou_partiels() -> None:
    flow = {_Ref(1, 1): ("a", "b"), _Ref(1, 2): ("c", "d")}
    everywhere, same_surah = m.start_and_rival_lengths(flow)
    document = {
        "intervals": [
            _verse("1:1", [1, 1], [0.0, 1.0]),  # partiel : 1 mot sur 2
            _verse("1:2", [1, 2], [2.0, 3.0], status="uncertain"),
        ]
    }
    assert m.replay_document(document, flow, everywhere, same_surah) == []


def test_un_temps_est_none_quand_aucun_prefixe_nest_unique() -> None:
    flow = {_Ref(1, 1): ("a", "b"), _Ref(1, 2): ("a", "b")}
    everywhere, same_surah = m.start_and_rival_lengths(flow)
    document = {"intervals": [_verse("1:1", [1, 2], [0.0, 2.0])]}
    rows = m.replay_document(document, flow, everywhere, same_surah)
    assert rows[0]["t_start"] is None
    assert m.summarize_replay(rows)["no_prior"]["unresolved"] == 1
