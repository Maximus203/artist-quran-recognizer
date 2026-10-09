"""`assert_matches_corpus` : le texte et la plage rendus par un résultat `aqr.recognition/1`
sont contrôlés contre le corpus, avec la sémantique de `HomeRenderer.span_text` (I1)."""

from __future__ import annotations

import json
import unicodedata
from pathlib import Path
from typing import Any

import pytest
from tests.support import corpus_check
from tests.support.corpus_check import CorpusMismatch, assert_matches_corpus
from tests.support.fakes import FakeCorpus

from aqr.domain.models import Detection, Status, TimeSpan, VerseRef, WordSpan
from aqr.rendering.home_renderer import HomeRenderer

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"
REF = VerseRef(112, 2)  # FakeCorpus : « هَاءٌ وَاوٌ ۖ زَايٌ » = 3 mots + 1 marque de pause


@pytest.fixture()
def repo() -> FakeCorpus:
    return FakeCorpus()


def _verse(
    ref: VerseRef,
    repo: FakeCorpus,
    *,
    words: tuple[int, int] | None = None,
    status: str = "recognized",
    text: str | None = None,
    partial: bool | None = None,
) -> dict[str, Any]:
    total = len(repo.words(ref))
    first, last = words or (1, total)
    return {
        "kind": "verse",
        "ref": str(ref),
        "words": [first, last],
        "partial": (not (first == 1 and last >= total)) if partial is None else partial,
        "status": status,
        "t": [0.0, 1.0],
        "text": _expected(repo, ref, first, last) if text is None else text,
        "translation": None,
    }


def _expected(repo: FakeCorpus, ref: VerseRef, first: int, last: int) -> str:
    detection = Detection(
        span=WordSpan(ref, first, last),
        time=TimeSpan(0.0, 1.0),
        status=Status.RECOGNIZED,
        confidence=1.0,
    )
    return HomeRenderer(repo, None).span_text(detection)  # type: ignore[arg-type]


def _doc(*intervals: dict[str, Any]) -> dict[str, Any]:
    return {"schema": "aqr.recognition/1", "intervals": list(intervals)}


def test_full_and_partial_verses_matching_the_corpus_pass(repo: FakeCorpus) -> None:
    doc = _doc(
        _verse(VerseRef(112, 1), repo),
        _verse(REF, repo, words=(2, 3)),
        _verse(VerseRef(112, 4), repo, status="inferred"),
    )
    report = assert_matches_corpus(doc, repo, surah=112)
    assert report.checked == 3
    assert report.recognized == (VerseRef(112, 1), REF)
    assert report.partial == 1


def test_a_text_altered_by_one_character_is_rejected(repo: FakeCorpus) -> None:
    good = repo.text(VerseRef(112, 1))
    altered = good[:-1] + ("ن" if good[-1] != "ن" else "م")
    doc = _doc(_verse(VerseRef(112, 1), repo, text=altered))
    with pytest.raises(CorpusMismatch, match=r"112:1.*texte"):
        assert_matches_corpus(doc, repo)


def test_a_full_verse_must_equal_the_corpus_text_not_just_be_inside_it(repo: FakeCorpus) -> None:
    truncated = repo.text(VerseRef(112, 1)).rsplit(" ", 1)[0]
    doc = _doc(_verse(VerseRef(112, 1), repo, text=truncated))
    with pytest.raises(CorpusMismatch, match="texte"):
        assert_matches_corpus(doc, repo)


FATHA, KASRA = "\u064e", "\u0650"


def test_a_single_changed_vowel_is_rejected(repo: FakeCorpus) -> None:
    # fatha -> kasra : même squelette consonantique, texte différent (la comparaison est exacte,
    # jamais sur une forme normalisée pour la correspondance : I1)
    good = repo.text(VerseRef(112, 1))
    assert FATHA in good
    altered = good.replace(FATHA, KASRA, 1)
    assert altered != good
    with pytest.raises(CorpusMismatch, match="texte différent"):
        assert_matches_corpus(_doc(_verse(VerseRef(112, 1), repo, text=altered)), repo)
    partial = _expected(repo, REF, 2, 3)
    assert FATHA in partial
    with pytest.raises(CorpusMismatch, match="sous-chaîne"):
        assert_matches_corpus(
            _doc(_verse(REF, repo, words=(2, 3), text=partial.replace(FATHA, KASRA, 1))), repo
        )


@pytest.mark.parametrize("form", ["NFD", "NFKD"])
def test_a_unicode_renormalised_text_is_not_the_corpus_text(repo: FakeCorpus, form: str) -> None:
    good = repo.text(VerseRef(112, 1))
    renormalised = unicodedata.normalize(form, good)
    if renormalised == good:
        pytest.skip(f"{form} ne change pas ce texte")
    with pytest.raises(CorpusMismatch, match="texte différent"):
        assert_matches_corpus(_doc(_verse(VerseRef(112, 1), repo, text=renormalised)), repo)


@pytest.mark.parametrize("words", [(0, 2), (3, 2), (1, 4), (2, 9)])
def test_a_word_range_outside_the_verse_is_rejected(
    repo: FakeCorpus, words: tuple[int, int]
) -> None:
    entry = _verse(REF, repo, text="x", partial=True)
    entry["words"] = list(words)
    with pytest.raises(CorpusMismatch, match=r"plage"):
        assert_matches_corpus(_doc(entry), repo)


def test_a_partial_text_that_is_not_a_substring_of_the_verse_is_rejected(repo: FakeCorpus) -> None:
    doc = _doc(_verse(REF, repo, words=(2, 3), text="كَلِمَةٌ غَرِيبَةٌ"))
    with pytest.raises(CorpusMismatch, match="sous-chaîne"):
        assert_matches_corpus(doc, repo)


def test_a_partial_text_must_match_the_declared_word_range(repo: FakeCorpus) -> None:
    # sous-chaîne exacte du verset, mais celle des mots 1..1 alors que 2..3 sont annoncés
    wrong_window = _expected(repo, REF, 1, 1)
    doc = _doc(_verse(REF, repo, words=(2, 3), text=wrong_window))
    with pytest.raises(CorpusMismatch, match="plage de mots"):
        assert_matches_corpus(doc, repo)


def test_the_partial_flag_must_agree_with_the_word_range(repo: FakeCorpus) -> None:
    doc = _doc(_verse(REF, repo, words=(2, 3), partial=False))
    with pytest.raises(CorpusMismatch, match="partial"):
        assert_matches_corpus(doc, repo)
    doc = _doc(_verse(REF, repo, partial=True))
    with pytest.raises(CorpusMismatch, match="partial"):
        assert_matches_corpus(doc, repo)


def test_complete_recitation_requires_every_verse_to_run_to_its_last_word(
    repo: FakeCorpus,
) -> None:
    short = _doc(_verse(REF, repo, words=(1, 2)))  # 2 mots sur 3
    assert assert_matches_corpus(short, repo).partial == 1  # accepté sans l'exigence
    with pytest.raises(CorpusMismatch, match=r"112:2.*s'arrête au mot 2 sur 3"):
        assert_matches_corpus(short, repo, complete=True)


def test_complete_recitation_requires_verses_to_start_at_word_one(repo: FakeCorpus) -> None:
    late = _doc(_verse(REF, repo, words=(2, 3)))
    assert assert_matches_corpus(late, repo).partial == 1
    with pytest.raises(CorpusMismatch, match=r"112:2.*commence au mot 2"):
        assert_matches_corpus(late, repo, complete=True)


def test_complete_recitation_tolerates_a_missing_basmala_on_the_first_verse_only() -> None:
    # Tanzil place la basmala (4 mots) au début du verset 1 : l'audio d'une sourate n'en a pas
    # forcément. Mesuré sur 112:1 : mots 5..8 sur 8.
    first = VerseRef(112, 1)
    eight = FakeCorpus({first: "أَلِفٌ بَاءٌ جِيمٌ دَالٌ هَاءٌ وَاوٌ زَايٌ حَاءٌ"})
    assert len(eight.words(first)) == 8
    for words in ((1, 8), (5, 8)):
        entry = _verse(first, eight, words=words)
        assert assert_matches_corpus(_doc(entry), eight, complete=True).checked == 1
    for words in ((3, 8), (6, 8), (5, 7)):
        with pytest.raises(CorpusMismatch, match="112:1"):
            assert_matches_corpus(_doc(_verse(first, eight, words=words)), eight, complete=True)


def test_a_verse_from_another_surah_is_rejected(repo: FakeCorpus) -> None:
    # I3 : nommer un faux verset est pire que n'en nommer aucun.
    other = FakeCorpus({VerseRef(113, 1): "بَاءٌ جِيمٌ"})
    doc = _doc(_verse(VerseRef(113, 1), other))
    with pytest.raises(CorpusMismatch, match=r"113:1.*sourate 112"):
        assert_matches_corpus(doc, other, surah=112)


def test_success_requires_a_recognized_verse(repo: FakeCorpus) -> None:
    inferred_only = _doc(_verse(REF, repo, status="inferred"))
    with pytest.raises(CorpusMismatch, match="RECOGNIZED"):
        assert_matches_corpus(inferred_only, repo)
    # hors assertion de succès (min_recognized=0), le texte déduit reste contrôlé
    assert assert_matches_corpus(inferred_only, repo, min_recognized=0).recognized == ()
    wrong = _doc(_verse(REF, repo, status="inferred", text="faux"))
    with pytest.raises(CorpusMismatch, match="texte"):
        assert_matches_corpus(wrong, repo, min_recognized=0)


def test_an_uncertain_verse_never_carries_text_or_translation(repo: FakeCorpus) -> None:
    uncertain = _verse(REF, repo, status="uncertain")
    uncertain["ref"] = None
    uncertain["candidates"] = ["112:1", "112:2"]
    recognized = _verse(VerseRef(112, 1), repo)
    with pytest.raises(CorpusMismatch, match="UNCERTAIN"):
        assert_matches_corpus(_doc(recognized, uncertain), repo)
    uncertain["text"] = None
    assert assert_matches_corpus(_doc(recognized, uncertain), repo).checked == 1
    uncertain["translation"] = {"text": "x"}
    with pytest.raises(CorpusMismatch, match="UNCERTAIN"):
        assert_matches_corpus(_doc(recognized, uncertain), repo)


def test_unknown_reference_or_status_is_rejected(repo: FakeCorpus) -> None:
    entry = _verse(REF, repo)
    entry["ref"] = "112:9"
    with pytest.raises(CorpusMismatch, match="112:9"):
        assert_matches_corpus(_doc(entry), repo)
    entry = _verse(REF, repo)
    entry["status"] = "maybe"
    with pytest.raises(CorpusMismatch, match="statut"):
        assert_matches_corpus(_doc(entry), repo)


@pytest.mark.parametrize("ref", [VerseRef(112, 1), VerseRef(112, 2), VerseRef(112, 3)])
def test_every_window_agrees_with_home_renderer_span_text(repo: FakeCorpus, ref: VerseRef) -> None:
    total = len(repo.words(ref))
    for first in range(1, total + 1):
        for last in range(first, total + 1):
            entry = _verse(ref, repo, words=(first, last))
            assert assert_matches_corpus(_doc(entry), repo).checked == 1


@pytest.mark.skipif(
    not (CORPUS_DIR / "LOCK.json").exists(), reason="corpus non téléchargé (fetch_corpus.py)"
)
@pytest.mark.parametrize("ref", [VerseRef(112, 1), VerseRef(112, 4), VerseRef(2, 255)])
def test_every_window_agrees_with_home_renderer_on_the_real_corpus(ref: VerseRef) -> None:
    real = corpus_check.load_repository(CORPUS_DIR)
    total = len(real.words(ref))
    for first in range(1, total + 1):
        for last in range(first, total + 1):
            detection = Detection(
                WordSpan(ref, first, last), TimeSpan(0.0, 1.0), Status.RECOGNIZED, 1.0
            )
            entry = {
                "kind": "verse",
                "ref": str(ref),
                "words": [first, last],
                "partial": not (first == 1 and last >= total),
                "status": "recognized",
                "text": HomeRenderer(real, None).span_text(detection),  # type: ignore[arg-type]
            }
            assert assert_matches_corpus(_doc(entry), real, surah=ref.surah).checked == 1


def test_cli_returns_one_and_names_the_problem(
    repo: FakeCorpus,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(corpus_check, "load_repository", lambda _dir: repo)
    good, bad = tmp_path / "good.json", tmp_path / "bad.json"
    good.write_text(json.dumps(_doc(_verse(REF, repo))), encoding="utf-8")
    bad.write_text(json.dumps(_doc(_verse(REF, repo, text="faux"))), encoding="utf-8")
    argv = ["--corpus-dir", str(tmp_path), "--surah", "112"]
    assert corpus_check.main([*argv, str(good)]) == 0
    assert "OK" in capsys.readouterr().out
    assert corpus_check.main([*argv, str(bad)]) == 1
    assert "texte" in capsys.readouterr().err
    short = tmp_path / "short.json"
    short.write_text(json.dumps(_doc(_verse(REF, repo, words=(1, 2)))), encoding="utf-8")
    assert corpus_check.main([*argv, str(short)]) == 0
    assert corpus_check.main([*argv, "--complete", str(short)]) == 1
    assert "s'arrête" in capsys.readouterr().err
