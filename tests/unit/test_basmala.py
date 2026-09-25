from __future__ import annotations

import pytest

from aqr.domain.quran_structure import is_basmala_only_span, verse_one_includes_basmala


def test_verse_one_includes_basmala_sauf_tawbah():
    assert verse_one_includes_basmala(1) is True
    assert verse_one_includes_basmala(112) is True
    assert verse_one_includes_basmala(9) is False


@pytest.mark.parametrize("last_word", [1, 2, 3, 4])
def test_plage_dans_les_4_premiers_mots_du_verset_1_est_la_basmala(last_word):
    # 112:1 = "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ قُلْ هُوَ ٱللَّهُ أَحَدٌ" (basmala + 4 mots).
    assert is_basmala_only_span(surah=112, ayah=1, first_word=1, last_word=last_word) is True


def test_plage_qui_deborde_sur_le_verset_n_est_pas_que_la_basmala():
    assert is_basmala_only_span(surah=112, ayah=1, first_word=1, last_word=5) is False
    assert is_basmala_only_span(surah=112, ayah=1, first_word=5, last_word=8) is False


def test_verset_1_1_al_fatiha_jamais_etiquete_basmala():
    # Dans Al-Fatiha, la basmala EST le verset 1 — pas une étiquette à part.
    assert is_basmala_only_span(surah=1, ayah=1, first_word=1, last_word=4) is False


def test_sourate_9_sans_basmala():
    # At-Tawbah (9) : le verset 1 ne commence pas par la basmala dans le Mushaf.
    assert is_basmala_only_span(surah=9, ayah=1, first_word=1, last_word=4) is False


def test_pas_le_verset_1_pas_concerne():
    assert is_basmala_only_span(surah=112, ayah=2, first_word=1, last_word=2) is False
