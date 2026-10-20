"""Recherche sur le flux continu (phase 2b, ADR-0004) : fenêtres partielles, requêtes à
cheval sur plusieurs versets, verset 1 sans basmala, ambiguïté, rejet du non-Coran.

Les exemples viennent de la revue externe de la phase 2. Corpus réel requis : sauté
si `python scripts/fetch_corpus.py` n'a pas été lancé.
"""

from __future__ import annotations

import random
from pathlib import Path

import pytest

from aqr.corpus.imlai_corrections import build_word_corrections, load_simple_clean_words
from aqr.corpus.normalize import normalize_arabic
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.decoding.viterbi_decoder import DecoderConfig
from aqr.domain.models import VerseRef
from aqr.matching.flow_matcher import FlowVerseMatcher
from aqr.matching.noise import inject_letter_noise
from aqr.matching.segment_bench import build_flow, evaluate, sample_windows, verse_one_cases

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"

pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "LOCK.json").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)

_DECODER = DecoderConfig()  # seuil + ratio d'incertitude du décodeur B7
_SEED = 7


@pytest.fixture(scope="module")
def corpus() -> TanzilCorpusRepository:
    return TanzilCorpusRepository(CORPUS_DIR)


@pytest.fixture(scope="module")
def simple_clean_words():
    return load_simple_clean_words(CORPUS_DIR)


@pytest.fixture(scope="module")
def matcher(corpus, simple_clean_words) -> FlowVerseMatcher:
    corrections = build_word_corrections(corpus, simple_clean_words)
    return FlowVerseMatcher(corpus, word_corrections=corrections)


def _q(text: str) -> str:
    return normalize_arabic(text)


# --- Exemples de la revue externe -----------------------------------------
def test_debut_de_2_255_nest_plus_pris_pour_3_2(matcher):
    candidates = matcher.match(_q("الله لا إله إلا هو الحي القيوم لا تأخذه سنة ولا نوم"))
    assert candidates[0].span.ref == VerseRef(2, 255)
    assert candidates[0].score >= _DECODER.min_recognized_score
    assert (candidates[0].span.first_word, candidates[0].span.last_word) == (1, 12)


def test_67_1_sans_basmala_est_reconnu(matcher):
    candidates = matcher.match(_q("تبارك الذي بيده الملك وهو على كل شي قدير"))
    best = candidates[0]
    assert best.refs == (VerseRef(67, 1),)
    assert best.score >= _DECODER.min_recognized_score
    assert best.span.first_word == 5  # les 4 mots de basmala de Tanzil ne sont pas récités


def test_67_1_avec_basmala_couvre_tout_le_verset(matcher):
    candidates = matcher.match(
        _q("بسم الله الرحمن الرحيم تبارك الذي بيده الملك وهو على كل شي قدير")
    )
    best = candidates[0]
    assert best.refs == (VerseRef(67, 1),)
    assert best.span.first_word == 1
    assert best.score >= 0.9  # « شي » sans hamza : un mot erroné sur 13


def test_deux_versets_d_un_souffle_forment_un_seul_candidat(matcher):  # 112:1-2
    candidates = matcher.match(_q("قل هو الله أحد الله الصمد"))
    best = candidates[0]
    assert best.refs == (VerseRef(112, 1), VerseRef(112, 2))
    assert best.score >= 0.9
    assert best.span.first_word == 5  # sans la basmala
    assert sum(best.query_counts) == 6


def test_formule_repetee_renvoie_toutes_les_positions(matcher):
    candidates = matcher.match(_q("الله لا إله إلا هو الحي القيوم"))
    top = {c.span.ref: c.score for c in candidates[:3]}
    assert VerseRef(2, 255) in top and VerseRef(3, 2) in top
    assert abs(top[VerseRef(2, 255)] - top[VerseRef(3, 2)]) < 0.05


def test_un_mot_isole_ne_passe_jamais_le_seuil(matcher):  # F5
    for word in ("الحيوان", "مدهامتان", "قيوم"):
        assert all(c.score < _DECODER.min_recognized_score for c in matcher.match(word))


def test_arabe_non_coranique_reste_bas(matcher):  # I4
    for text in (
        "من فضلك أعطني كوبا من الماء البارد لو سمحت",
        "قال رسول الله صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ ما نوى",
        "التحيات لله والصلوات والطيبات السلام عليك أيها النبي ورحمة الله وبركاته",
    ):
        assert all(c.score < 0.5 for c in matcher.match(_q(text))), text


def test_basmala_seule_ne_nomme_que_1_1(matcher):
    candidates = matcher.match(_q("بسم الله الرحمن الرحيم"))
    assert candidates[0].refs == (VerseRef(1, 1),)


def test_le_texte_rendu_ne_vient_pas_du_matcher(matcher, corpus):  # I1
    best = matcher.match(_q("قل هو الله أحد الله الصمد"))[0]
    for span in best.spans:  # des références seulement : le texte se lit dans le corpus
        assert 1 <= span.first_word <= span.last_word <= len(corpus.words(span.ref))


# --- Bancs sur segments réalistes ------------------------------------------
def _windows(simple_clean_words, lo, hi, n=300):
    flow = build_flow(simple_clean_words)
    return sample_windows(flow, n, lo, hi, random.Random(_SEED), f"{lo}-{hi}")


@pytest.mark.parametrize("lo,hi", [(7, 12), (13, 25)])
def test_aucun_faux_verset_au_dessus_du_seuil_fenetres_longues(matcher, simple_clean_words, lo, hi):
    metrics = evaluate(
        matcher,
        _windows(simple_clean_words, lo, hi),
        _DECODER.min_recognized_score,
        _DECODER.uncertainty_ratio,
    )
    assert metrics.false_named == 0, metrics


def test_top1_fenetres_7_12_mots(matcher, simple_clean_words):
    metrics = evaluate(
        matcher,
        _windows(simple_clean_words, 7, 12),
        _DECODER.min_recognized_score,
        _DECODER.uncertainty_ratio,
    )
    assert metrics.top1_correct / metrics.n >= 0.97, metrics


def test_fenetres_courtes_ne_nomment_pas_de_faux_verset(matcher, simple_clean_words):
    metrics = evaluate(
        matcher,
        _windows(simple_clean_words, 3, 6, n=600),
        _DECODER.min_recognized_score,
        _DECODER.uncertainty_ratio,
    )
    assert metrics.false_named == 0, metrics


def test_verset_1_sans_basmala(matcher, simple_clean_words):
    cases = verse_one_cases(simple_clean_words)
    metrics = evaluate(matcher, cases, _DECODER.min_recognized_score, _DECODER.uncertainty_ratio)
    assert metrics.top1_correct / metrics.n >= 0.95, metrics
    assert metrics.false_named == 0, metrics


def test_fenetres_longues_avec_bruit_lettre_aucun_faux_verset(matcher, simple_clean_words):
    metrics = evaluate(
        matcher,
        _windows(simple_clean_words, 7, 25),
        _DECODER.min_recognized_score,
        _DECODER.uncertainty_ratio,
        transform=lambda tokens, r: inject_letter_noise(tokens, r, every_n_words=5),
        rng=random.Random(_SEED),
    )
    assert metrics.false_named == 0, metrics


def test_performance_fenetre_de_25_mots(matcher, simple_clean_words):
    import time

    cases = _windows(simple_clean_words, 25, 25, n=50)
    matcher.match(cases[0].query)  # échauffement
    started = time.perf_counter()
    for case in cases:
        matcher.match(case.query)
    assert (time.perf_counter() - started) / len(cases) * 1000 < 50


def test_qualite_et_mots_expliques_avant_le_plafond_de_preuve(matcher):
    """Fragment exact de 2 mots (55:2) : score plafonné à 2/5, qualité pleine, 2 mots expliqués —
    ce que la preuve cumulée par la suite (aqr.decoding.chains) exploite."""
    [top, *_rest] = matcher.match(_q("عَلَّمَ الْقُرْآنَ"), top_k=3)
    assert str(top.span.ref) == "55:2"
    assert top.score == pytest.approx(0.4)
    assert top.quality == pytest.approx(1.0)
    assert top.explained == pytest.approx(2.0)


def test_les_sosies_exacts_ne_sont_jamais_coupes_par_top_k(matcher):
    """Lot 2 (2026-10-20) : « ويقولون متى هذا الوعد إن كنتم صادقين » est le texte exact de 6
    versets ; avec top_k = 5 dans l'ordre du Mushaf, 67:25 sortait de la liste et le décodeur,
    encadré par 67:24 et 67:26, ne pouvait répondre que 10:48 « incertain ». Une égalité de score
    n'est jamais coupée."""
    found = matcher.match(_q("وَيَقُولُونَ مَتَىٰ هَٰذَا الْوَعْدُ إِنْ كُنْتُمْ صَادِقِينَ"), top_k=5)
    refs = {str(c.span.ref) for c in found}
    assert "67:25" in refs and "10:48" in refs
    assert len(found) >= 6


def test_le_refrain_d_ar_rahman_garde_ses_31_occurrences(matcher):
    found = matcher.match(_q("فَبِأَيِّ آلَاءِ رَبِّكُمَا تُكَذِّبَانِ"), top_k=5)
    assert {c.span.ref.surah for c in found} == {55}
    assert len(found) == 31
