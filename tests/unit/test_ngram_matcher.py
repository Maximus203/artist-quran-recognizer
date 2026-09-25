"""Tests du VerseMatcher n-grammes (B6). Nécessite le corpus réel (échantillons P3/P4/F3/F4
du playbook, référencés par verset précis) : sauté si `python scripts/fetch_corpus.py`
n'a pas été lancé, pas de dépendance réseau forcée pour la suite unitaire (NF2).
"""

from __future__ import annotations

import time
from pathlib import Path

import pytest

from aqr.corpus.normalize import normalize_arabic
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.domain.models import VerseRef
from aqr.matching.ngram_matcher import NgramVerseMatcher

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"

pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "LOCK.json").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)


@pytest.fixture(scope="module")
def corpus() -> TanzilCorpusRepository:
    return TanzilCorpusRepository(CORPUS_DIR)


@pytest.fixture(scope="module")
def matcher(corpus: TanzilCorpusRepository) -> NgramVerseMatcher:
    return NgramVerseMatcher(corpus)


def _normalized_verse_text(corpus: TanzilCorpusRepository, ref: VerseRef) -> str:
    return " ".join(normalize_arabic(w) for w in corpus.words(ref))


def test_transcription_exacte_2_255(corpus, matcher):  # P3
    query = _normalized_verse_text(corpus, VerseRef(2, 255))
    candidates = matcher.match(query)
    assert candidates
    assert candidates[0].span.ref == VerseRef(2, 255)
    assert candidates[0].score >= 0.95


def test_2_mots_errones_reste_2_255(corpus, matcher):  # P4
    words = [normalize_arabic(w) for w in corpus.words(VerseRef(2, 255))]
    assert len(words) >= 40, "l'échantillon suppose au moins 40 mots réels dans 2:255"
    words[10] = "خطا"  # simule une erreur de récitateur
    words[30] = "غلط"
    query = " ".join(words)
    candidates = matcher.match(query)
    assert candidates
    assert candidates[0].span.ref == VerseRef(2, 255)


def test_phrase_arabe_courante_sans_lien_coranique(matcher):  # F3
    query = normalize_arabic("من فضلك أعطني كوبا من الماء البارد لو سمحت")
    candidates = matcher.match(query)
    assert all(c.score < 0.5 for c in candidates)


def test_texte_francais_aucun_candidat(matcher):  # F4
    query = normalize_arabic("Bonjour, comment allez-vous aujourd'hui ?")
    assert query == ""
    assert matcher.match(query) == []


def test_performance_moins_de_50ms_par_requete(corpus, matcher):
    query = _normalized_verse_text(corpus, VerseRef(67, 2))
    matcher.match(query)  # échauffement
    start = time.perf_counter()
    matcher.match(query)
    elapsed_ms = (time.perf_counter() - start) * 1000
    assert elapsed_ms < 50, f"{elapsed_ms:.1f} ms"


def test_verset_tres_court_indexe_et_retrouvable(corpus, matcher):
    # 55:64 : "مُدْهَامَّتَانِ" — un seul mot.
    query = _normalized_verse_text(corpus, VerseRef(55, 64))
    candidates = matcher.match(query)
    assert candidates
    assert candidates[0].span.ref == VerseRef(55, 64)
