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
    assert doc["intervals"][0] == {
        "kind": "non_quran",
        "label": "istiadha",
        "t": [0.5, 2.0],
        "label_ar": "أعوذ بالله من الشيطان الرجيم",
    }
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


def test_expurge_retire_texte_et_traduction_mais_garde_refs_temps_et_statuts(corpus, renderer):
    from aqr.pipeline.output import redact_document

    doc = build_json(_result(corpus), renderer, "french_hameedullah", source_sha256="00")
    redacted = redact_document(doc)
    for original, light in zip(doc["intervals"], redacted["intervals"], strict=True):
        assert "text" not in light and "translation" not in light
        assert {k: v for k, v in original.items() if k not in ("text", "translation")} == light
    assert redacted["source"] == doc["source"] and redacted["timing"] == doc["timing"]
    assert "text" in doc["intervals"][1]  # l'original n'est pas modifié


def test_les_suites_verifiees_sur_l_audio_sont_tracees(corpus, renderer):  # ADR-0008
    from dataclasses import replace

    from aqr.alignment.verification import ChainCheck
    from aqr.domain.models import WordSpan

    checks = (
        ChainCheck(
            TimeSpan(4.7, 15.5),
            (WordSpan(VerseRef(55, 1), 5, 5), WordSpan(VerseRef(55, 2), 1, 2)),
            -0.4361,
            True,
        ),
        ChainCheck(
            TimeSpan(20.0, 21.0), (WordSpan(VerseRef(2, 1), 1, 1),), None, False, "continuation"
        ),
    )
    base = _result(corpus)
    result = replace(base, engine=replace(base.engine, acoustic="ctc@rev"), acoustic_checks=checks)
    doc = build_json(result, renderer, None, source_sha256="00")
    assert doc["engine"]["acoustic"] == "ctc@rev"
    assert doc["acoustic_checks"] == [
        {
            "kind": "chain",
            "t": [4.7, 15.5],
            "verses": "55:1[5-5],55:2[1-2]",
            "llr_per_frame": -0.4361,
            "accepted": True,
        },
        {
            "kind": "continuation",
            "t": [20.0, 21.0],
            "verses": "2:1[1-1]",
            "llr_per_frame": None,
            "accepted": False,
        },
    ]
    assert build_json(base, renderer, None, source_sha256="00")["acoustic_checks"] == []


def test_la_riwaya_supposee_est_declaree_non_verifiee(corpus, renderer):
    """Décision de Cherif (2026-10-20) : un avertissement tout de suite. Aucun signal ne détecte
    encore le Warsh (mesure négative, docs/evaluation/riwaya-2026-10-20.md) : chaque sortie dit
    donc que la riwaya est SUPPOSÉE, non vérifiée, et ce que cela implique pour le texte affiché."""
    doc = build_json(_result(corpus), renderer, None, source_sha256="00")
    riwaya = doc["riwaya"]
    assert riwaya["assumed"] == "hafs"
    assert riwaya["verified"] is False
    assert "Warsh" in riwaya["notice"] and "Hafs" in riwaya["notice"]


def test_la_cascade_est_tracee_seulement_quand_elle_a_tourne(corpus, renderer):  # ADR-0009
    from dataclasses import replace

    base = _result(corpus)
    cascade = {
        "secondary": ["whisper@rev", "muno@rev"],
        "relistened_windows": 3,
        "rescued_windows": 1,
    }
    doc = build_json(replace(base, cascade=cascade), renderer, None, source_sha256="00")
    assert doc["cascade"] == cascade
    assert "cascade" not in build_json(base, renderer, None, source_sha256="00")


# --- Basmala affichée comme un verset (texte du Mushaf 1:1, jamais d'un modèle : I1, I2) ---------


def _formulas_result():
    intervals = (
        NonQuranSpan(TimeSpan(0.5, 2.0), NonQuranKind.ISTIADHA),
        NonQuranSpan(TimeSpan(2.5, 5.0), NonQuranKind.BASMALA),
        NonQuranSpan(TimeSpan(6.0, 7.0), NonQuranKind.TAKBIR),
        NonQuranSpan(TimeSpan(8.0, 9.0), NonQuranKind.AMIN),
        NonQuranSpan(TimeSpan(10.0, 12.0), NonQuranKind.FRENCH),
    )
    return RecognitionResult(
        source_file="x.mp3",
        duration_s=30.0,
        intervals=intervals,
        engine=EngineInfo("asr@rev", "seg", "flow", "viterbi-v2", corpus="tanzil"),
        timing={},
        decoder_config={},
        windows=1,
    )


def test_la_basmala_porte_le_texte_du_corpus_1_1_et_sa_traduction(corpus, renderer):
    doc = build_json(_formulas_result(), renderer, "french_hameedullah", source_sha256="00")
    basmala = doc["intervals"][1]
    assert basmala == {
        "kind": "non_quran",
        "label": "basmala",
        "t": [2.5, 5.0],
        "basmala": True,
        "ref": "1:1",
        "text": corpus.text(VerseRef(1, 1)),  # I1 : le Mushaf, pas un modèle
        "translation": {
            "text": "traduction de 1:1",  # I2 : restituée telle quelle, avec sa provenance
            "translation_id": "french_hameedullah",
            "version": "v-test",
            "attribution": "attribution",
            "scope": "verse",
        },
    }
    assert len(corpus.words(VerseRef(1, 1))) == 4  # la basmala des autres sourates : quatre mots


def test_la_basmala_sans_traduction_demandee_garde_son_texte(corpus, renderer):
    doc = build_json(_formulas_result(), renderer, None, source_sha256="00")
    basmala = doc["intervals"][1]
    assert basmala["text"] == corpus.text(VerseRef(1, 1))
    assert basmala["translation"] is None


def test_les_autres_formules_n_ont_pas_de_texte_du_coran_seulement_un_libelle(corpus, renderer):
    doc = build_json(_formulas_result(), renderer, "french_hameedullah", source_sha256="00")
    labels = {i["label"]: i for i in doc["intervals"]}
    assert labels["istiadha"]["label_ar"] == "أعوذ بالله من الشيطان الرجيم"
    assert labels["takbir"]["label_ar"] == "الله أكبر"
    assert labels["amin"]["label_ar"] == "آمين"
    for kind in ("istiadha", "takbir", "amin"):
        item = labels[kind]
        # hors corpus : ni texte, ni traduction, ni référence de verset, et pas une basmala
        assert not {"text", "translation", "ref", "basmala"} & item.keys()
        assert set(item) == {"kind", "label", "t", "label_ar"}


def test_une_zone_non_coranique_ordinaire_reste_inchangee(corpus, renderer):
    doc = build_json(_formulas_result(), renderer, "french_hameedullah", source_sha256="00")
    assert doc["intervals"][4] == {"kind": "non_quran", "label": "french", "t": [10.0, 12.0]}


def test_la_basmala_expurgee_perd_texte_et_traduction_mais_garde_sa_reference(corpus, renderer):
    from aqr.pipeline.output import redact_document

    doc = build_json(_formulas_result(), renderer, "french_hameedullah", source_sha256="00")
    light = redact_document(doc)["intervals"][1]
    assert light == {
        "kind": "non_quran",
        "label": "basmala",
        "t": [2.5, 5.0],
        "basmala": True,
        "ref": "1:1",
    }
    assert "text" in doc["intervals"][1]  # l'original n'est pas modifié


def test_les_sous_titres_gardent_le_libelle_de_la_basmala(corpus, renderer):
    srt = render_srt(_formulas_result(), renderer)
    assert "[basmala]" in srt and corpus.text(VerseRef(1, 1)) not in srt
