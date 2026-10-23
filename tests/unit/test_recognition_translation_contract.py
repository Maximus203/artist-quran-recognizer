"""Contrat de sortie `aqr.recognition/1` : `translation.segments` / `translation.fragment`.

Le lecteur (indépendant du moteur) accepte la sortie du renderer, reste lisible sur l'ancienne
forme (sans segments) et refuse tout ce qui romprait I2 ou les plages de mots."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.domain.models import Detection, Status, TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import Translation
from aqr.eval.recognition import (
    RecognitionError,
    VerseInterval,
    parse_intervals,
)
from aqr.rendering.home_renderer import HomeRenderer
from aqr.rendering.translation_segments import SegmentLibrary, fingerprint

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"
REF = VerseRef(11, 61)
TEXT = "Un deux trois quatre. Cinq six sept huit.  Neuf dix onze douze ! Treize quatorze[1] quinze."
CUTS = [
    [10, TEXT.index("Cinq"), 0.99],
    [20, TEXT.index("Neuf"), 0.98],
    [24, TEXT.index("Treize"), 0.97],
]


class _Translations:
    def get(self, ref: VerseRef, translation_id: str) -> Translation:
        return Translation(ref, TEXT, translation_id, "v-test", "attribution-test")


def _interval(first: int, last: int, library: SegmentLibrary | None) -> dict[str, object]:
    corpus = TanzilCorpusRepository(CORPUS_DIR)
    renderer = HomeRenderer(corpus, _Translations(), library)
    det = Detection(
        span=WordSpan(REF, first, last),
        time=TimeSpan(1.0, 5.0),
        status=Status.RECOGNIZED,
        confidence=0.9,
    )
    item = renderer.render_item(det, "french_test")
    return {
        "kind": "verse",
        "ref": item["ref"],
        "words": item["words"],
        "status": item["status"],
        "t": [1.0, 5.0],
        "translation": item["translation"],
    }


@pytest.fixture()
def library(tmp_path: Path) -> SegmentLibrary:
    document = {
        "schema": "aqr.translation-segments/1",
        "translation_id": "french_test",
        "method": "test",
        "verses": {str(REF): {"h": fingerprint(TEXT), "w": 27, "cuts": CUTS}},
    }
    (tmp_path / "french_test.json").write_text(json.dumps(document), encoding="utf-8")
    return SegmentLibrary(tmp_path)


pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "quran-uthmani.txt").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)


def _parse(interval: dict[str, object]) -> VerseInterval:
    (parsed,) = parse_intervals([interval])
    assert isinstance(parsed, VerseInterval)
    return parsed


def test_renderer_output_is_readable_with_fragment_and_segments(library: SegmentLibrary) -> None:
    parsed = _parse(_interval(10, 19, library))
    translation = parsed.translation
    assert translation is not None
    assert translation.scope == "fragment"
    assert translation.text == TEXT
    assert [(s.first_word, s.last_word) for s in translation.segments] == [
        (1, 9),
        (10, 19),
        (20, 23),
        (24, 27),
    ]
    assert translation.fragment is not None
    assert (translation.fragment.first_word, translation.fragment.last_word) == (10, 19)
    assert translation.fragment.text == "Cinq six sept huit."
    assert translation.fragment.ellipsis_before and translation.fragment.ellipsis_after
    assert not translation.fragment.approximate


def test_legacy_output_without_segments_stays_readable() -> None:
    legacy = _interval(10, 19, None)
    parsed = _parse(legacy)
    assert parsed.translation is not None
    assert parsed.translation.scope == "verse"
    assert parsed.translation.segments == ()
    assert parsed.translation.fragment is None


def test_verse_without_translation_is_readable() -> None:
    interval = _interval(10, 19, None)
    interval["translation"] = None
    assert _parse(interval).translation is None


def _mutated(library: SegmentLibrary, mutate) -> dict[str, object]:  # type: ignore[no-untyped-def]
    interval = copy.deepcopy(_interval(10, 19, library))
    mutate(interval["translation"])
    return interval


@pytest.mark.parametrize(
    "mutate",
    [
        lambda t: t["segments"].pop(1),  # trou dans les plages de mots
        lambda t: t["segments"][1].update(
            text="Autre texte"
        ),  # I2 : les tranches changent le texte
        lambda t: t["fragment"].update(words=[11, 19]),  # le fragment ne suit pas les frontières
        lambda t: t["fragment"].update(text="Cinq six"),  # le fragment n'est pas la jonction
        lambda t: t.update(scope="verse"),  # fragment présent, scope verset
        lambda t: t.update(scope="partout"),  # scope inconnu
        lambda t: t["fragment"].update(approximate="oui"),  # drapeau non booléen
        lambda t: t.pop("fragment"),  # scope fragment sans fragment
    ],
)
def test_incoherent_translation_is_refused(library: SegmentLibrary, mutate) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(RecognitionError):
        _parse(_mutated(library, mutate))
