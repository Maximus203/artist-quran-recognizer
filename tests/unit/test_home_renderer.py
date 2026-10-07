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


def _full_span(ref: VerseRef) -> WordSpan:
    return WordSpan(ref=ref, first_word=1, last_word=len(_CORPUS.words(ref)))


_CORPUS = TanzilCorpusRepository(CORPUS_DIR) if (CORPUS_DIR / "LOCK.json").exists() else None


def _detection(ref: VerseRef, t0: float) -> Detection:
    return Detection(
        span=_full_span(ref),
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


# --- Passages partiels, répétitions, statuts dans les sous-titres (phase 5) --------------------
def _item(renderer: HomeRenderer, det: Detection) -> dict:
    timeline = Timeline(items=(det,), riwaya=Riwaya.HAFS, engine_version="t")
    return renderer.render(timeline, "french_hameedullah", BatchOptions())[0].json["items"][0]


def test_passage_partiel_rend_les_seuls_mots_recites_depuis_le_corpus(corpus, renderer):  # I1
    ref = VerseRef(2, 255)
    det = Detection(
        span=WordSpan(ref, 1, 6),
        time=TimeSpan(0.0, 3.0),
        status=Status.RECOGNIZED,
        confidence=1.0,
    )
    item = _item(renderer, det)
    assert item["words"] == [1, 6]
    assert item["partial"] is True
    assert item["text"] == " ".join(corpus.text(ref).split()[:6])  # les 6 premiers mots du Mushaf
    assert item["text"] in corpus.text(ref)  # sous-chaîne exacte du Mushaf, jamais reconstruite
    assert item["translation"]["scope"] == "verse"  # la traduction n'est pas découpable


def test_verset_entier_non_partiel_texte_integral(corpus, renderer):
    ref = VerseRef(112, 1)
    item = _item(renderer, Detection(_full_span(ref), TimeSpan(0, 3), Status.RECOGNIZED, 1.0))
    assert item["partial"] is False
    assert item["text"] == corpus.text(ref)


def test_repetition_exposee(renderer):
    det = Detection(
        _full_span(VerseRef(112, 1)), TimeSpan(0, 3), Status.RECOGNIZED, 1.0, is_repetition=True
    )
    assert _item(renderer, det)["repetition"] is True


def test_srt_ne_presente_jamais_un_verset_incertain_ou_deduit_comme_reconnu(corpus, renderer):
    inferred = Detection(
        _full_span(VerseRef(67, 5)), TimeSpan(3, 6), Status.INFERRED, 0.0, time_interpolated=True
    )
    uncertain = Detection(
        _full_span(VerseRef(55, 13)),
        TimeSpan(6, 9),
        Status.UNCERTAIN,
        0.9,
        candidates=(VerseRef(55, 13), VerseRef(55, 16)),
    )
    recognized = _detection(VerseRef(67, 4), 0.0)
    timeline = Timeline((recognized, inferred, uncertain), Riwaya.HAFS, "t")
    srt = renderer.render(timeline, "french_hameedullah", BatchOptions())[0].srt
    assert "[déduit] " + corpus.text(VerseRef(67, 5)) in srt
    assert "[incertain : 55:13 | 55:16]" in srt
    assert corpus.text(VerseRef(55, 13)) not in srt  # aucun texte pour un verset incertain
    assert corpus.text(VerseRef(67, 4)) in srt and "[" not in srt.split("\n\n")[0]
