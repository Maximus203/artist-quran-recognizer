from __future__ import annotations

from aqr.corpus.tanzil_format import parse_tanzil_txt
from aqr.domain.models import VerseRef


def test_parse_ignore_commentaires_et_lignes_vides():
    raw = "# comment\n1|1|بسم الله\n\n1|2|الحمد لله\n# trailer\n"
    parsed = parse_tanzil_txt(raw)
    assert parsed[VerseRef(1, 1)] == "بسم الله"
    assert parsed[VerseRef(1, 2)] == "الحمد لله"
    assert len(parsed) == 2


def test_parse_ignore_lignes_malformees():
    raw = "1|1|texte\nligne sans pipes\n2|2|autre"
    parsed = parse_tanzil_txt(raw)
    assert len(parsed) == 2
