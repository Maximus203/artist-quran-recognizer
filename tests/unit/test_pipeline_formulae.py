"""Formules non coraniques de la prière (isti'adha, takbir, amin) et basmala : étiquetées, jamais
rendues comme versets. Lexique de RECONNAISSANCE : ces mots ne sont jamais affichés."""

from __future__ import annotations

import pytest

from aqr.corpus.normalize import normalize_arabic
from aqr.domain.models import NonQuranKind
from aqr.pipeline.formulae import FormulaConfig, classify_formula

BASMALA = ("بسم", "الله", "الرحمن", "الرحيم")


def _tokens(text: str) -> list[str]:
    return normalize_arabic(text).split()


@pytest.mark.parametrize(
    ("text", "kind"),
    [
        ("أعوذ بالله من الشيطان الرجيم", NonQuranKind.ISTIADHA),
        ("اعوذ بالله من الشيطان الرجيم", NonQuranKind.ISTIADHA),
        ("أعوذ بالله من الشيطان الرجم", NonQuranKind.ISTIADHA),  # une lettre en moins
        ("الله أكبر", NonQuranKind.TAKBIR),
        ("آمين", NonQuranKind.AMIN),
        ("بسم الله الرحمن الرحيم", NonQuranKind.BASMALA),
    ],
)
def test_formules_reconnues(text, kind):
    assert classify_formula(_tokens(text), BASMALA, FormulaConfig()) is kind


@pytest.mark.parametrize(
    "text",
    [
        "الله أكبر كبيرا والحمد لله كثيرا",  # un takbir noyé dans autre chose n'est pas la formule
        "قل هو الله أحد",
        "الحمد لله رب العالمين",
        "فإذا قرأت القرآن فاستعذ بالله من الشيطان الرجيم",  # 16:98 : un VERSET, pas la formule
        "",
    ],
)
def test_pas_une_formule(text):
    assert classify_formula(_tokens(text), BASMALA, FormulaConfig()) is None


def test_un_mot_parasite_toleree_si_configure():
    tokens = _tokens("الله أكبر الله")
    assert classify_formula(tokens, BASMALA, FormulaConfig(extra_words_allowed=0)) is None
    assert (
        classify_formula(tokens, BASMALA, FormulaConfig(extra_words_allowed=1))
        is NonQuranKind.TAKBIR
    )
