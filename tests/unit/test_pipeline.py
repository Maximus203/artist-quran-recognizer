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


# --- Étape B : preuve cumulée par la suite (cas réel du 2026-10-19, voix de Cherif au micro) -----
MICRO_55 = [
    ("بسم الله الرحمن الرحيم", (1.3, 5.2)),
    ("الرَّحْمَنُ", (5.6, 7.5)),
    ("عَلَّمَ الْقُرْآنَ", (7.7, 10.4)),
    ("خَلَقَ الْإِنْسَانَ", (10.6, 13.3)),
    ("عَلَّمَهُ الْبَيَانَ", (13.6, 16.5)),
]


def _micro(corpus, matcher, **kwargs):
    texts = [t for t, _ in MICRO_55]
    spans = [s for _, s in MICRO_55]
    return _pipeline(corpus, matcher, texts, spans, seconds=17.0, **kwargs)


def test_versets_courts_consecutifs_au_micro_sont_reconnus(corpus, matcher):
    result = _micro(corpus, matcher)
    assert [(d.span.ref, d.status) for d in _verses(result)] == [
        (VerseRef(55, n), Status.RECOGNIZED) for n in (1, 2, 3, 4)
    ]
    assert result.decoder_config["chain_evidence_words"] == 5.0


def test_sans_la_preuve_par_la_suite_les_memes_fenetres_restent_des_abstentions(corpus, matcher):
    from aqr.decoding.chains import ChainConfig

    result = _micro(corpus, matcher, config=PipelineConfig(chain=ChainConfig(enabled=False)))
    assert _verses(result) == []


def test_un_fragment_court_isole_reste_une_abstention(corpus, matcher):
    result = _pipeline(corpus, matcher, ["خَلَقَ الْإِنْسَانَ"], [(2.0, 4.0)], seconds=10.0)
    assert _verses(result) == []
    assert any(
        isinstance(i, AbstentionSpan) and i.reason is AbstentionReason.BELOW_THRESHOLD
        for i in result.intervals
    )


# --- Étape B, brique 2 : vérification acoustique des suites et temps au mot (ADR-0008) ---------
# Cas réel (2026-10-19, Muno au micro) : « عَلَّمَ » amputé en « لَّمَ » au début de sa fenêtre.
MICRO_55_MUNO = [
    ("بسم الله الرحمن الرحيم", (0.8, 4.4)),
    ("الرَّحْمَنُ", (4.7, 6.5)),
    ("لَّمَ الْقُرْآنَ", (6.7, 9.4)),
    ("خَلَقَ الْإِنسَان", (9.6, 12.2)),
    ("عَلَّمَهُ الْبَيَانَ", (12.4, 15.5)),
]


class _HeardModel:
    """Modèle CTC factice : « entend » des mots imla'i (un symbole par mot, 3 trames chacun) à des
    instants donnés, du blanc ailleurs."""

    engine = "fake-ctc@test"
    frame_s = 0.08
    vocab = 512

    def __init__(self, heard: list[tuple[float, str]]) -> None:
        self.ids: dict[str, int] = {}
        self.heard = [(t, self.encode(w)[0]) for t, w in heard]

    def encode(self, text: str) -> tuple[int, ...]:
        return (self.ids.setdefault(text, len(self.ids) + 1),)

    def lattice(self, clip, span):
        import math

        from aqr.domain.ports import CtcLattice

        frames = [0] * round(span.duration_s / self.frame_s)
        for time, symbol in self.heard:
            first = round((time - span.start_s) / self.frame_s)
            for f in range(max(first, 0), min(first + 3, len(frames))):
                frames[f] = symbol
        rest = math.log(0.03 / (self.vocab - 1))
        rows = []
        for s in frames:
            row = [rest] * self.vocab
            row[s] = math.log(0.97)
            rows.append(row)
        return CtcLattice(log_probs=rows, blank=0, start_s=span.start_s, frame_s=self.frame_s)


@pytest.fixture(scope="module")
def alignment_texts(corpus):
    from aqr.corpus.alignment_text import AlignmentTexts

    return AlignmentTexts.from_corpus_dir(CORPUS_DIR, corpus)


def _heard(alignment_texts, *said: tuple[float, str]) -> list[tuple[float, str]]:
    """Mots imla'i (avec voyelles) de chaque plage « 55:2[1-2] » dite à partir de l'instant donné,
    un mot toutes les 0,6 s."""
    from aqr.alignment.service import parse_verse_spec
    from aqr.corpus.alignment_text import AlignmentVariant

    out: list[tuple[float, str]] = []
    for start, spec in said:
        (span,) = parse_verse_spec(spec, alignment_texts.word_count)
        for n, word in enumerate(alignment_texts.words(span, AlignmentVariant.VOCALIZED)):
            out.append((start + 0.6 * n, word.text))
    return out


def _acoustic(corpus, alignment_texts, heard, **check):
    from aqr.alignment.forced import AlignmentConfig
    from aqr.alignment.verification import AcousticCheckConfig, AcousticVerifier
    from aqr.decoding.chains import ChainConfig

    return AcousticVerifier(
        model=_HeardModel(heard),
        texts=alignment_texts,
        corpus=corpus,
        chain=ChainConfig(),
        config=AcousticCheckConfig(**check),
        alignment=AlignmentConfig(),
        max_passage_s=120.0,
        floor=0.75,
    )


def _muno(corpus, matcher, **kwargs):
    texts = [t for t, _ in MICRO_55_MUNO]
    spans = [s for _, s in MICRO_55_MUNO]
    return _pipeline(corpus, matcher, texts, spans, seconds=16.0, **kwargs)


SAID_55 = ((4.9, "55:1[5-5]"), (6.9, "55:2"), (9.8, "55:3"), (12.6, "55:4"))


def test_muno_au_micro_le_maillon_ampute_coupe_la_suite_sans_l_audio(corpus, matcher):
    assert _verses(_muno(corpus, matcher)) == []


def test_muno_au_micro_l_audio_sauve_la_suite_et_donne_les_temps_au_mot(
    corpus, matcher, alignment_texts
):
    acoustic = _acoustic(corpus, alignment_texts, _heard(alignment_texts, *SAID_55))
    result = _muno(corpus, matcher, acoustic=acoustic)
    dets = _verses(result)
    assert [(d.span.ref, d.status) for d in dets] == [
        (VerseRef(55, n), Status.RECOGNIZED) for n in (1, 2, 3, 4)
    ]
    # « عَلَّمَ », perdu par l'ASR, est rendu par l'alignement du texte du corpus
    assert (dets[1].span.first_word, dets[1].span.last_word) == (1, 2)
    # temps de l'alignement (au mot près, trame de 80 ms), pas les bords des fenêtres
    assert dets[1].time is not None and dets[1].time.start_s == pytest.approx(6.9, abs=0.08)
    assert dets[1].time != TimeSpan(6.7, 9.4)
    assert not any(d.time_interpolated for d in dets)
    (check,) = result.acoustic_checks
    assert check.accepted
    assert result.engine.acoustic == "fake-ctc@test"
    assert result.decoder_config["acoustic_min_llr_per_frame"] == -1.0
    assert "acoustic_s" in result.timing


def test_une_suite_que_le_texte_prouve_mais_que_l_audio_ne_soutient_pas_n_est_pas_nommee(
    corpus, matcher, alignment_texts
):  # I3 : les quatre fenêtres sont bien transcrites, mais l'audio dit autre chose
    heard = _heard(alignment_texts, (4.9, "2:1"), (6.9, "2:2"), (9.8, "2:3"), (12.6, "2:4"))
    acoustic = _acoustic(corpus, alignment_texts, heard)
    result = _micro(corpus, matcher, acoustic=acoustic)
    assert [d.span.ref for d in _verses(result)] == []
    assert [c.accepted for c in result.acoustic_checks] == [False]
