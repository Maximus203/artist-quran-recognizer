"""Passages du Mushaf lus dans le corpus : mots avec signes de pause, comparaison de candidats."""

from __future__ import annotations

from pathlib import Path

import pytest

from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.domain.models import Detection, Status, TimeSpan, VerseRef, WordSpan
from aqr.rendering.home_renderer import HomeRenderer
from aqr.rendering.passages import PAUSE_SIGNS, Passages

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"

pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "quran-uthmani.txt").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)


@pytest.fixture(scope="module")
def corpus() -> TanzilCorpusRepository:
    return TanzilCorpusRepository(CORPUS_DIR)


@pytest.fixture(scope="module")
def passages(corpus: TanzilCorpusRepository) -> Passages:
    return Passages(corpus)


class _NoTranslations:
    def get(self, ref, translation_id):  # type: ignore[no-untyped-def]
        raise RuntimeError("pas de traduction dans ce test")


@pytest.mark.parametrize(
    ("ref", "first", "last"),
    [("11:61", 1, 10), ("11:61", 10, 17), ("2:255", 1, 50), ("2:255", 5, 9), ("112:1", 5, 8)],
)
def test_le_texte_d_une_plage_est_celui_du_rendu_existant(corpus, passages, ref, first, last):
    renderer = HomeRenderer(corpus, _NoTranslations())
    verse = VerseRef.parse(ref)
    detection = Detection(WordSpan(verse, first, last), TimeSpan(0.0, 1.0), Status.RECOGNIZED, 0.9)
    assert passages.text(verse, first, last) == renderer.span_text(detection)


def test_chaque_mot_garde_les_signes_de_pause_qui_le_suivent(passages):
    words = passages.words_with_signs(VerseRef.parse("11:61"), 1, 10)
    assert len(words) == 10
    with_sign = [n for n, word in enumerate(words) if any(ch in PAUSE_SIGNS for ch in word)]
    assert with_sign == [3]  # le signe de pause qui suit le quatrième mot
    assert all(len(w.split()) == 1 for n, w in enumerate(words) if n not in with_sign)


def test_une_plage_hors_verset_est_ramenee_ou_refusee(passages):
    ref = VerseRef.parse("112:3")
    assert passages.clip(ref, 1, 99) == (1, passages.word_count(ref))
    assert passages.clip(ref, 99, 120) is None


def test_la_basmala_concatenee_ne_compte_pas_comme_contenu(passages):
    assert passages.first_content_word(VerseRef.parse("112:1")) == 5
    assert passages.first_content_word(VerseRef.parse("1:1")) == 1
    assert passages.first_content_word(VerseRef.parse("9:1")) == 1
    assert passages.first_content_word(VerseRef.parse("112:2")) == 1


def test_11_61_et_7_73_ne_different_que_par_un_signe_de_pause(passages):
    a = passages.text(VerseRef.parse("11:61"), 1, 10)
    b = passages.text(VerseRef.parse("7:73"), 1, 10)
    assert a != b and passages.compare(a, b) == "sign"


def test_55_13_et_55_16_ont_le_meme_arabe(passages):
    a = passages.text(VerseRef.parse("55:13"), 1, 4)
    assert passages.compare(a, passages.text(VerseRef.parse("55:16"), 1, 4)) == "same"


def test_deux_versets_differents_different_par_les_lettres(passages):
    a = passages.text(VerseRef.parse("112:2"), 1, 2)
    b = passages.text(VerseRef.parse("112:3"), 1, 4)
    assert passages.compare(a, b) == "letters"
