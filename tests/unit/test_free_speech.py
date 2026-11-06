"""Parole libre (ADR-0027) : éligibilité, garde-fous, fichier `aqr.free-speech/1`."""

from __future__ import annotations

from array import array
from pathlib import Path

import pytest

from aqr.domain.models import TimeSpan
from aqr.domain.ports import AudioClip
from aqr.freespeech.config import FreeSpeechConfig
from aqr.freespeech.guard import CorpusGuard
from aqr.freespeech.ports import FrenchText, SpeechTranscript
from aqr.freespeech.service import eligible_intervals, run_free_speech
from aqr.freespeech.sidecar import (
    SCHEMA,
    FreeSpeechItem,
    SidecarError,
    build_document,
    validate_document,
)

CONFIG = FreeSpeechConfig()
CLIP = AudioClip(array("f", [0.1] * 16000 * 40), 16000, "test")
SILENT = AudioClip(array("f", [0.0] * 16000 * 40), 16000, "silence")
# Phrases libres (hors Coran) et « versets » inventés pour un corpus jouet.
FREE = "اليوم نتحدث عن اهمية الصبر في حياتنا اليومية"
VERSES = [("هذا", "كتاب", "لا", "ريب", "فيه", "هدى"), ("ان", "مع", "العسر", "يسرا", "فان")]
GUARD = CorpusGuard(VERSES, CONFIG)


class Heard:
    def __init__(
        self,
        text: str = FREE,
        language: str = "ar",
        language_prob: float = 0.95,
        confidence: float = 0.9,
    ) -> None:
        self.reply = SpeechTranscript(text, language, language_prob, confidence, "fake-asr")
        self.calls = 0

    def transcribe(self, clip: AudioClip, span: TimeSpan) -> SpeechTranscript:
        self.calls += 1
        return self.reply


class Translator:
    def __init__(
        self, text: str = "Aujourd'hui nous parlons de l'importance de la patience."
    ) -> None:
        self.text = text
        self.calls = 0

    def translate(self, arabic: str) -> FrenchText:
        self.calls += 1
        return FrenchText(self.text, "fake-mt")


def interval(label: str, a: float, b: float, kind: str = "non_quran") -> dict[str, object]:
    return {"kind": kind, "label": label, "t": [a, b]}


def run(heard: Heard, translator: Translator | None = None, clip: AudioClip = CLIP):
    translator = translator or Translator()
    items = run_free_speech(
        [interval("arabic_speech", 2, 8)], clip, heard, translator, GUARD, CONFIG
    )
    assert len(items) == 1
    return items[0], translator


class TestEligibility:
    def test_seule_la_parole_arabe_non_coranique_est_eligible(self) -> None:
        intervals = [
            interval("arabic_speech", 0, 5),
            interval("french", 5, 9),
            interval("silence", 9, 10),
            interval("basmala", 10, 14),
            interval("takbir", 14, 16),
            interval("other_language", 16, 20),
            {"kind": "abstention", "reason": "silence", "t": [20, 25]},
            {"kind": "verse", "ref": "2:1", "status": "uncertain", "t": [25, 30]},
        ]
        assert [i for i, _ in eligible_intervals(intervals)] == [0]

    def test_un_temps_invalide_est_ecarte(self) -> None:
        assert (
            eligible_intervals([{"kind": "non_quran", "label": "arabic_speech", "t": None}]) == []
        )

    def test_rien_d_autre_n_est_transcrit(self) -> None:
        heard, translator = Heard(), Translator()
        run_free_speech([interval("french", 0, 9)], CLIP, heard, translator, GUARD, CONFIG)
        assert heard.calls == 0 and translator.calls == 0


class TestChemin:
    def test_une_parole_claire_est_traduite_en_attente_de_relecture(self) -> None:
        item, translator = run(Heard())
        assert item.status == "translated"
        assert item.translation_fr and item.review == "pending"
        assert translator.calls == 1


@pytest.mark.parametrize(
    ("heard", "reason"),
    [
        (Heard(language="fr"), "language"),
        (Heard(language_prob=0.3), "language"),
        (Heard(text="hello this is english speech"), "language"),
        (Heard(text="كلمة"), "too_few_words"),
        (Heard(confidence=0.2), "low_confidence"),
        (Heard(text="نعم نعم نعم نعم نعم نعم"), "hallucination"),
        (Heard(text="هذا كتاب لا ريب فيه"), "quran_like"),
        (Heard(text="الله اكبر"), "known_formula"),
    ],
)
def test_chaque_doute_retient_le_passage_sans_texte(heard: Heard, reason: str) -> None:
    item, translator = run(heard)
    assert (item.status, item.reason) == ("withheld", reason)
    assert item.transcript_ar is None and item.translation_fr is None
    assert translator.calls == 0


def test_passage_trop_court_ni_transcrit_ni_traduit() -> None:
    heard, translator = Heard(), Translator()
    [item] = run_free_speech(
        [interval("arabic_speech", 3, 3.5)], CLIP, heard, translator, GUARD, CONFIG
    )
    assert item.reason == "too_short" and heard.calls == 0


def test_silence_numerique_jamais_envoye_au_modele() -> None:
    heard = Heard()
    item, _ = run(heard, clip=SILENT)
    assert item.reason == "silent" and heard.calls == 0


@pytest.mark.parametrize(
    ("french", "reason"),
    [
        ("", "no_translation"),
        ("Oui.", "translation_implausible"),
        ("x" * 900, "translation_implausible"),
    ],
)
def test_traduction_vide_ou_implausible_retient_le_passage(french: str, reason: str) -> None:
    item, _ = run(Heard(), Translator(french))
    assert (item.status, item.reason) == ("withheld", reason)
    assert item.translation_fr is None


class TestGarde:
    def test_suite_de_mots_du_corpus(self) -> None:
        assert GUARD.check(("قال", "هذا", "كتاب", "لا", "ريب")).reason == "run"

    def test_triplets_du_corpus(self) -> None:
        assert GUARD.check(("هذا", "كتاب", "لا")).reason == "ngram"

    def test_phrase_libre_passe(self) -> None:
        assert not GUARD.check(tuple(FREE.split())).quranic

    def test_vide(self) -> None:
        assert not GUARD.check(()).quranic

    def test_le_reconnaisseur_de_versets_peut_retenir_seul(self) -> None:
        class Matcher:
            def match(self, text: str, top_k: int = 5) -> list[object]:
                class C:
                    score = 0.9

                return [C()]

        guard = CorpusGuard(VERSES, CONFIG, matcher=Matcher())  # type: ignore[arg-type]
        verdict = guard.check(("كلمات", "لا", "تشبه", "شيئا"))
        assert verdict.quranic and verdict.reason == "matcher"

    def test_corrections_orthographiques_appliquees(self) -> None:
        guard = CorpusGuard(VERSES, CONFIG, word_corrections={"كتب": "كتاب"})
        assert guard.check(("هذا", "كتب", "لا")).quranic


class TestFichier:
    def _doc(self, items: list[FreeSpeechItem]) -> dict[str, object]:
        return build_document(
            items, transcriber="a", translator="b", recognition_sha256="0" * 64, thresholds={"x": 1}
        )

    def test_roundtrip_valide(self) -> None:
        item, _ = run(Heard())
        held, _ = run(Heard(language="fr"))
        doc = self._doc([item, FreeSpeechItem(9, (1.0, 2.0), "withheld", "quran_like"), held])
        # index uniques : on renumérote le doublon
        doc["items"][2]["index"] = 10  # type: ignore[index]
        validate_document(doc)
        assert doc["schema"] == SCHEMA

    def test_un_passage_retenu_ne_porte_jamais_de_texte(self) -> None:
        doc = self._doc([FreeSpeechItem(0, (1.0, 2.0), "withheld", "quran_like")])
        doc["items"][0]["transcript_ar"] = FREE  # type: ignore[index]
        with pytest.raises(SidecarError, match="aucun texte"):
            validate_document(doc)

    def test_le_passage_retenu_n_ecrit_pas_de_texte(self) -> None:
        item = FreeSpeechItem(
            0, (1.0, 2.0), "withheld", "quran_like", transcript_ar="x", translation_fr="y"
        )
        assert set(item.to_json()) == {"index", "t", "status", "reason"}

    @pytest.mark.parametrize(
        "mutation",
        [
            lambda d: d.update(schema="autre"),
            lambda d: d["items"][0].update(status="inconnu"),
            lambda d: d["items"][0].update(reason="invente"),
            lambda d: d["items"][0].update(t=[5, 1]),
            lambda d: d["items"].append(dict(d["items"][0])),
        ],
    )
    def test_refus(self, mutation) -> None:  # type: ignore[no-untyped-def]
        doc = self._doc([FreeSpeechItem(0, (1.0, 2.0), "withheld", "quran_like")])
        mutation(doc)
        with pytest.raises(SidecarError):
            validate_document(doc)

    def test_traduit_exige_review_et_textes(self) -> None:
        item, _ = run(Heard())
        doc = self._doc([item])
        doc["items"][0]["review"] = "?"  # type: ignore[index]
        with pytest.raises(SidecarError, match="review"):
            validate_document(doc)
        doc["items"][0]["review"] = "approved"  # type: ignore[index]
        doc["items"][0]["translation_fr"] = " "  # type: ignore[index]
        with pytest.raises(SidecarError, match="translation_fr"):
            validate_document(doc)


CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"


@pytest.mark.skipif(
    not (CORPUS_DIR / "quran-simple-clean.txt").exists(), reason="corpus non téléchargé"
)
class TestGardeSurLeVraiCorpus:
    @pytest.fixture(scope="class")
    def guard(self) -> CorpusGuard:
        from aqr.corpus.normalize import normalize_arabic, tokenize
        from aqr.corpus.tanzil_repository import TanzilCorpusRepository

        repo = TanzilCorpusRepository(CORPUS_DIR)
        verses = [tokenize(normalize_arabic(repo.text(ref))) for ref in repo.all_refs()]
        return CorpusGuard(verses, CONFIG)

    def test_un_verset_entier_est_retenu(self, guard: CorpusGuard) -> None:
        from aqr.corpus.normalize import normalize_arabic, tokenize

        text = "قل هو الله احد الله الصمد لم يلد ولم يولد"
        assert guard.check(tokenize(normalize_arabic(text))).quranic

    def test_un_hadith_ou_un_cours_passe(self, guard: CorpusGuard) -> None:
        from aqr.corpus.normalize import normalize_arabic, tokenize

        text = "اليوم نتحدث عن اهمية الصبر في حياتنا اليومية"
        assert not guard.check(tokenize(normalize_arabic(text))).quranic
