"""Courbe de dégradation : fichiers, vérité, enregistrements, résumés (partie pure)."""

from __future__ import annotations

from pathlib import Path
from typing import ClassVar

import pytest

from aqr.domain.models import VerseRef
from aqr.eval.degradation_curve import (
    SELECTION,
    FileScore,
    ScoreRecord,
    TruthVerse,
    ascii_bar,
    file_id,
    load_scores,
    parse_for_scoring,
    reference_words_for_file,
    summarize,
    truth_from_durations,
)
from aqr.eval.recognition import RecognitionError, VerseInterval


def truth(*items: tuple[str, float, float]) -> list[TruthVerse]:
    return [TruthVerse(VerseRef.parse(r), a, b) for r, a, b in items]


def fs(expected: int, recognized: int) -> FileScore:
    return FileScore(
        expected=expected,
        recognized=recognized,
        located=recognized,
        inferred=0,
        uncertain=0,
        missed=expected - recognized,
        false_recognized=0,
        false_inferred=0,
        misplaced=0,
        abstentions=0,
        abstention_s=0.0,
    )


def test_selection_trois_recitants_trois_fichiers_chacun() -> None:
    assert len(SELECTION) == 9
    assert len({file_id(r, s) for r, s in SELECTION}) == 9
    by_reciter: dict[str, int] = {}
    for reciter, _surah in SELECTION:
        by_reciter[reciter] = by_reciter.get(reciter, 0) + 1
    assert sorted(by_reciter.values()) == [3, 3, 3]


def test_identifiant_de_fichier() -> None:
    assert file_id("Alafasy_128kbps", 67) == "Alafasy-067"
    assert file_id("Abdul_Basit_Murattal_192kbps", 7) == "Abdul_Basit-007"


def test_verite_cumule_les_durees_des_clips_sans_trou() -> None:
    items = truth_from_durations(112, [3.0, 2.5, 4.0, 1.5])
    assert [str(t.ref) for t in items] == ["112:1", "112:2", "112:3", "112:4"]
    assert (items[0].start_s, items[0].end_s) == (0.0, 3.0)
    assert (items[2].start_s, items[2].end_s) == (5.5, 9.5)
    with pytest.raises(ValueError):
        truth_from_durations(112, [1.0, 1.0])  # 112 a 4 versets


class Words:
    table: ClassVar[dict[VerseRef, tuple[str, ...]]] = {
        VerseRef(114, 1): ("b1", "b2", "b3", "b4", "w5", "w6"),
        VerseRef(114, 2): ("w7", "w8"),
        VerseRef(1, 1): ("b1", "b2", "b3", "b4"),
        VerseRef(9, 1): ("t1", "t2", "t3"),
    }

    def words(self, ref: VerseRef) -> tuple[str, ...]:
        return self.table[ref]


def test_texte_de_reference_ecarte_la_basmala_que_le_clip_ne_dit_pas() -> None:
    # le clip du verset 1 ne contient pas la basmala (sauf Al-Fatiha : elle EST le verset)
    ref = reference_words_for_file(truth(("114:1", 0, 5), ("114:2", 5, 9)), Words())
    assert ref == ("w5", "w6", "w7", "w8")
    assert reference_words_for_file(truth(("1:1", 0, 5)), Words()) == ("b1", "b2", "b3", "b4")
    assert reference_words_for_file(truth(("9:1", 0, 5)), Words()) == ("t1", "t2", "t3")


def record(condition: str, name: str, expected: int, hit: int, **kw: float) -> ScoreRecord:
    return ScoreRecord(
        condition=condition,
        mode="solo",
        file=name,
        audio_sha256="x",
        audio_s=kw.get("audio_s", 60.0),
        wall_s=kw.get("wall_s", 6.0),
        score=fs(expected, hit),
        word_errors=int(kw.get("we", 0)),
        word_total=int(kw.get("wt", 0)),
        letter_errors=int(kw.get("le", 0)),
        letter_total=int(kw.get("lt", 0)),
    )


def test_enregistrement_aller_retour_json(tmp_path: Path) -> None:
    original = record("mp3_48k", "Alafasy-067", 30, 28, we=3, wt=300, le=10, lt=1500)
    folder = tmp_path / "mp3_48k" / "solo"
    folder.mkdir(parents=True)
    (folder / "Alafasy-067.score.json").write_text(original.to_json(), encoding="utf-8")
    loaded = load_scores(tmp_path, "solo")
    assert loaded["mp3_48k"]["Alafasy-067"] == original
    assert load_scores(tmp_path, "cascade") == {}


def test_resume_somme_les_comptes_le_wer_et_le_temps() -> None:
    rows = [
        record("c", "a", 30, 30, audio_s=100, wall_s=10, we=2, wt=200, le=5, lt=1000),
        record("c", "b", 10, 5, audio_s=50, wall_s=15, we=8, wt=100, le=20, lt=500),
    ]
    summary = summarize(rows)
    assert summary.score.expected == 40 and summary.score.recognized == 35
    assert summary.wer == pytest.approx(10 / 300)
    assert summary.cer == pytest.approx(25 / 1500)
    assert summary.rtf == pytest.approx(25 / 150)
    assert summary.recall_ci[0] < 35 / 40 < summary.recall_ci[1]
    assert summary.per_file_recall == {"a": 1.0, "b": 0.5}


def test_resume_sans_transcription_n_invente_pas_de_wer() -> None:
    summary = summarize([record("c", "a", 3, 3)])
    assert summary.wer is None and summary.cer is None


def test_barre_ascii() -> None:
    assert ascii_bar(1.0, width=10) == "██████████"
    assert ascii_bar(0.5, width=10) == "█████░░░░░"
    assert ascii_bar(0.0, width=4) == "░░░░"
    assert ascii_bar(None, width=4) == "    "


# --- sortie du moteur refusée par le lecteur ------------------------------------------------------


def _document(word_times: list[list[float]], status: str = "recognized") -> dict[str, object]:
    return {
        "schema": "aqr.recognition/1",
        "intervals": [
            {
                "kind": "verse",
                "ref": "112:1",
                "words": [1, 2],
                "status": status,
                "t": [0.0, 2.0],
                "word_times": word_times,
                "word_times_source": "interpolated",
            }
        ],
    }


def test_une_sortie_valide_est_lue_sans_note() -> None:
    recognition, note = parse_for_scoring(_document([[0.0, 1.0], [1.0, 2.0]]))
    assert note == "" and len(recognition.intervals) == 1


def test_des_temps_de_mots_qui_se_chevauchent_sont_notes_sans_perdre_le_verset() -> None:
    recognition, note = parse_for_scoring(_document([[0.0, 1.2], [1.0, 2.0]]))
    assert "chevauche" in note
    interval = recognition.intervals[0]
    assert isinstance(interval, VerseInterval) and interval.ref == VerseRef(112, 1)


def test_une_sortie_autrement_invalide_reste_une_erreur() -> None:
    with pytest.raises(RecognitionError):
        parse_for_scoring(_document([[0.0, 1.0], [1.0, 2.0]], status="inventé"))
