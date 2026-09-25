"""Tests du Renderer (B9). Utilise le corpus réel (I1 : texte octet pour octet)
et une traduction factice (pas de réseau, l'attribution/I2 est testée séparément
sur QuranEncTranslationRepository)."""

from __future__ import annotations

from pathlib import Path

import pytest

from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.domain.models import Detection, Riwaya, Status, Timeline, TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import BatchOptions, Translation
from aqr.rendering.home_renderer import HomeRenderer

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"

pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "LOCK.json").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)


class _FakeTranslations:
    def get(self, ref: VerseRef, translation_id: str) -> Translation:
        return Translation(
            ref=ref,
            text=f"traduction factice de {ref}",
            translation_id=translation_id,
            version="test",
            attribution="test-attribution",
        )


@pytest.fixture(scope="module")
def corpus() -> TanzilCorpusRepository:
    return TanzilCorpusRepository(CORPUS_DIR)


@pytest.fixture()
def renderer(corpus: TanzilCorpusRepository) -> HomeRenderer:
    return HomeRenderer(corpus=corpus, translations=_FakeTranslations())


def _detection(ref: VerseRef, t0: float) -> Detection:
    return Detection(
        span=WordSpan(ref=ref, first_word=1, last_word=1),
        time=TimeSpan(t0, t0 + 3.0),
        status=Status.RECOGNIZED,
        confidence=0.98,
    )


def _timeline(refs: list[VerseRef]) -> Timeline:
    items = tuple(_detection(ref, i * 3.0) for i, ref in enumerate(refs))
    return Timeline(items=items, riwaya=Riwaya.HAFS, engine_version="test-engine")


def test_texte_arabe_octet_pour_octet_depuis_le_corpus(corpus, renderer):  # P10
    timeline = _timeline([VerseRef(112, a) for a in range(1, 5)])
    batches = renderer.render(timeline, "french_hameedullah", BatchOptions())
    assert len(batches) == 1
    for item, ref in zip(
        batches[0].json["items"], [VerseRef(112, a) for a in range(1, 5)], strict=True
    ):
        assert item["text"] == corpus.text(ref)


def test_lot_de_3_sur_7_versets(corpus, renderer):  # P11
    refs = [VerseRef(67, a) for a in range(1, 8)]
    timeline = _timeline(refs)
    batches = renderer.render(timeline, "french_hameedullah", BatchOptions(batch_size=3))
    assert [len(b.detections) for b in batches] == [3, 3, 1]
    assert [d.span.ref for b in batches for d in b.detections] == refs


def test_sans_lot_un_seul_batch(corpus, renderer):
    refs = [VerseRef(67, a) for a in range(1, 8)]
    timeline = _timeline(refs)
    batches = renderer.render(timeline, "french_hameedullah", BatchOptions())
    assert len(batches) == 1
    assert len(batches[0].detections) == 7


def test_timeline_vide_ne_produit_aucun_lot(renderer):
    timeline = Timeline(items=(), riwaya=Riwaya.HAFS, engine_version="test-engine")
    assert renderer.render(timeline, "french_hameedullah", BatchOptions()) == []


def test_traduction_sans_modification_avec_attribution_et_version(corpus, renderer):  # I2
    timeline = _timeline([VerseRef(1, 1)])
    batches = renderer.render(timeline, "french_hameedullah", BatchOptions())
    translation = batches[0].json["items"][0]["translation"]
    assert translation["text"] == "traduction factice de 1:1"
    assert translation["translation_id"] == "french_hameedullah"
    assert translation["version"] == "test"
    assert translation["attribution"] == "test-attribution"


def test_srt_et_vtt_contiennent_le_texte_arabe(corpus, renderer):
    timeline = _timeline([VerseRef(67, 1)])
    batches = renderer.render(timeline, "french_hameedullah", BatchOptions())
    text = corpus.text(VerseRef(67, 1))
    assert text in batches[0].srt
    assert text in batches[0].vtt
    assert batches[0].vtt.startswith("WEBVTT")
    assert "-->" in batches[0].srt
