"""Rendu d'un verset partiel : la traduction suit la partie affichée en arabe (fragments).

Corpus réel (I1) ; traduction fictive dont seules les frontières comptent (I2 : jamais modifiée).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.domain.models import Detection, Status, TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import Translation
from aqr.rendering.home_renderer import HomeRenderer
from aqr.rendering.translation_segments import SegmentLibrary, fingerprint

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"

pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "quran-uthmani.txt").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)

REF = VerseRef(11, 61)  # 27 mots
TEXT = "Un deux trois quatre. Cinq six sept huit.  Neuf dix onze douze ! Treize quatorze[1] quinze."
CUTS = [
    [10, TEXT.index("Cinq"), 0.99],
    [20, TEXT.index("Neuf"), 0.98],
    [24, TEXT.index("Treize"), 0.97],
]
# segments : 1-9 | 10-19 | 20-23 | 24-27


class _Translations:
    def __init__(self, text: str = TEXT) -> None:
        self._text = text

    def get(self, ref: VerseRef, translation_id: str) -> Translation:
        return Translation(
            ref=ref,
            text=self._text if ref == REF else f"traduction de {ref}",
            translation_id=translation_id,
            version="v-test",
            attribution="attribution-test",
        )


@pytest.fixture(scope="module")
def corpus() -> TanzilCorpusRepository:
    return TanzilCorpusRepository(CORPUS_DIR)


def _library(tmp_path: Path, text: str = TEXT, cuts: list[list[object]] | None = None) -> Path:
    document = {
        "schema": "aqr.translation-segments/1",
        "translation_id": "french_test",
        "method": "test",
        "verses": {
            str(REF): {"h": fingerprint(text), "w": 27, "cuts": CUTS if cuts is None else cuts}
        },
    }
    (tmp_path / "french_test.json").write_text(json.dumps(document), encoding="utf-8")
    return tmp_path


def _renderer(corpus: TanzilCorpusRepository, directory: Path, text: str = TEXT) -> HomeRenderer:
    return HomeRenderer(corpus, _Translations(text), SegmentLibrary(directory))


def _detection(first: int, last: int, status: Status = Status.RECOGNIZED) -> Detection:
    return Detection(
        span=WordSpan(ref=REF, first_word=first, last_word=last),
        time=TimeSpan(1.0, 5.0),
        status=status,
        confidence=0.9,
        candidates=(REF, VerseRef(7, 73)) if status is Status.UNCERTAIN else (),
    )


def _translation(item: dict[str, object]) -> dict[str, object]:
    translation = item["translation"]
    assert isinstance(translation, dict)
    return translation


def test_partial_verse_gets_the_fragment_of_the_displayed_words(
    corpus: TanzilCorpusRepository, tmp_path: Path
) -> None:
    renderer = _renderer(corpus, _library(tmp_path))
    item = renderer.render_item(_detection(10, 19), "french_test")
    translation = _translation(item)
    assert translation["scope"] == "fragment"
    assert translation["text"] == TEXT  # le verset entier reste restitué tel quel (I2)
    assert translation["fragment"] == {
        "words": [10, 19],
        "text": "Cinq six sept huit.",
        "approximate": False,
        "ellipsis_before": True,
        "ellipsis_after": True,
    }


def test_segments_cover_the_whole_verse_in_order_without_altering_text(
    corpus: TanzilCorpusRepository, tmp_path: Path
) -> None:
    renderer = _renderer(corpus, _library(tmp_path))
    translation = _translation(renderer.render_item(_detection(10, 19), "french_test"))
    segments = translation["segments"]
    assert isinstance(segments, list)
    assert [s["words"] for s in segments] == [[1, 9], [10, 19], [20, 23], [24, 27]]
    assert [s["text"] for s in segments] == [
        "Un deux trois quatre.",
        "Cinq six sept huit.",
        "Neuf dix onze douze !",
        "Treize quatorze[1] quinze.",
    ]
    # I2 : les tranches rejointes redonnent la traduction, aux espaces de jonction près
    assert " ".join(s["text"] for s in segments) == " ".join(TEXT.split())


def test_footnote_marker_stays_with_the_fragment_that_precedes_it(
    corpus: TanzilCorpusRepository, tmp_path: Path
) -> None:
    text = "Un deux. Trois quatre[1]. Cinq six."
    cuts: list[list[object]] = [[10, text.index("Trois"), 0.99], [20, text.index("Cinq"), 0.99]]
    renderer = _renderer(corpus, _library(tmp_path, text, cuts), text)
    fragment = _translation(renderer.render_item(_detection(10, 19), "french_test"))["fragment"]
    assert isinstance(fragment, dict)
    assert fragment["text"] == "Trois quatre[1]."


def test_range_inside_a_segment_is_approximate_or_falls_back(
    corpus: TanzilCorpusRepository, tmp_path: Path
) -> None:
    renderer = _renderer(corpus, _library(tmp_path))
    narrow = _translation(renderer.render_item(_detection(12, 14), "french_test"))
    # 3 mots affichés, un segment de 10 mots : le débordement dépasse la limite -> verset entier
    assert narrow["scope"] == "verse"
    assert "fragment" not in narrow
    assert "segments" in narrow
    wide = _translation(renderer.render_item(_detection(11, 19), "french_test"))
    assert wide["scope"] == "fragment"
    fragment = wide["fragment"]
    assert isinstance(fragment, dict)
    assert fragment["approximate"] is True
    assert fragment["words"] == [10, 19]


def test_full_verse_keeps_scope_verse_and_has_no_fragment(
    corpus: TanzilCorpusRepository, tmp_path: Path
) -> None:
    renderer = _renderer(corpus, _library(tmp_path))
    translation = _translation(renderer.render_item(_detection(1, 27), "french_test"))
    assert translation["scope"] == "verse"
    assert "fragment" not in translation
    assert "segments" in translation


def test_changed_translation_means_no_segments_and_no_fragment(
    corpus: TanzilCorpusRepository, tmp_path: Path
) -> None:
    library = _library(tmp_path)  # frontières calculées pour TEXT
    renderer = _renderer(corpus, library, TEXT.replace("Un", "Une"))
    translation = _translation(renderer.render_item(_detection(10, 19), "french_test"))
    assert translation["scope"] == "verse"
    assert "segments" not in translation
    assert "fragment" not in translation
    assert translation["text"] == TEXT.replace("Un", "Une")


def test_without_a_library_the_output_is_the_historical_one(
    corpus: TanzilCorpusRepository,
) -> None:
    renderer = HomeRenderer(corpus, _Translations())
    translation = _translation(renderer.render_item(_detection(10, 19), "french_test"))
    assert translation == {
        "text": TEXT,
        "translation_id": "french_test",
        "version": "v-test",
        "attribution": "attribution-test",
        "scope": "verse",
    }


def test_uncertain_verse_names_nothing(corpus: TanzilCorpusRepository, tmp_path: Path) -> None:
    renderer = _renderer(corpus, _library(tmp_path))
    item = renderer.render_item(_detection(10, 19, Status.UNCERTAIN), "french_test")
    assert item["translation"] is None


def test_basmala_carries_segments_but_never_a_fragment(
    corpus: TanzilCorpusRepository, tmp_path: Path
) -> None:
    basmala = VerseRef(1, 1)
    text = "Au nom d’Allah, le Tout Miséricordieux, le Très Miséricordieux.[1]"
    document = {
        "schema": "aqr.translation-segments/1",
        "translation_id": "french_test",
        "method": "test",
        "verses": {
            str(basmala): {
                "h": fingerprint(text),
                "w": 4,
                "cuts": [[3, text.index("le Tout"), 0.99], [4, text.index("le Très"), 0.99]],
            }
        },
    }
    (tmp_path / "french_test.json").write_text(json.dumps(document), encoding="utf-8")

    class _Basmala:
        def get(self, ref: VerseRef, translation_id: str) -> Translation:
            return Translation(ref, text, translation_id, "v", "a")

    renderer = HomeRenderer(corpus, _Basmala(), SegmentLibrary(tmp_path))
    translation = _translation(renderer.render_basmala("french_test"))
    assert translation["scope"] == "verse"
    assert "fragment" not in translation
    segments = translation["segments"]
    assert isinstance(segments, list)
    assert [s["words"] for s in segments] == [[1, 2], [3, 3], [4, 4]]
    assert segments[2]["text"] == "le Très Miséricordieux.[1]"
