"""Flux de mots du Coran pour le suivi en direct : mêmes chiffres que l'analyse de l'ADR-0011."""

from __future__ import annotations

from pathlib import Path

import pytest

from aqr.domain.models import VerseRef
from aqr.live.corpus_flow import flow_words, load_prefix_index, make_skeleton

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"
needs_corpus = pytest.mark.skipif(
    not (CORPUS_DIR / "quran-uthmani.txt").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)


class _FakeCorpus:
    riwaya = "hafs"
    version = "test"

    def __init__(self, verses: dict[VerseRef, tuple[str, ...]]) -> None:
        self._verses = verses

    def text(self, ref: VerseRef) -> str:
        return " ".join(self._verses[ref])

    def words(self, ref: VerseRef) -> tuple[str, ...]:
        return self._verses[ref]

    def all_refs(self) -> list[VerseRef]:
        return sorted(self._verses)


def test_le_squelette_normalise_et_corrige() -> None:
    skeleton = make_skeleton({"سموت": "سماوات"})
    assert skeleton("سَمَوَٰتِ") == "سماوات"
    assert skeleton("قُلْ") == "قل"
    assert skeleton("") == ""


def test_la_basmala_du_verset_un_sort_du_flux_sauf_pour_la_fatiha_et_at_tawba() -> None:
    basmala = ("بسم", "الله", "الرحمن", "الرحيم")
    corpus = _FakeCorpus(
        {
            VerseRef(1, 1): basmala,
            VerseRef(2, 1): (*basmala, "الم"),
            VerseRef(9, 1): ("براءة", "من"),
        }
    )
    skeleton = make_skeleton({})
    flow, found = flow_words(corpus, skeleton)
    assert found == tuple(skeleton(w) for w in basmala)
    assert flow[VerseRef(1, 1)] == found
    assert flow[VerseRef(2, 1)] == (skeleton("الم"),)
    assert flow[VerseRef(9, 1)] == (skeleton("براءة"), skeleton("من"))


@needs_corpus
def test_l_index_du_coran_a_les_chiffres_de_l_adr() -> None:
    index, skeleton = load_prefix_index(CORPUS_DIR)
    assert len(index.refs) == 6236
    assert index.size == 77433  # ADR-0011, mesure A
    unique = [index.unique_prefix_words(r) for r in index.refs]
    assert sum(1 for u in unique if u is None) == 289
    resolved = sorted(u for u in unique if u is not None)
    assert resolved[len(resolved) // 2] == 2  # médiane de 2 mots
    assert skeleton("قُلْ") == "قل"
    assert len(index.basmala) == 4
    assert len(index.after_basmala_starts) == 113  # ADR-0011, mesure D
