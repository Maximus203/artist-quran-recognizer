from aqr.domain.quran_structure import AYAH_COUNTS, SURAH_COUNT, TOTAL_AYAHS, ayah_count


def test_114_sourates():
    assert len(AYAH_COUNTS) == SURAH_COUNT == 114


def test_total_6236_versets():
    assert sum(AYAH_COUNTS) == TOTAL_AYAHS == 6236


def test_reperes_connus():
    assert ayah_count(1) == 7
    assert ayah_count(2) == 286
    assert ayah_count(55) == 78
    assert ayah_count(67) == 30
    assert ayah_count(108) == 3
    assert ayah_count(114) == 6
