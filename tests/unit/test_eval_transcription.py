"""WER/CER d'une transcription ASR contre le texte du corpus : deux variantes nommées."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from aqr.corpus.checksums import CorpusChecksumError
from aqr.corpus.imlai_corrections import build_word_corrections, load_simple_clean_words
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.data.manifest import ExpectedItem, WordRange
from aqr.domain.models import Status, VerseRef
from aqr.eval.transcription import (
    NORMALIZATION_VERSION,
    VARIANTS,
    TranscriptError,
    TranscriptScore,
    edit_distance,
    load_transcript,
    normalization_fingerprint,
    parse_transcript,
    reference_words,
    score_transcript,
    sum_scores,
)

# Mots Uthmani de 1:4 et 112:1-2 (corpus Tanzil), figés ici pour des tests sans corpus.
WORDS = {
    VerseRef(1, 4): ("مَٰلِكِ", "يَوْمِ", "ٱلدِّينِ"),
    VerseRef(112, 1): ("قُلْ", "هُوَ", "ٱللَّهُ", "أَحَدٌ"),
    VerseRef(112, 2): ("ٱللَّهُ", "ٱلصَّمَدُ"),
}
CORRECTIONS = {"ملك": "مالك"}  # Uthmani normalisé -> imla'i normalisé (réel : 1:4)


class _Corpus:
    def words(self, ref: VerseRef) -> tuple[str, ...]:
        return WORDS[ref]


def _exp(ref: str, words: str = "all") -> ExpectedItem:
    return ExpectedItem((0.0, 1.0), VerseRef.parse(ref), WordRange.parse(words), Status.RECOGNIZED)


def test_edit_distance_sur_sequences():
    assert edit_distance(["a", "b", "c"], ["a", "b", "c"]) == 0
    assert edit_distance(["a", "b", "c"], ["a", "c"]) == 1  # suppression
    assert edit_distance(["a"], ["a", "b"]) == 1  # insertion
    assert edit_distance(list("kitten"), list("sitting")) == 3
    assert edit_distance([], ["a", "b"]) == 2 and edit_distance(["a"], []) == 1
    assert edit_distance("ab", "ba") == 2  # fonctionne aussi sur des chaînes (lettres)


def test_reference_words_ordonne_par_temps_et_respecte_les_plages():
    items = [
        ExpectedItem((5.0, 6.0), VerseRef(112, 2), WordRange.all(), Status.RECOGNIZED),
        ExpectedItem((0.0, 2.0), VerseRef(112, 1), WordRange.parse("2-3"), Status.RECOGNIZED),
    ]
    words = reference_words(items, _Corpus())
    assert words == ("هُوَ", "ٱللَّهُ", "ٱللَّهُ", "ٱلصَّمَدُ")


def test_reference_words_vide_refuse():
    with pytest.raises(ValueError, match="aucun verset"):
        reference_words([], _Corpus())


def test_transcription_exacte_vaut_zero_dans_les_deux_variantes():
    ref = reference_words([_exp("112:1")], _Corpus())
    for variant in VARIANTS:
        score = score_transcript(ref, "قُلْ هُوَ اللَّهُ أَحَدٌ", CORRECTIONS, variant)
        assert score.word_errors == 0 and score.letter_errors == 0
        assert score.word_total == 4 and score.letter_total > 0


def test_variantes_se_distinguent_sur_la_graphie_imlai():
    ref = reference_words([_exp("1:4")], _Corpus())
    hyp = "مالك يوم الدين"  # graphie imla'i, ce que produit un ASR
    tolerante = score_transcript(ref, hyp, CORRECTIONS, "tolerante")
    strict = score_transcript(ref, hyp, CORRECTIONS, "strict-lettres")
    assert tolerante.word_errors == 0 and tolerante.letter_errors == 0
    assert strict.word_errors == 1  # « ملك » ≠ « مالك » sans dictionnaire
    assert strict.letter_errors == 1  # un alef de plus
    assert strict.word_total == tolerante.word_total == 3


def test_tolerante_ignore_les_espaces_pour_le_cer_pas_strict():
    ref = reference_words([_exp("112:2")], _Corpus())
    hyp = "الله الصمد"
    glued = "اللهالصمد"
    assert score_transcript(ref, glued, CORRECTIONS, "tolerante").letter_errors == 0
    assert score_transcript(ref, glued, CORRECTIONS, "strict-lettres").letter_errors == 1
    # le WER, lui, voit un mot de moins et une substitution
    assert score_transcript(ref, glued, CORRECTIONS, "tolerante").word_errors == 2
    assert score_transcript(ref, hyp, CORRECTIONS, "tolerante").word_errors == 0


def test_erreurs_comptees_et_taux():
    ref = reference_words([_exp("112:1")], _Corpus())
    score = score_transcript(ref, "قل هو الله", CORRECTIONS, "tolerante")  # « أحد » omis
    assert score.word_errors == 1 and score.word_total == 4
    assert score.wer == pytest.approx(0.25)
    assert score.letter_errors == 3 and score.cer == pytest.approx(3 / score.letter_total)


def test_transcription_vide_est_un_wer_de_un_et_pas_une_erreur():
    ref = reference_words([_exp("112:2")], _Corpus())
    score = score_transcript(ref, "", CORRECTIONS, "strict-lettres")
    assert score.word_errors == score.word_total == 2
    assert score.wer == 1.0 and score.cer == 1.0


def test_hors_arabe_ignore_comme_la_normalisation():
    ref = reference_words([_exp("112:2")], _Corpus())
    assert score_transcript(ref, "الله، الصمد 123 abc", CORRECTIONS, "tolerante").word_errors == 0


def test_variante_inconnue_refusee():
    with pytest.raises(ValueError, match="variante"):
        score_transcript(("قل",), "قل", CORRECTIONS, "laxiste")


def test_somme_des_scores_pas_moyenne_de_taux():
    a = TranscriptScore(word_errors=1, word_total=2, letter_errors=1, letter_total=10)
    b = TranscriptScore(word_errors=0, word_total=8, letter_errors=0, letter_total=40)
    total = sum_scores([a, b])
    assert total.word_total == 10 and total.wer == pytest.approx(0.1)  # et non (0.5 + 0) / 2
    assert sum_scores([]) == TranscriptScore(0, 0, 0, 0) and sum_scores([]).wer is None


def test_empreinte_de_normalisation_stable_et_sensible_au_dictionnaire():
    assert NORMALIZATION_VERSION.startswith("aqr.normalize/")
    assert normalization_fingerprint(CORRECTIONS) == normalization_fingerprint(dict(CORRECTIONS))
    assert normalization_fingerprint(CORRECTIONS) != normalization_fingerprint({})


def test_lecture_du_fichier_de_transcription(tmp_path: Path):
    good = {
        "schema": "aqr.transcript/1",
        "source": {"sha256": "a" * 64},
        "engine": {"asr": "x"},
        "text": "قل هو الله أحد",
        "run": {"peak_rss_mb": 812.5},
    }
    path = tmp_path / "t.json"
    path.write_text(json.dumps(good), encoding="utf-8")
    loaded = load_transcript(path)
    assert loaded.text == good["text"] and loaded.sha256 == "a" * 64
    assert loaded.peak_rss_mb == 812.5 and loaded.engine == {"asr": "x"}
    assert parse_transcript({**good, "run": {}}).peak_rss_mb is None


@pytest.mark.parametrize(
    "mutation",
    [
        {"schema": "autre/1"},
        {"text": 12},
        {"source": {}},
        {"run": {"peak_rss_mb": "beaucoup"}},
    ],
)
def test_transcription_hors_schema_refusee(mutation):
    good = {"schema": "aqr.transcript/1", "source": {"sha256": "a" * 64}, "text": "قل"}
    with pytest.raises(TranscriptError):
        parse_transcript({**good, **mutation})


def test_transcription_illisible_refusee(tmp_path: Path):
    path = tmp_path / "t.json"
    path.write_text("pas du json", encoding="utf-8")
    with pytest.raises(TranscriptError):
        load_transcript(path)
    with pytest.raises(TranscriptError):
        load_transcript(tmp_path / "absent.json")


# --- avec le corpus réel (sauté s'il n'est pas téléchargé) -----------------------------------

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"


def test_corpus_reel_une_transcription_imlai_coute_moins_en_tolerante_qu_en_strict():
    try:
        corpus = TanzilCorpusRepository(CORPUS_DIR)
    except (CorpusChecksumError, OSError):
        pytest.skip("corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord")
    simple = load_simple_clean_words(CORPUS_DIR)
    corrections = build_word_corrections(corpus, simple)
    ref = reference_words([_exp("2:29")], corpus)
    hypothesis = " ".join(simple[VerseRef(2, 29)])  # ce que produirait un ASR parfait en imla'i
    tolerante = score_transcript(ref, hypothesis, corrections, "tolerante")
    strict = score_transcript(ref, hypothesis, corrections, "strict-lettres")
    assert tolerante.word_errors == 0
    assert strict.word_errors > tolerante.word_errors  # سموت vs سماوات…
