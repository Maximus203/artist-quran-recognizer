"""Le fichier de frontières versionné : forme, cohérence avec le corpus, aucun texte, et (quand le
cache QuranEnc local est présent) reconstitution exacte de la traduction sur 6 236 versets (I2)."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from aqr.adapters.quranenc import QuranEncTranslationRepository
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.rendering.translation_segments import SEGMENTS_SCHEMA, SegmentStore
from aqr.translation_align.build import VerseSource, verify_reconstruction

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "translation-segments" / "french_hameedullah.json"
CORPUS_DIR = ROOT / "data" / "corpus"
CACHE = Path(os.environ.get("AQR_CACHE_DIR") or Path.home() / ".cache" / "aqr") / "translations"

needs_corpus = pytest.mark.skipif(
    not (CORPUS_DIR / "quran-uthmani.txt").exists(), reason="corpus non téléchargé"
)


@pytest.fixture(scope="module")
def document() -> dict[str, object]:
    return json.loads(DATA.read_text(encoding="utf-8"))


def test_file_is_complete_and_declares_its_method(document: dict[str, object]) -> None:
    assert document["schema"] == SEGMENTS_SCHEMA
    assert document["translation_id"] == "french_hameedullah"
    assert str(document["method"]).startswith("ibm1-")
    verses = document["verses"]
    assert isinstance(verses, dict)
    assert len(verses) == 6236
    config = document["config"]
    assert isinstance(config, dict)
    assert (
        config["min_boundary_confidence"] >= 0.9
    )  # précision d'abord : seuil écrit dans le fichier


def test_file_holds_no_quranic_text_and_no_translation() -> None:
    raw = DATA.read_text(encoding="utf-8")
    assert not any("؀" <= ch <= "ۿ" for ch in raw)  # aucune lettre arabe
    for sample in ("Allah", "Seigneur", "croyants"):  # aucun mot de traduction
        assert sample not in raw


@needs_corpus
def test_cuts_are_structurally_valid_against_the_corpus(document: dict[str, object]) -> None:
    corpus = TanzilCorpusRepository(CORPUS_DIR)
    verses = document["verses"]
    assert isinstance(verses, dict)
    for ref in corpus.all_refs():
        entry = verses[str(ref)]
        assert entry["w"] == len(corpus.words(ref))
        words = [cut[0] for cut in entry["cuts"]]
        offsets = [cut[1] for cut in entry["cuts"]]
        assert words == sorted(set(words)) and offsets == sorted(set(offsets))
        assert all(1 < w <= entry["w"] for w in words)
        assert all(0.9 <= cut[2] <= 1.0 for cut in entry["cuts"])
        assert len(entry["h"]) == 16


@needs_corpus
@pytest.mark.skipif(
    not (CACHE / "french_hameedullah" / "114.json").exists(),
    reason="cache QuranEnc absent (traductions non téléchargées)",
)
def test_every_verse_is_rebuilt_identically_from_its_slices(document: dict[str, object]) -> None:
    corpus = TanzilCorpusRepository(CORPUS_DIR)
    repo = QuranEncTranslationRepository(CACHE)
    sources = [
        VerseSource(r, corpus.words(r), corpus.text(r), repo.get(r, "french_hameedullah").text)
        for r in corpus.all_refs()
    ]
    assert verify_reconstruction(document, sources) == []
    store = SegmentStore.from_document(document)
    assert all(store.segments(s.ref, s.french, len(s.arabic_words)) is not None for s in sources)
