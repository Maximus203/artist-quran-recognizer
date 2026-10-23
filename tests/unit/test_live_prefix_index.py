"""PrefixIndex (ADR-0011, étape 1) : index des débuts de versets et des positions « n'importe où »."""

from __future__ import annotations

import pytest

from aqr.domain.models import VerseRef
from aqr.live.prefix_index import (
    PrefixIndex,
    common_prefix_length,
    discriminating_lengths,
)

BASMALA = ("بسم", "الله", "الرحمن", "الرحيم")


def ref(text: str) -> VerseRef:
    return VerseRef.parse(text)


def mini_flow() -> dict[VerseRef, tuple[str, ...]]:
    return {
        ref("1:2"): ("الحمد", "لله", "رب", "العالمين"),
        ref("2:1"): ("الم",),
        ref("9:1"): ("براءة", "من", "الله"),
        ref("112:1"): ("قل", "هو", "الله", "احد"),
        ref("112:2"): ("الله", "الصمد"),
        ref("113:1"): ("قل", "اعوذ", "برب", "الفلق"),
        ref("113:2"): ("من", "شر", "ما", "خلق"),
        ref("113:5"): ("قل", "هو", "الله", "احد"),  # sosie exact de 112:1
    }


@pytest.fixture
def index() -> PrefixIndex:
    return PrefixIndex(mini_flow(), basmala=BASMALA)


def test_les_positions_suivent_l_ordre_du_mushaf(index: PrefixIndex) -> None:
    assert index.size == 4 + 1 + 3 + 4 + 2 + 4 + 4 + 4
    assert index.verse_at(index.start_of(ref("112:1"))) == (ref("112:1"), 1)
    assert index.verse_at(index.end_of(ref("112:1"))) == (ref("112:1"), 4)
    assert index.length(ref("112:2")) == 2
    assert index.end_of(ref("112:1")) + 1 == index.start_of(ref("112:2"))


def test_le_mot_d_une_position_est_celui_du_flux(index: PrefixIndex) -> None:
    start = index.start_of(ref("113:2"))
    assert [index.token(start + i) for i in range(4)] == ["من", "شر", "ما", "خلق"]


def test_un_verset_sans_mot_est_refuse() -> None:
    with pytest.raises(ValueError):
        PrefixIndex({ref("112:1"): ()})


def test_les_mots_proches_sont_trouves_avec_leur_similarite(index: PrefixIndex) -> None:
    exact = index.similar_positions("الله")
    assert exact[index.start_of(ref("112:2"))] == 1.0
    assert all(index.token(p) in {"الله"} or 0 < s < 1 for p, s in exact.items())
    fuzzy = index.similar_positions("العالمون")  # une lettre de différence avec « العالمين »
    position = index.start_of(ref("1:2")) + 3
    assert 0.7 <= fuzzy[position] < 1.0


def test_un_mot_inconnu_n_a_aucune_position(index: PrefixIndex) -> None:
    assert index.similar_positions("zzzzzz") == {}


def test_les_sosies_exacts_sont_listes(index: PrefixIndex) -> None:
    assert index.twins(ref("112:1")) == (ref("113:5"),)
    assert index.twins(ref("113:5")) == (ref("112:1"),)
    assert index.twins(ref("112:2")) == ()


def test_le_plus_petit_prefixe_unique_en_mots(index: PrefixIndex) -> None:
    assert index.unique_prefix_words(ref("113:2")) == 1
    assert index.unique_prefix_words(ref("113:1")) == 2  # partage « قل » avec 112:1
    assert index.unique_prefix_words(ref("112:1")) is None  # sosie : jamais unique


def test_le_vocabulaire_compte_les_mots_distincts(index: PrefixIndex) -> None:
    assert index.vocabulary_size == len({t for words in mini_flow().values() for t in words})


def test_apres_une_basmala_seuls_les_premiers_versets_restent() -> None:
    flow = {**mini_flow(), ref("1:1"): BASMALA, ref("3:1"): ("الم",)}
    index = PrefixIndex(flow, basmala=BASMALA)
    after = {index.verse_at(p)[0] for p in index.after_basmala_starts}
    # 1:1 est la basmala elle-même, 9:1 n'en a pas ; 1:2 reste (basmala d'Al-Fatiha puis 1:2)
    assert after == {ref("1:2"), ref("2:1"), ref("3:1"), ref("112:1"), ref("113:1")}


def test_la_basmala_est_exposee_et_le_verset_1_1_n_est_pas_un_depart(index: PrefixIndex) -> None:
    assert index.basmala == BASMALA
    flow = {**mini_flow(), ref("1:1"): BASMALA}
    with_fatiha = PrefixIndex(flow, basmala=BASMALA)
    starts = {with_fatiha.verse_at(p)[0] for p in with_fatiha.verse_starts}
    assert ref("1:1") not in starts  # la basmala se traite par son propre événement


def test_le_verset_suivant_passe_la_fin_de_sourate(index: PrefixIndex) -> None:
    assert index.next_start(ref("112:1")) == index.start_of(ref("112:2"))
    assert index.next_start(ref("112:2")) is None  # 112:3 absent de ce corpus réduit


def test_les_fonctions_de_prefixe_sont_celles_du_script_d_analyse() -> None:
    assert common_prefix_length(("a", "b"), ("a", "c")) == 1
    result = discriminating_lengths([("a", ("x", "y")), ("b", ("x", "z"))])
    assert result["a"].needed == 2
