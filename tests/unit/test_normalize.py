import inspect
import unicodedata

import pytest

from aqr.corpus.normalize import (
    NORMALIZATION_VERSION,
    STRICT_NORMALIZATION_VERSION,
    normalize_arabic,
    normalize_strict_letters,
    tokenize,
    tokenize_strict_letters,
)

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


# --- variante `strict-lettres` (docs/evaluation/normalisation.md §3) ------------------------
# Pas de repli de lettres, sauf ٱ -> ا. Fonction DISTINCTE : normalize_arabic garde son contrat.

REPLIS_INTERDITS = [
    ("أ", "ا"),
    ("إ", "ا"),
    ("آ", "ا"),
    ("ة", "ه"),
    ("ى", "ي"),
    ("ؤ", "و"),
    ("ئ", "ي"),
    ("أحد", "احد"),
    ("إياك", "اياك"),
    ("آمنوا", "امنوا"),
    ("الجنة", "الجنه"),
    ("هدى", "هدي"),
    ("مؤمن", "مومن"),
]


@pytest.mark.parametrize("a,b", REPLIS_INTERDITS)
def test_strict_ne_replie_aucune_lettre_la_tolerante_oui(a, b):
    assert normalize_arabic(a) == normalize_arabic(b)  # contrat de normalize_arabic inchangé
    assert normalize_strict_letters(a) != normalize_strict_letters(b)


def test_strict_conserve_chaque_lettre_repliee_par_la_tolerante():
    assert normalize_strict_letters("أإآةىؤئ") == "أإآةىؤئ"
    assert normalize_arabic("أإآةىؤئ") == "اااهيوي"


def test_strict_alef_wasla_vaut_alef_seul_repli_permis():
    assert normalize_strict_letters("ٱللَّهِ") == "الله" == normalize_strict_letters("الله")
    assert normalize_strict_letters("ٱ") == "ا"
    # le repli précède le filtre non arabe : U+0671 est hors des plages conservées
    assert normalize_strict_letters("ٱلرَّحْمَٰنِ") == "الرحمن"


def test_strict_conserve_le_hamza_isole_et_il_differe_de_l_alef():
    assert normalize_strict_letters("ءَ") == "ء"
    assert normalize_strict_letters("ء") != normalize_strict_letters("ا")
    assert normalize_strict_letters("ءامن") != normalize_strict_letters("امن")


def test_strict_nfc_compose_hamza_et_madda_combinants_avant_la_suppression_des_signes():
    for combining, composed in (("\u0654", "أ"), ("\u0655", "إ"), ("\u0653", "آ")):
        decomposed = "ا" + combining
        assert unicodedata.normalize("NFC", decomposed) == composed
        assert normalize_strict_letters(decomposed) == composed  # et non « ا »
        assert normalize_arabic(decomposed) == "ا"
    assert normalize_strict_letters("و\u0654") == "ؤ"
    assert normalize_strict_letters("ي\u0654") == "ئ"


def test_strict_supprime_harakat_et_tatweel():
    assert normalize_strict_letters("الـلـه") == "الله"
    assert normalize_strict_letters("ٱلرَّحْمَٰنِ") == "الرحمن"
    assert normalize_strict_letters("مَٰلِكِ") == "ملك"  # alef suscrit supprimé, pas converti


def test_strict_ponctuation_chiffres_marque_de_verset_et_latin_deviennent_espaces():
    assert normalize_strict_letters("ٱلْحَمْدُ لِلَّهِ ۝ ٢ ، (abc)") == "الحمد لله"
    assert normalize_strict_letters("١٢ abc") == ""
    assert normalize_strict_letters("كلمة،كلمة") == "كلمة كلمة"  # remplacé par un espace


@pytest.mark.parametrize(
    "text",
    [BASMALA_UTHMANI, "أإآةىؤئءٱ", "ءَامَنَ ٱلرَّسُولُ", "ٱلْحَمْدُ لِلَّهِ ۝ ٢ ، (abc)", "Au nom", ""],
)
def test_strict_idempotence(text):
    once = normalize_strict_letters(text)
    assert normalize_strict_letters(once) == once


def test_strict_texte_francais_devient_vide():
    assert normalize_strict_letters("Au nom de Dieu") == ""
    assert tokenize_strict_letters("Au nom de Dieu") == []


def test_strict_tokenize():
    assert tokenize_strict_letters(BASMALA_UTHMANI) == ["بسم", "الله", "الرحمن", "الرحيم"]
    assert tokenize_strict_letters("أحد  إياك") == ["أحد", "إياك"]
    assert tokenize(BASMALA_UTHMANI) == tokenize_strict_letters(BASMALA_UTHMANI)  # sans repli utile


def test_normalize_arabic_reste_sans_drapeau_et_sa_version_ne_bouge_pas():
    # la variante stricte est une fonction distincte, jamais un paramètre caché (spec §3)
    assert list(inspect.signature(normalize_arabic).parameters) == ["text"]
    assert NORMALIZATION_VERSION == "aqr.normalize/1"


def test_versions_distinctes_de_la_normalisation_stricte():
    assert STRICT_NORMALIZATION_VERSION.startswith("aqr.normalize-strict/")
    assert STRICT_NORMALIZATION_VERSION != NORMALIZATION_VERSION
