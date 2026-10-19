"""Texte d'alignement acoustique (ADR-0006) : graphie imla'i de l'ASR, rattachée aux mots Uthmani.

Le rendu reste Uthmani (I1) ; l'alignement a besoin de la graphie que le modèle a apprise. Une
plage de mots (`WordSpan`) est toujours exprimée en indices Uthmani : chaque mot imla'i porte
l'indice du mot Uthmani qu'il prononce.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from aqr.corpus.alignment_text import (
    AlignmentTexts,
    AlignmentVariant,
    map_to_uthmani,
    recited_span,
)
from aqr.domain.models import VerseRef, WordSpan

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"
needs_corpus = pytest.mark.skipif(
    not (CORPUS_DIR / "quran-simple.txt").exists(),
    reason="corpus (avec quran-simple.txt) non téléchargé : `python scripts/fetch_corpus.py`",
)


def test_meme_nombre_de_mots_donne_l_identite():
    assert map_to_uthmani(("ذَٰلِكَ", "ٱلْكِتَـٰبُ"), ("ذلك", "الكتاب")) == (1, 2)


def test_un_mot_uthmani_fusionne_recoit_les_deux_mots_imlai():
    # « يَـٰٓأَيُّهَا » (un mot Uthmani) se prononce « يا أيها » (deux mots imla'i).
    assert map_to_uthmani(("يَـٰٓأَيُّهَا", "ٱلنَّاسُ"), ("يا", "أيها", "الناس")) == (1, 1, 2)


def test_le_rattachement_est_monotone_meme_avec_des_graphies_differentes():
    uthmani = ("قَالَ", "يَـٰبْنَؤُمَّ", "لَا")
    imlai = ("قال", "يا", "ابن", "أم", "لا")
    mapped = map_to_uthmani(uthmani, imlai)
    assert mapped[0] == 1 and mapped[-1] == 3
    assert list(mapped) == sorted(mapped)
    assert set(mapped) == {1, 2, 3}


def test_sans_mot_imlai_leve_une_erreur():
    with pytest.raises(ValueError):
        map_to_uthmani(("قَالَ",), ())


def _texts() -> AlignmentTexts:
    ref = VerseRef(2, 21)
    return AlignmentTexts(
        uthmani={ref: ("يَـٰٓأَيُّهَا", "ٱلنَّاسُ", "ٱعْبُدُوا۟")},
        imlai={
            AlignmentVariant.VOCALIZED: {ref: ("يَا", "أَيُّهَا", "النَّاسُ", "اعْبُدُوا")},
            AlignmentVariant.BARE: {ref: ("يا", "أيها", "الناس", "اعبدوا")},
        },
    )


def test_les_mots_d_une_plage_portent_leur_indice_uthmani():
    words = _texts().words(WordSpan(VerseRef(2, 21), 1, 2), AlignmentVariant.BARE)
    assert [(w.word, w.text) for w in words] == [(1, "يا"), (1, "أيها"), (2, "الناس")]


def test_variante_vocalisee():
    words = _texts().words(WordSpan(VerseRef(2, 21), 3, 3), AlignmentVariant.VOCALIZED)
    assert [w.text for w in words] == ["اعْبُدُوا"]


def test_plage_hors_du_verset_refusee():
    with pytest.raises(ValueError, match="mots"):
        _texts().words(WordSpan(VerseRef(2, 21), 2, 4), AlignmentVariant.BARE)


def test_verset_absent_refuse():
    with pytest.raises(KeyError):
        _texts().words(WordSpan(VerseRef(2, 22), 1, 1), AlignmentVariant.BARE)


@pytest.mark.parametrize(
    ("ref", "words", "expected"),
    [
        (VerseRef(112, 1), 8, WordSpan(VerseRef(112, 1), 5, 8)),  # basmala concaténée par Tanzil
        (VerseRef(1, 1), 4, WordSpan(VerseRef(1, 1), 1, 4)),  # la basmala EST le verset 1:1
        (VerseRef(9, 1), 7, WordSpan(VerseRef(9, 1), 1, 7)),  # At-Tawbah : pas de basmala
        (VerseRef(112, 2), 2, WordSpan(VerseRef(112, 2), 1, 2)),
    ],
)
def test_plage_recitee_d_un_verset_entier(ref, words, expected):
    assert recited_span(ref, words) == expected


@needs_corpus
def test_corpus_reel_chaque_mot_uthmani_a_un_texte_d_alignement():
    from aqr.corpus.tanzil_repository import TanzilCorpusRepository

    corpus = TanzilCorpusRepository(CORPUS_DIR)
    texts = AlignmentTexts.from_corpus_dir(CORPUS_DIR, corpus)
    for ref in corpus.all_refs():
        count = len(corpus.words(ref))
        for variant in AlignmentVariant:
            words = texts.words(WordSpan(ref, 1, count), variant)
            assert {w.word for w in words} == set(range(1, count + 1)), (ref, variant)


@needs_corpus
def test_corpus_reel_ya_ayyuha():
    from aqr.corpus.tanzil_repository import TanzilCorpusRepository

    corpus = TanzilCorpusRepository(CORPUS_DIR)
    texts = AlignmentTexts.from_corpus_dir(CORPUS_DIR, corpus)
    words = texts.words(WordSpan(VerseRef(2, 21), 1, 2), AlignmentVariant.BARE)
    assert [w.text for w in words] == ["يا", "أيها", "الناس"]
    assert [w.word for w in words] == [1, 1, 2]
