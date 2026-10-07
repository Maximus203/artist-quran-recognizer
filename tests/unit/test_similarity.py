from aqr.matching.similarity import word_similarity


def test_identiques():
    assert word_similarity("الله", "الله", 0.7) == 1.0


def test_mots_courts_exigent_l_identite():
    assert word_similarity("من", "مع", 0.7) == 0.0


def test_une_lettre_sur_un_mot_long_reste_proche():
    assert word_similarity("استغفروا", "استغفرو", 0.7) > 0.8


def test_trop_different():
    assert word_similarity("كتاب", "بيت", 0.7) == 0.0
