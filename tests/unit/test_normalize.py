import pytest

from aqr.corpus.normalize import normalize_arabic, tokenize

BASMALA_UTHMANI = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ"
BASMALA_SIMPLE = "بسم الله الرحمن الرحيم"


def test_uthmani_et_simple_se_rejoignent():  # P2
    assert normalize_arabic(BASMALA_UTHMANI) == normalize_arabic(BASMALA_SIMPLE)


def test_idempotence():
    once = normalize_arabic(BASMALA_UTHMANI)
    assert normalize_arabic(once) == once


@pytest.mark.parametrize(
    "a,b",
    [
        ("أحد", "احد"),
        ("إياك", "اياك"),
        ("آمنوا", "امنوا"),
        ("هدى", "هدي"),
        ("الجنة", "الجنه"),
        ("مؤمن", "مومن"),
        ("الـلـه", "الله"),  # tatweel
    ],
)
def test_variantes_orthographiques(a, b):
    assert normalize_arabic(a) == normalize_arabic(b)


def test_ponctuation_chiffres_et_marque_de_fin_de_verset_supprimes():
    assert normalize_arabic("ٱلْحَمْدُ لِلَّهِ ۝ ٢ ، (abc)") == "الحمد لله"


def test_texte_francais_devient_vide():  # préalable à F4
    assert normalize_arabic("Au nom de Dieu") == ""
    assert tokenize("Au nom de Dieu") == []


def test_tokenize():
    assert tokenize(BASMALA_UTHMANI) == ["بسم", "الله", "الرحمن", "الرحيم"]
