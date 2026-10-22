"""Lecteur `aqr.recognition/1` : zones non coraniques, dont la basmala affichée comme un verset
(champs additifs : l'ancien format `{kind, label, t}` reste lisible)."""

from __future__ import annotations

import pytest

from aqr.domain.models import VerseRef
from aqr.eval.recognition import NonQuranInterval, RecognitionError, parse_intervals

_BASMALA = {
    "kind": "non_quran",
    "label": "basmala",
    "t": [2.5, 5.0],
    "basmala": True,
    "ref": "1:1",
    "text": "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ",
    "translation": {
        "text": "Au nom d'Allah",
        "translation_id": "x",
        "version": "1",
        "scope": "verse",
    },
}


def _one(raw: dict) -> NonQuranInterval:
    (item,) = parse_intervals([raw])
    assert isinstance(item, NonQuranInterval)
    return item


def test_l_ancien_format_reste_lisible() -> None:
    item = _one({"kind": "non_quran", "label": "takbir", "t": [1.0, 2.0]})
    assert item == NonQuranInterval("takbir", (1.0, 2.0))
    assert item.basmala is False and item.ref is None and item.text is None
    assert item.label_ar is None


def test_la_basmala_est_lue_avec_sa_reference_et_son_texte() -> None:
    item = _one(_BASMALA)
    assert item.label == "basmala" and item.basmala is True
    assert item.ref == VerseRef(1, 1)
    assert item.text == _BASMALA["text"]
    assert item.t == (2.5, 5.0)


def test_une_formule_porte_un_libelle_arabe_jamais_un_texte() -> None:
    item = _one({"kind": "non_quran", "label": "amin", "t": [1.0, 2.0], "label_ar": "آمين"})
    assert item.label_ar == "آمين" and item.text is None and item.basmala is False


@pytest.mark.parametrize(
    "patch",
    [
        {"ref": "2:255"},  # la basmala est le verset 1:1, pas un autre
        {"label": "takbir"},  # `basmala: true` sur une autre formule
        {"basmala": False},  # un texte du Mushaf sans être la basmala (I1 : seul 1:1 est rendu)
        {"label_ar": "آمين"},  # un libellé n'est pas un texte du Mushaf : jamais sur la basmala
    ],
)
def test_une_zone_incoherente_est_refusee(patch: dict) -> None:
    with pytest.raises(RecognitionError):
        parse_intervals([{**_BASMALA, **patch}])


def test_un_texte_sur_une_formule_est_refuse() -> None:
    with pytest.raises(RecognitionError):
        parse_intervals(
            [{"kind": "non_quran", "label": "takbir", "t": [1.0, 2.0], "text": "الله أكبر"}]
        )
