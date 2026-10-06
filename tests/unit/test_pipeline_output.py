"""Sortie `aqr.recognition/1` : JSON (versets, formules, abstentions, preuve) puis SRT/VTT.
Texte arabe et traduction : uniquement depuis les corpus ; verset incertain jamais nommé."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.domain.models import (
    Detection,
    NonQuranKind,
    NonQuranSpan,
    Status,
    TimeSpan,
    VerseRef,
    WordSpan,
)
from aqr.domain.ports import Translation
from aqr.pipeline.output import SCHEMA, build_json, render_srt, render_vtt
from aqr.pipeline.result import (
    AbstentionReason,
    AbstentionSpan,
    EngineInfo,
    RecognitionResult,
)
from aqr.rendering.home_renderer import HomeRenderer

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"
pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "LOCK.json").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)


class _Translations:
    def get(self, ref, translation_id):
        return Translation(ref, f"traduction de {ref}", translation_id, "v-test", "attribution")


@pytest.fixture(scope="module")
def corpus():
    return TanzilCorpusRepository(CORPUS_DIR)


@pytest.fixture(scope="module")
def renderer(corpus):
    return HomeRenderer(corpus, _Translations())


def _full(corpus, ref):
    return WordSpan(ref, 1, len(corpus.words(ref)))


def _result(corpus):
    intervals = (
        NonQuranSpan(TimeSpan(0.5, 2.0), NonQuranKind.ISTIADHA),
        Detection(_full(corpus, VerseRef(112, 1)), TimeSpan(3.0, 6.0), Status.RECOGNIZED, 0.95),
        AbstentionSpan(TimeSpan(7.0, 9.0), AbstentionReason.BELOW_THRESHOLD, 0.41),
        Detection(
            _full(corpus, VerseRef(55, 13)),
            TimeSpan(10.0, 13.0),
            Status.UNCERTAIN,
            0.9,
            candidates=(VerseRef(55, 13), VerseRef(55, 16)),
        ),
        Detection(
            _full(corpus, VerseRef(67, 5)),
            TimeSpan(14.0, 20.0),
            Status.INFERRED,
            0.0,
            time_interpolated=True,
        ),
    )
    return RecognitionResult(
        source_file="x.mp3",
        duration_s=30.0,
        intervals=intervals,
        engine=EngineInfo("asr@rev", "seg", "flow", "viterbi-v2", corpus="tanzil"),
        timing={"extract_s": 1.0, "total_s": 5.0},
        decoder_config={"min_recognized_score": 0.75},
        windows=4,
    )


def test_json_schema_et_intervalles_ordonnes(corpus, renderer):
    doc = build_json(_result(corpus), renderer, "french_hameedullah", source_sha256="ab" * 32)
    assert doc["schema"] == SCHEMA == "aqr.recognition/1"
    assert doc["source"] == {"file": "x.mp3", "sha256": "ab" * 32, "duration_s": 30.0}
    kinds = [i["kind"] for i in doc["intervals"]]
    assert kinds == ["non_quran", "verse", "abstention", "verse", "verse"]
    starts = [i["t"][0] for i in doc["intervals"] if i["t"]]
    assert starts == sorted(starts)
    json.dumps(doc, ensure_ascii=False)  # sérialisable


def test_verset_reconnu_texte_du_corpus_et_traduction_non_modifiee(corpus, renderer):
    doc = build_json(_result(corpus), renderer, "french_hameedullah", source_sha256="00")
    verse = doc["intervals"][1]
    assert verse["text"] == corpus.text(VerseRef(112, 1))
    assert verse["translation"]["text"] == "traduction de 112:1"
    assert verse["translation"]["version"] == "v-test"
    assert verse["status"] == "recognized" and verse["t"] == [3.0, 6.0]


def test_verset_incertain_non_nomme_et_infere_marque(corpus, renderer):
    doc = build_json(_result(corpus), renderer, "french_hameedullah", source_sha256="00")
    uncertain, inferred = doc["intervals"][3], doc["intervals"][4]
    assert uncertain["status"] == "uncertain" and uncertain["candidates"] == ["55:13", "55:16"]
    assert uncertain["text"] is None and uncertain["translation"] is None
    assert inferred["status"] == "inferred" and inferred["time_interpolated"] is True
    assert inferred["text"] == corpus.text(VerseRef(67, 5))


def test_abstention_et_formule_explicites(corpus, renderer):
    doc = build_json(_result(corpus), renderer, None, source_sha256="00")
    assert doc["intervals"][0] == {"kind": "non_quran", "label": "istiadha", "t": [0.5, 2.0]}
    assert doc["intervals"][2] == {
        "kind": "abstention",
        "reason": "below_threshold",
        "t": [7.0, 9.0],
        "best_score": 0.41,
    }
    assert doc["intervals"][1]["translation"] is None  # pas de traduction demandée


def test_srt_versets_formules_marques_et_pas_d_abstention(corpus, renderer):
    srt = render_srt(_result(corpus), renderer)
    blocks = srt.strip().split("\n\n")
    assert blocks[0].splitlines()[0] == "1"
    assert "[isti'adha]" in blocks[0]
    assert corpus.text(VerseRef(112, 1)) in blocks[1]
    assert "00:00:03,000 --> 00:00:06,000" in blocks[1]
    assert "[incertain : 55:13 | 55:16]" in srt
    assert "[déduit] " + corpus.text(VerseRef(67, 5)) in srt
    assert len(blocks) == 4  # l'abstention n'a pas de sous-titre
    assert corpus.text(VerseRef(55, 13)) not in srt


def test_vtt_meme_contenu(corpus, renderer):
    vtt = render_vtt(_result(corpus), renderer)
    assert vtt.startswith("WEBVTT")
    assert "00:00:03.000 --> 00:00:06.000" in vtt
    assert "[incertain : 55:13 | 55:16]" in vtt
