"""`aqr recognize` : JSON puis SRT ; erreurs actionnables ; pas d'écrasement silencieux.
Composants factices injectés (aucun modèle, aucun réseau)."""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

import pytest

from aqr.cli import main
from aqr.corpus.imlai_corrections import build_word_corrections, load_simple_clean_words
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.domain.models import Riwaya, TimeSpan, VerseRef
from aqr.domain.ports import AudioClip, TranscribedWord, Transcript, Translation
from aqr.matching.flow_matcher import FlowVerseMatcher
from aqr.pipeline.factory import Recognizer
from aqr.pipeline.pipeline import RecognitionPipeline
from aqr.pipeline.result import EngineInfo
from aqr.rendering.home_renderer import HomeRenderer

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"
pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "LOCK.json").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)


class _Extractor:
    def extract(self, path: Path) -> AudioClip:
        from array import array

        return AudioClip(array("f", [0.3] * 16000 * 20), 16000, str(path))


class _Segmenter:
    def segment(self, clip):
        return [TimeSpan(1.0, 7.0), TimeSpan(8.0, 14.0)]


class _ASR:
    riwaya = Riwaya.HAFS

    def __init__(self, corpus) -> None:
        self._texts = [" ".join(corpus.words(VerseRef(67, a))) for a in (1, 2)]
        self._i = 0

    def transcribe(self, clip, span):
        text = self._texts[self._i]
        self._i += 1
        return Transcript(tuple(TranscribedWord(w, span, 0.9) for w in text.split()), "fake")


class _Translations:
    def get(self, ref, translation_id):
        return Translation(ref, f"trad {ref}", translation_id, "v", "attr")


@pytest.fixture(scope="module")
def corpus():
    return TanzilCorpusRepository(CORPUS_DIR)


@pytest.fixture(scope="module")
def matcher(corpus):
    return FlowVerseMatcher(
        corpus, word_corrections=build_word_corrections(corpus, load_simple_clean_words(CORPUS_DIR))
    )


def _factory(corpus, matcher):
    def build(options, env):
        engine = EngineInfo("fake-asr", "fake-seg", "flow", "viterbi-v2", corpus="tanzil")
        pipeline = RecognitionPipeline(
            _Extractor(), _Segmenter(), _ASR(corpus), matcher, corpus, engine
        )
        return Recognizer(pipeline, HomeRenderer(corpus, _Translations()))

    return build


def _run(args, corpus, matcher, env=None):
    out, err = io.StringIO(), io.StringIO()
    code = main(
        ["recognize", *args],
        env=env or {},
        out=out,
        err=err,
        recognizer_factory=_factory(corpus, matcher),
    )
    return code, out.getvalue(), err.getvalue()


@pytest.fixture()
def audio(tmp_path: Path) -> Path:
    path = tmp_path / "cours.mp3"
    path.write_bytes(b"pas du vrai audio : l'extracteur est factice")
    return path


def test_ecrit_json_puis_srt(tmp_path, audio, corpus, matcher):
    out_dir = tmp_path / "sortie"
    code, out, err = _run([str(audio), "--out-dir", str(out_dir)], corpus, matcher)
    assert code == 0, err
    doc = json.loads((out_dir / "cours.recognition.json").read_text(encoding="utf-8"))
    assert doc["schema"] == "aqr.recognition/1"
    assert doc["source"]["sha256"] == hashlib.sha256(audio.read_bytes()).hexdigest()
    assert [i["ref"] for i in doc["intervals"] if i["kind"] == "verse"] == ["67:1", "67:2"]
    assert doc["intervals"][0]["translation"]["text"] == "trad 67:1"
    srt = (out_dir / "cours.srt").read_text(encoding="utf-8")
    assert corpus.text(VerseRef(67, 1)) in srt and "00:00:01,000 --> 00:00:07,000" in srt
    assert "cours.recognition.json" in out and "cours.srt" in out


def test_formats_choisis_et_sans_traduction(tmp_path, audio, corpus, matcher):
    out_dir = tmp_path / "o"
    code, _, err = _run(
        [str(audio), "--out-dir", str(out_dir), "--format", "json,vtt", "--translation", "none"],
        corpus,
        matcher,
    )
    assert code == 0, err
    assert sorted(p.name for p in out_dir.iterdir()) == ["cours.recognition.json", "cours.vtt"]
    doc = json.loads((out_dir / "cours.recognition.json").read_text(encoding="utf-8"))
    assert doc["intervals"][0]["translation"] is None


def test_pas_d_ecrasement_silencieux(tmp_path, audio, corpus, matcher):
    out_dir = tmp_path / "o"
    assert _run([str(audio), "--out-dir", str(out_dir)], corpus, matcher)[0] == 0
    code, _, err = _run([str(audio), "--out-dir", str(out_dir)], corpus, matcher)
    assert code == 1 and "--force" in err
    code, _, _ = _run([str(audio), "--out-dir", str(out_dir), "--force"], corpus, matcher)
    assert code == 0


def test_fichier_introuvable(tmp_path, corpus, matcher):
    code, _, err = _run([str(tmp_path / "absent.mp3"), "--out-dir", str(tmp_path)], corpus, matcher)
    assert code == 1 and "absent.mp3" in err


def test_format_inconnu(tmp_path, audio, corpus, matcher):
    code, _, err = _run(
        [str(audio), "--out-dir", str(tmp_path), "--format", "xml"], corpus, matcher
    )
    assert code == 2 and "xml" in err


def test_constrained_refuse_tant_que_l_asr_n_expose_pas_de_treillis(
    tmp_path, audio, corpus, matcher
):
    code, _, err = _run([str(audio), "--out-dir", str(tmp_path), "--constrained"], corpus, matcher)
    assert code == 2 and "ADR-0005" in err


def test_vraie_fabrique_sans_dossier_de_modeles_est_une_erreur_claire(tmp_path, audio):
    out, err = io.StringIO(), io.StringIO()
    code = main(["recognize", str(audio), "--out-dir", str(tmp_path)], env={}, out=out, err=err)
    assert code == 2
    assert "AQR_MODELS_DIR" in err.getvalue()
