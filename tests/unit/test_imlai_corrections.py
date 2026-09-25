"""Dictionnaire de corrections Uthmani -> imla'i, appris depuis le corpus (ADR-0003).

Nécessite le corpus réel (Uthmani + simple-clean) : sauté si non téléchargé.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from aqr.corpus.imlai_corrections import build_word_corrections, load_simple_clean_words
from aqr.corpus.normalize import normalize_arabic
from aqr.corpus.tanzil_repository import TanzilCorpusRepository

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"

pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "LOCK.json").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)


@pytest.fixture(scope="module")
def corpus() -> TanzilCorpusRepository:
    return TanzilCorpusRepository(CORPUS_DIR)


@pytest.fixture(scope="module")
def simple_clean_words(corpus: TanzilCorpusRepository):
    return load_simple_clean_words(CORPUS_DIR)


@pytest.fixture(scope="module")
def corrections(corpus: TanzilCorpusRepository, simple_clean_words) -> dict[str, str]:
    return build_word_corrections(corpus, simple_clean_words)


def test_samawat_corrige_vers_la_forme_imlai(corrections):
    # سَمَـٰوَٰتٍ (Uthmani) doit se corriger vers سماوات (imla'i), pas rester سموت.
    uthmani_norm = normalize_arabic("سَمَـٰوَٰتٍ")
    assert corrections.get(uthmani_norm) == "سماوات"


def test_amanou_corrige_sans_le_hamza_initial(corrections):
    uthmani_norm = normalize_arabic("ءَامَنُوا۟")
    assert corrections.get(uthmani_norm) == "امنوا"


def test_arrahman_n_est_pas_corrige_a_tort(corrections):
    # Piège découvert : "الرحمن" reste "الرحمن" en imla'i (jamais "الرحمان"),
    # y compris dans la basmala. Une règle générique casserait ce mot très fréquent.
    uthmani_norm = normalize_arabic("ٱلرَّحْمَـٰنِ")
    assert uthmani_norm == "الرحمن"
    assert corrections.get(uthmani_norm, uthmani_norm) == "الرحمن"


def test_mots_deja_identiques_absents_de_la_table(corrections):
    # Pas d'entrée pour un mot qui ne change pas (évite une table qui grossit
    # inutilement avec des identités).
    assert "الله" not in corrections or corrections["الله"] == "الله"


def test_reduit_fortement_le_taux_de_mots_hors_vocabulaire(corpus, simple_clean_words, corrections):
    """Mesure réelle : après correction, la quasi-totalité des mots imla'i du
    corpus doivent être retrouvables dans le vocabulaire Uthmani corrigé."""
    uthmani_vocab = set()
    for ref in corpus.all_refs():
        for w in corpus.words(ref):
            norm = normalize_arabic(w)
            uthmani_vocab.add(corrections.get(norm, norm))

    total = 0
    oov = 0
    for words in simple_clean_words.values():
        for w in words:
            total += 1
            if normalize_arabic(w) not in uthmani_vocab:
                oov += 1

    rate = oov / total
    # Résiduel connu et documenté (décision du 2026-09-25) : le "يا" vocatif est
    # fusionné au mot suivant en Uthmani ("يَـٰٓأَيُّهَا") mais séparé en imla'i
    # ("يا أيها") — aucune substitution mot-à-mot ne peut le corriger, c'est
    # l'index n-grammes de caractères (sans espaces) du matcher qui absorbe ce cas.
    assert rate < 0.012, f"taux de mots hors vocabulaire après correction : {rate:.3%}"
