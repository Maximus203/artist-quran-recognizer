"""Robustesse du matcher contre des requêtes au format réel des ASR (ADR-0003) :
orthographe imla'i (pas le texte du corpus lui-même) + bruit lettre/mot.

Nécessite le corpus réel : sauté si non téléchargé.
"""

from __future__ import annotations

import random
import time
from pathlib import Path

import pytest

from aqr.corpus.imlai_corrections import build_word_corrections, load_simple_clean_words
from aqr.corpus.normalize import normalize_arabic
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.matching.flow_matcher import FlowVerseMatcher
from aqr.matching.noise import drop_random_word, inject_letter_noise, insert_random_word

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"

pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "LOCK.json").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)

_SAMPLE_SIZE = 300
_SEED = 42


@pytest.fixture(scope="module")
def corpus() -> TanzilCorpusRepository:
    return TanzilCorpusRepository(CORPUS_DIR)


@pytest.fixture(scope="module")
def simple_clean_words(corpus):
    return load_simple_clean_words(CORPUS_DIR)


@pytest.fixture(scope="module")
def matcher(corpus, simple_clean_words) -> FlowVerseMatcher:
    corrections = build_word_corrections(corpus, simple_clean_words)
    return FlowVerseMatcher(corpus, word_corrections=corrections)


@pytest.fixture(scope="module")
def sample_refs(corpus):
    refs = sorted(corpus.all_refs())
    rng = random.Random(_SEED)
    # Uniquement des versets avec au moins 4 mots : le bruit (mot manquant/en trop,
    # 1 erreur / 5 mots) n'a de sens que sur des requêtes de taille réaliste.
    eligible = [r for r in refs if len(corpus.words(r)) >= 4]
    return rng.sample(eligible, _SAMPLE_SIZE)


def _imlai_query_tokens(simple_clean_words, ref) -> tuple[str, ...]:
    words = simple_clean_words[ref]
    return tuple(normalize_arabic(w) for w in words)


def _top1_accuracy(
    matcher, corpus, simple_clean_words, refs, transform=None, rng=None
) -> tuple[float, float]:
    """Top-1 correct si la référence est la bonne, OU si son texte est identique
    (versets répétés mot pour mot, ex. le refrain d'Ar-Rahman) : sans contexte,
    aucun matcher ne peut départager deux versets au texte rigoureusement
    identique — c'est le rôle du décodeur (B7, déjà testé sur ce cas, P9), pas de
    ce niveau. Compter ces cas comme des échecs pénaliserait une ambiguïté réelle
    et attendue, pas un défaut du matcher.
    """
    correct = 0
    total_time = 0.0
    for ref in refs:
        tokens = _imlai_query_tokens(simple_clean_words, ref)
        if transform is not None:
            tokens = transform(tokens, rng)
        query = " ".join(tokens)
        start = time.perf_counter()
        candidates = matcher.match(query)
        total_time += time.perf_counter() - start
        if candidates and (
            candidates[0].span.ref == ref or corpus.text(candidates[0].span.ref) == corpus.text(ref)
        ):
            correct += 1
    return correct / len(refs), (total_time / len(refs)) * 1000


def test_top1_exact_imlai(matcher, corpus, simple_clean_words, sample_refs):
    accuracy, avg_ms = _top1_accuracy(matcher, corpus, simple_clean_words, sample_refs)
    assert accuracy >= 0.99, f"top-1 exact imla'i : {accuracy:.1%}"
    assert avg_ms < 50, f"{avg_ms:.1f} ms/requête"


def test_top1_avec_bruit_lettre_1_pour_5_mots(matcher, corpus, simple_clean_words, sample_refs):
    rng = random.Random(_SEED)
    accuracy, avg_ms = _top1_accuracy(
        matcher,
        corpus,
        simple_clean_words,
        sample_refs,
        transform=lambda tokens, r: inject_letter_noise(tokens, r, every_n_words=5),
        rng=rng,
    )
    assert accuracy >= 0.95, f"top-1 avec bruit lettre (1/5 mots) : {accuracy:.1%}"
    assert avg_ms < 50, f"{avg_ms:.1f} ms/requête"


def test_top1_avec_mot_manquant(matcher, corpus, simple_clean_words, sample_refs):
    rng = random.Random(_SEED)
    accuracy, _avg_ms = _top1_accuracy(
        matcher, corpus, simple_clean_words, sample_refs, transform=drop_random_word, rng=rng
    )
    assert accuracy >= 0.90, f"top-1 avec un mot manquant : {accuracy:.1%}"


def test_top1_avec_mot_en_trop(matcher, corpus, simple_clean_words, sample_refs):
    rng = random.Random(_SEED)
    accuracy, _avg_ms = _top1_accuracy(
        matcher, corpus, simple_clean_words, sample_refs, transform=insert_random_word, rng=rng
    )
    assert accuracy >= 0.90, f"top-1 avec un mot en trop : {accuracy:.1%}"
