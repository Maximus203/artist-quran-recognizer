"""Pipeline de reconnaissance sur des composants scénarisés (corpus et matcher réels, audio et ASR
factices) : abstention, formules, répétitions, sauts, verset supposé, fenêtres longues, temps."""

from __future__ import annotations

from array import array
from pathlib import Path

import pytest

from aqr.corpus.imlai_corrections import build_word_corrections, load_simple_clean_words
from aqr.corpus.normalize import normalize_arabic
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.domain.models import (
    Detection,
    NonQuranKind,
    NonQuranSpan,
    Riwaya,
    Status,
    TimeSpan,
    VerseRef,
)
from aqr.domain.ports import AudioClip, TranscribedWord, Transcript
from aqr.matching.flow_matcher import FlowVerseMatcher
from aqr.pipeline.pipeline import PipelineConfig, RecognitionPipeline
from aqr.pipeline.result import AbstentionReason, AbstentionSpan, EngineInfo

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"
pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "LOCK.json").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)
RATE = 16000


@pytest.fixture(scope="module")
def corpus() -> TanzilCorpusRepository:
    return TanzilCorpusRepository(CORPUS_DIR)


@pytest.fixture(scope="module")
def matcher(corpus) -> FlowVerseMatcher:
    corrections = build_word_corrections(corpus, load_simple_clean_words(CORPUS_DIR))
    return FlowVerseMatcher(corpus, word_corrections=corrections)


class _Extractor:
    def __init__(self, seconds: float, quiet: list[tuple[float, float]] | None = None) -> None:
        samples = array("f", [0.3] * round(seconds * RATE))
        for a, b in quiet or []:
            for i in range(round(a * RATE), round(b * RATE)):
                samples[i] = 0.0
        self.clip = AudioClip(samples=samples, sample_rate=RATE, source="mem")

    def extract(self, path: Path) -> AudioClip:
        return self.clip


class _Segmenter:
    def __init__(self, spans: list[tuple[float, float]]) -> None:
        self.spans = [TimeSpan(a, b) for a, b in spans]

    def segment(self, clip: AudioClip) -> list[TimeSpan]:
        return self.spans


class _ASR:
    """Rend, pour chaque fenêtre dans l'ordre, le texte scénarisé (« » = aucun mot)."""

    riwaya = Riwaya.HAFS

    def __init__(self, texts: list[str]) -> None:
        self.texts, self.calls = list(texts), 0

    def transcribe(self, clip: AudioClip, span: TimeSpan) -> Transcript:
        text = self.texts[self.calls]
        self.calls += 1
        words = tuple(TranscribedWord(w, span, 0.9) for w in text.split())
        return Transcript(words=words, engine="fake")


def _verse(corpus, surah: int, ayah: int, first: int = 1, last: int | None = None) -> str:
    words = corpus.words(VerseRef(surah, ayah))
    return " ".join(words[first - 1 : last])


def _pipeline(corpus, matcher, texts, spans, seconds=120.0, quiet=None, **kwargs):
    engine = EngineInfo("fake-asr", "fake-segmenter", "flow-matcher", "viterbi-v2")
    pipeline = RecognitionPipeline(
        _Extractor(seconds, quiet),
        _Segmenter(spans),
        _ASR(texts),
        matcher,
        corpus,
        engine,
        config=kwargs.pop("config", None),
        **kwargs,
    )
    return pipeline.run(Path("x.mp3"))


def _verses(result) -> list[Detection]:
    return [i for i in result.intervals if isinstance(i, Detection)]


def test_recitation_continue_chaque_verset_a_son_temps(corpus, matcher):
    texts = [_verse(corpus, 67, a) for a in (1, 2, 3)]
    result = _pipeline(corpus, matcher, texts, [(2.0, 8.0), (9.0, 15.0), (16.0, 22.0)])
    dets = _verses(result)
    assert [d.span.ref for d in dets] == [VerseRef(67, 1), VerseRef(67, 2), VerseRef(67, 3)]
    assert all(d.status is Status.RECOGNIZED for d in dets)
    assert [d.time for d in dets] == [TimeSpan(2, 8), TimeSpan(9, 15), TimeSpan(16, 22)]
    assert result.windows == 3 and set(result.timing) >= {"extract_s", "asr_s", "total_s"}


def test_aucun_horodatage_ne_couvre_les_passages_non_reconnus(corpus, matcher):
    texts = [_verse(corpus, 67, 1), "كتاب بيت رجل علم", _verse(corpus, 67, 3)]
    result = _pipeline(corpus, matcher, texts, [(0.0, 6.0), (7.0, 12.0), (13.0, 19.0)])
    kinds = [(type(i).__name__, i.time) for i in result.intervals if i.time is not None]
    assert kinds[0] == ("Detection", TimeSpan(0, 6))
    assert ("AbstentionSpan", TimeSpan(7, 12)) in kinds
    assert [i.time for i in result.intervals] == sorted(
        (i.time for i in result.intervals if i.time), key=lambda t: t.start_s
    )


def test_arabe_non_coranique_donne_une_abstention_jamais_un_verset(corpus, matcher):  # I4
    result = _pipeline(
        corpus,
        matcher,
        ["من فضلك أعطني كوبا من الماء البارد لو سمحت"],
        [(1.0, 6.0)],
    )
    assert _verses(result) == []
    (abstention,) = [i for i in result.intervals if isinstance(i, AbstentionSpan)]
    assert abstention.reason in (AbstentionReason.NO_CANDIDATE, AbstentionReason.BELOW_THRESHOLD)


def test_texte_francais_transcrit_par_l_asr_arabe_est_une_abstention(corpus, matcher):
    result = _pipeline(corpus, matcher, ["bonjour mes frères et sœurs"], [(0.0, 4.0)])
    (abstention,) = result.intervals
    assert isinstance(abstention, AbstentionSpan)
    assert abstention.reason is AbstentionReason.EMPTY_TRANSCRIPT


def test_fenetre_muette_est_un_silence(corpus, matcher):
    result = _pipeline(corpus, matcher, [""], [(1.0, 4.0)], quiet=[(0.0, 10.0)])
    (abstention,) = result.intervals
    assert isinstance(abstention, AbstentionSpan)
    assert abstention.reason is AbstentionReason.SILENCE


def test_formules_de_priere_sont_non_coraniques(corpus, matcher):
    texts = ["الله أكبر", "أعوذ بالله من الشيطان الرجيم", "آمين"]
    result = _pipeline(corpus, matcher, texts, [(0, 2), (3, 7), (8, 9)])
    assert _verses(result) == []
    labels = [i.kind for i in result.intervals if isinstance(i, NonQuranSpan)]
    assert labels == [NonQuranKind.TAKBIR, NonQuranKind.ISTIADHA, NonQuranKind.AMIN]


def test_basmala_d_ouverture_non_coranique_puis_le_verset(corpus, matcher):
    texts = ["بسم الله الرحمن الرحيم", _verse(corpus, 112, 1, 5)]
    result = _pipeline(corpus, matcher, texts, [(0, 4), (5, 8)])
    assert [type(i).__name__ for i in result.intervals][:1] == ["NonQuranSpan"]
    assert result.intervals[0].kind is NonQuranKind.BASMALA
    assert [d.span.ref for d in _verses(result)] == [VerseRef(112, 1)]


def test_fatiha_la_basmala_est_le_verset_1_1(corpus, matcher):
    texts = [_verse(corpus, 1, 1), _verse(corpus, 1, 2), _verse(corpus, 1, 7)]
    result = _pipeline(corpus, matcher, texts, [(0, 4), (5, 9), (10, 18)])
    assert [d.span.ref for d in _verses(result)] == [VerseRef(1, 1), VerseRef(1, 2), VerseRef(1, 7)]
    assert all(not isinstance(i, NonQuranSpan) for i in result.intervals)


def test_repetition_deux_detections_la_seconde_marquee(corpus, matcher):
    v = _verse(corpus, 112, 1, 5)
    result = _pipeline(corpus, matcher, [v, v], [(0, 4), (6, 10)])
    dets = _verses(result)
    assert [d.is_repetition for d in dets] == [False, True]
    assert [d.time for d in dets] == [TimeSpan(0, 4), TimeSpan(6, 10)]


def test_saut_de_sourate_sans_detection_fantome(corpus, matcher):
    texts = [_verse(corpus, 1, 7), _verse(corpus, 112, 1, 5)]
    result = _pipeline(corpus, matcher, texts, [(0, 8), (9, 13)])
    refs = [d.span.ref for d in _verses(result)]
    assert refs == [VerseRef(1, 7), VerseRef(112, 1)]
    assert all(d.status is Status.RECOGNIZED for d in _verses(result))


def test_verset_manquant_entre_deux_reconnus_reste_infere(corpus, matcher):  # P6
    texts = [_verse(corpus, 67, 4), "كتاب بيت رجل علم", _verse(corpus, 67, 6)]
    result = _pipeline(corpus, matcher, texts, [(0, 6), (7, 12), (13, 19)])
    dets = _verses(result)
    assert [(d.span.ref, d.status) for d in dets] == [
        (VerseRef(67, 4), Status.RECOGNIZED),
        (VerseRef(67, 5), Status.INFERRED),
        (VerseRef(67, 6), Status.RECOGNIZED),
    ]
    inferred = dets[1]
    assert inferred.time_interpolated and inferred.time == TimeSpan(6, 13)


def test_pas_de_verset_infere_sans_le_verset_suivant(corpus, matcher):
    result = _pipeline(
        corpus, matcher, [_verse(corpus, 67, 4), "كتاب بيت رجل علم"], [(0, 6), (7, 12)]
    )
    assert [d.span.ref for d in _verses(result)] == [VerseRef(67, 4)]


def test_segment_long_coupe_en_fenetres_puis_verset_refusionne(corpus, matcher):
    words = corpus.words(VerseRef(2, 255))
    third = len(words) // 3
    texts = [
        " ".join(words[:third]),
        " ".join(words[third : 2 * third]),
        " ".join(words[2 * third :]),
    ]
    config = PipelineConfig(max_window_s=25.0)
    result = _pipeline(corpus, matcher, texts, [(0.0, 60.0)], config=config)
    assert result.windows == 3
    (det,) = _verses(result)
    assert det.span.ref == VerseRef(2, 255)
    assert (det.span.first_word, det.span.last_word) == (1, len(words))
    assert det.time == TimeSpan(0.0, 60.0)


def test_candidat_ambigu_est_incertain_avec_ses_candidats(corpus, matcher):
    result = _pipeline(corpus, matcher, ["الله لا إله إلا هو الحي القيوم"], [(0, 6)])
    (det,) = _verses(result)
    assert det.status is Status.UNCERTAIN
    assert {VerseRef(2, 255), VerseRef(3, 2)} <= set(det.candidates)


def test_verificateur_acoustique_peut_ecarter_un_candidat(corpus, matcher):
    calls: list[int] = []

    def verifier(clip, window, candidates):
        calls.append(len(candidates))
        return []  # l'audio ne soutient aucun candidat

    result = _pipeline(corpus, matcher, [_verse(corpus, 67, 1)], [(0, 6)], verifier=verifier)
    assert calls and _verses(result) == []
    (abstention,) = result.intervals
    assert isinstance(abstention, AbstentionSpan)
    assert abstention.reason is AbstentionReason.NO_CANDIDATE


def test_horloge_injectee_donne_des_durees_deterministes(corpus, matcher):
    ticks = iter(float(i) for i in range(100))
    result = _pipeline(
        corpus, matcher, [_verse(corpus, 112, 1, 5)], [(0, 4)], clock=lambda: next(ticks)
    )
    assert result.timing["total_s"] > 0
    assert normalize_arabic("x") == ""  # garde : la normalisation ignore le latin


def test_verset_de_deux_mots_isole_est_une_abstention_pas_un_verset(corpus, matcher):  # I3
    # 112:2 « الله الصمد » : deux mots ne suffisent pas à nommer un verset sans ambiguïté.
    result = _pipeline(corpus, matcher, [_verse(corpus, 112, 2)], [(0, 3)])
    assert _verses(result) == []
    (abstention,) = result.intervals
    assert isinstance(abstention, AbstentionSpan)
    assert abstention.reason is AbstentionReason.BELOW_THRESHOLD
