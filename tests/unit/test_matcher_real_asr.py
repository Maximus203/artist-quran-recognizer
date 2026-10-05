"""Le matcher face à la sortie RÉELLE du FastConformer (échantillon EveryAyah capturé par
`scripts/capture_asr_samples.py`), pas face au texte du corpus : voyelles parfois absentes,
dernier mot parfois tronqué, mots inventés (phase 4, point 4). Nécessite le corpus."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from aqr.corpus.imlai_corrections import build_word_corrections, load_simple_clean_words
from aqr.corpus.normalize import normalize_arabic
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.decoding.viterbi_decoder import DecoderConfig
from aqr.domain.models import VerseRef
from aqr.matching.flow_matcher import FlowVerseMatcher

ROOT = Path(__file__).resolve().parents[2]
CORPUS_DIR = ROOT / "data" / "corpus"
FIXTURES = ROOT / "tests" / "fixtures" / "asr"
# moteur -> (top-1 minimal sur l'échantillon, toutes les sorties vocalisées ?)
ENGINES = {"fastconformer": (0.93, False), "whisper": (0.97, True)}

pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "LOCK.json").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)


@pytest.fixture(scope="module")
def corpus() -> TanzilCorpusRepository:
    return TanzilCorpusRepository(CORPUS_DIR)


@pytest.fixture(scope="module")
def matcher(corpus) -> FlowVerseMatcher:
    simple = load_simple_clean_words(CORPUS_DIR)
    return FlowVerseMatcher(corpus, word_corrections=build_word_corrections(corpus, simple))


@pytest.fixture(scope="module", params=sorted(ENGINES))
def engine(request) -> str:
    return request.param


@pytest.fixture(scope="module")
def samples(engine) -> list[dict]:
    path = FIXTURES / f"{engine}_everyayah.json"
    return json.loads(path.read_text(encoding="utf-8"))["samples"]


def _is_right(corpus, sample, candidates) -> bool:
    ref = VerseRef.parse(sample["ref"])
    return bool(
        candidates
        and (ref in candidates[0].refs or corpus.text(candidates[0].refs[0]) == corpus.text(ref))
    )


def test_echantillon_representatif(engine, samples):
    assert len(samples) >= 60
    assert {s["reciter"] for s in samples} >= {"Alafasy_128kbps", "Husary_128kbps"}
    assert all(
        s["engine"].startswith(f"{'whisper-base' if engine == 'whisper' else 'fastconformer'}")
        for s in samples
    )


def test_format_reel_des_voyelles(engine, samples):
    # Contrat observé : FastConformer = voyelles dans la majorité des sorties mais pas toutes ;
    # Whisper-Tarteel = toujours entièrement vocalisé.
    ratio = sum(1 for s in samples if s["has_vowels"]) / len(samples)
    assert ratio == 1.0 if ENGINES[engine][1] else 0.5 < ratio < 1.0


def test_la_normalisation_absorbe_les_voyelles_du_modele(samples):
    for s in samples:
        normalized = normalize_arabic(s["raw_text"])
        assert normalize_arabic(normalized) == normalized  # idempotente
        assert not any(ch in normalized for ch in "ًٌٍَُِّْ")


def test_top1_sur_sortie_reelle(engine, corpus, matcher, samples):
    right = sum(
        _is_right(corpus, s, matcher.match(normalize_arabic(s["raw_text"]), top_k=3))
        for s in samples
    )
    assert right / len(samples) >= ENGINES[engine][0], f"top-1 réel : {right / len(samples):.1%}"


def test_aucun_faux_verset_nomme_sur_sortie_reelle(corpus, matcher, samples):
    """I3 : sur ~80 sorties réelles (dont des mots tronqués ou inventés), le décodeur ne doit
    jamais nommer un autre verset au-dessus de son seuil."""
    config = DecoderConfig()
    for s in samples:
        candidates = matcher.match(normalize_arabic(s["raw_text"]), top_k=3)
        if candidates and candidates[0].score >= config.min_recognized_score:
            assert _is_right(corpus, s, candidates), (s["ref"], s["raw_text"], candidates[0])


def test_sortie_vide_ne_donne_aucun_candidat(matcher, samples):
    empty = [s for s in samples if not normalize_arabic(s["raw_text"])]
    for s in empty:
        assert matcher.match(normalize_arabic(s["raw_text"])) == []


@pytest.mark.parametrize(
    ("raw", "ref"),
    [
        ("قُلْ هُوَ اللَّهُ أَحَدٌ", "112:1"),  # voyelles, relevé réel
        ("الصمد", "112:2"),  # sans voyelles, relevé réel
        ("لَمْ يَلِدْ وَلَمْ يُولَدْ", "112:3"),
        ("قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ", "113:1"),
    ],
)
def test_exemples_releves_sur_le_modele(corpus, matcher, raw, ref):
    candidates = matcher.match(normalize_arabic(raw), top_k=3)
    target = VerseRef.parse(ref)
    assert candidates and (
        target in candidates[0].refs or corpus.text(candidates[0].refs[0]) == corpus.text(target)
    )
