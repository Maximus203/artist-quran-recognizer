"""Construction des scénarios de simulation : vérité terrain calculée, mots d'ASR en cache."""

from __future__ import annotations

import math
from array import array
from pathlib import Path

import pytest

from aqr.domain.models import TimeSpan, VerseRef
from aqr.domain.ports import TranscribedWord
from aqr.live.corpus_flow import make_skeleton
from aqr.live.replay import ArrivalModel
from aqr.live.scenarios import (
    Piece,
    layout,
    load_words,
    save_words,
    scenario_from_words,
    speech_bounds,
)
from aqr.live.simulation import TruthVerse, TruthZone


def tone(seconds: float, rate: int = 16000, amplitude: float = 0.5) -> list[float]:
    return [
        amplitude * math.sin(2 * math.pi * 220 * i / rate) for i in range(round(seconds * rate))
    ]


def test_la_parole_est_bornee_par_l_energie_pas_par_le_fichier() -> None:
    rate = 16000
    samples = array("f", [0.0] * (rate // 2) + tone(1.0) + [0.0] * rate)
    start, end = speech_bounds(samples, rate)
    assert start == pytest.approx(0.5, abs=0.05)
    assert end == pytest.approx(1.5, abs=0.05)


def test_un_signal_muet_n_a_pas_de_parole() -> None:
    assert speech_bounds(array("f", [0.0] * 16000), 16000) is None
    assert speech_bounds(array("f"), 16000) is None


def test_un_bruit_de_fond_faible_est_ignore() -> None:
    rate = 16000
    noise = tone(0.5, amplitude=0.005)
    samples = array("f", noise + tone(1.0) + noise)
    start, end = speech_bounds(samples, rate)
    assert start == pytest.approx(0.5, abs=0.05)
    assert end == pytest.approx(1.5, abs=0.05)


def test_la_mise_en_page_cumule_les_durees_et_les_pauses() -> None:
    pieces = [
        Piece.verse(VerseRef(112, 1), duration_s=3.0, speech=(0.2, 2.6)),
        Piece.gap(0.4),
        Piece.verse(VerseRef(112, 2), duration_s=2.0, speech=(0.1, 1.8)),
        Piece.zone("french", duration_s=5.0, speech=(0.0, 5.0)),
    ]
    verses, zones, total = layout(pieces)
    assert verses == [
        TruthVerse(VerseRef(112, 1), pytest.approx(0.2), pytest.approx(2.6)),
        TruthVerse(VerseRef(112, 2), pytest.approx(3.5), pytest.approx(5.2)),
    ]
    assert zones == [TruthZone(pytest.approx(5.4), pytest.approx(10.4), "french")]
    assert total == pytest.approx(10.4)


def test_une_piece_sans_parole_ne_donne_aucune_verite() -> None:
    verses, zones, total = layout([Piece.verse(VerseRef(112, 1), 3.0, None), Piece.gap(1.0)])
    assert verses == [] and zones == [] and total == pytest.approx(4.0)


def test_les_mots_d_asr_survivent_a_un_aller_retour_sur_disque(tmp_path: Path) -> None:
    words = [
        TranscribedWord("قُلْ", TimeSpan(0.4, 0.9), 0.93),
        TranscribedWord("هُوَ", TimeSpan(1.0, 1.3), 0.5),
    ]
    path = tmp_path / "sample.words.json"
    save_words(path, words, engine="muno@x", audio_s=3.2)
    loaded, engine, audio_s = load_words(path)
    assert loaded == words
    assert engine == "muno@x" and audio_s == pytest.approx(3.2)


def test_un_fichier_de_mots_illisible_est_refuse(tmp_path: Path) -> None:
    path = tmp_path / "bad.words.json"
    path.write_text('{"schema": "autre"}', encoding="utf-8")
    with pytest.raises(ValueError):
        load_words(path)


def test_un_scenario_date_les_mots_et_porte_la_verite() -> None:
    words = [
        TranscribedWord("قُلْ", TimeSpan(0.4, 0.9), 0.9),
        TranscribedWord("هُوَ", TimeSpan(1.0, 1.3), 0.9),
    ]
    verses = [TruthVerse(VerseRef(112, 1), 0.3, 2.5)]
    scenario = scenario_from_words(
        "seq-1",
        "everyayah",
        words,
        make_skeleton({}),
        ArrivalModel(block_s=1.0, settle_s=0.0),
        verses=verses,
        zones=[],
        duration_s=3.0,
    )
    assert scenario.id == "seq-1" and scenario.source == "everyayah"
    assert [w.arrival_s for w in scenario.words] == [1.0, 2.0]
    assert scenario.verses == tuple(verses)
    assert scenario.duration_s == 3.0
