"""Propositions françaises candidates et normalisation des mots (découpage de la traduction)."""

from __future__ import annotations

import itertools

from aqr.translation_align.clauses import clause_starts
from aqr.translation_align.config import TranslationAlignmentConfig
from aqr.translation_align.tokens import arabic_stem, french_tokens, waqf_flags

CFG = TranslationAlignmentConfig()


def _pieces(text: str, cfg: TranslationAlignmentConfig = CFG) -> list[str]:
    starts = [0, *clause_starts(text, cfg), len(text)]
    return [text[a:b].strip() for a, b in itertools.pairwise(starts)]


def test_cuts_after_sentence_punctuation() -> None:
    text = "Adorez Allah. Vous n’avez point de divinité ! Craignez-Le"
    assert _pieces(text) == [
        "Adorez Allah.",
        "Vous n’avez point de divinité !",
        "Craignez-Le",
    ]


def test_no_cut_inside_parentheses() -> None:
    text = "Il vous a créé, et Il vous l’a fait peupler (et exploiter, dit-on). Implorez donc"
    assert _pieces(text) == [
        "Il vous a créé,",
        "et Il vous l’a fait peupler (et exploiter, dit-on).",
        "Implorez donc",
    ]


def test_closing_quote_and_footnote_marker_stay_with_the_previous_piece() -> None:
    text = 'Il dit : "Ô mon peuple ! Adorez Allah !" Puis ils partirent.[1] Et ensuite plus tard'
    assert _pieces(text) == [
        "Il dit :",
        '"Ô mon peuple !',
        'Adorez Allah !"',
        "Puis ils partirent.[1]",
        "Et ensuite plus tard",
    ]


def test_no_cut_without_following_space_or_at_the_end() -> None:
    assert clause_starts("Version 2.5 du texte final.", CFG) == []
    assert clause_starts("Un seul verset complet.", CFG) == []


def test_tiny_pieces_are_merged_with_their_neighbour() -> None:
    # « Oui. » n'a qu'un mot porteur de sens (< 2) : fusionné avec la proposition suivante
    assert _pieces("Oui. Nous croyons en Allah et au Jour dernier.") == [
        "Oui. Nous croyons en Allah et au Jour dernier."
    ]


def test_no_cut_when_parentheses_are_unbalanced() -> None:
    text = "Il dit (que non, vraiment. Peut-être"
    assert clause_starts(text, CFG) == []


def test_french_tokens_fold_case_accents_and_drop_markers() -> None:
    tokens = french_tokens("Qu’as-tu fait des Croyants[1] (ajout) Épargnés ?", CFG)
    assert "ajout" not in tokens  # parenthèse ignorée
    assert "croyan" in tokens
    assert "epargn" in tokens
    assert all(len(t) >= CFG.min_token_len for t in tokens)
    assert not any("[" in t or "1" in t for t in tokens)


def test_french_tokens_keep_parentheses_when_asked() -> None:
    cfg = TranslationAlignmentConfig(skip_parenthetical=False)
    assert "ajout" in french_tokens("Dit (ajout) vrai", cfg)


def test_arabic_stem_strips_article_conjunction_and_pronoun_suffix() -> None:
    assert arabic_stem("وَٱسْتَعْمَرَكُمْ") == "استعمر"
    assert arabic_stem("ٱلْأَرْضِ") == arabic_stem("أرض") == "ارض"
    assert arabic_stem("ٱللَّهَ") == "الله"  # le nom d'Allah n'est jamais rogné
    assert arabic_stem("رَبِّكُمَا") == "رب"
    assert arabic_stem("مِنْ") == "من"  # un mot court n'est jamais réduit


def test_waqf_flags_follow_the_word_they_stop() -> None:
    text = "قَالَ يَـٰقَوْمِ ۖ ٱعْبُدُوا۟ ٱللَّهَ ۚ مَا لَكُم ۙ هُوَ"
    flags = waqf_flags(text)
    assert flags == [0, 1, 0, 1, 0, -1, 0]
