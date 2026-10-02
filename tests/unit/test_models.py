import pytest

from aqr.domain.models import (
    Detection,
    NonQuranKind,
    NonQuranSpan,
    Riwaya,
    Status,
    Timeline,
    TimeSpan,
    VerseRef,
    WordSpan,
)


# --- VerseRef ------------------------------------------------------------
@pytest.mark.parametrize("s,a", [(1, 1), (2, 286), (114, 6), (55, 78)])
def test_verseref_valide(s, a):  # P1
    assert VerseRef(s, a).surah == s


@pytest.mark.parametrize("s,a", [(0, 1), (115, 1), (1, 8), (1, 0), (114, 7), (2, 287)])
def test_verseref_invalide(s, a):  # F1
    with pytest.raises(ValueError):
        VerseRef(s, a)


def test_verseref_parse_et_str():
    assert VerseRef.parse("2:255") == VerseRef(2, 255)
    assert str(VerseRef(2, 255)) == "2:255"


def test_verseref_next():
    assert VerseRef(67, 4).next() == VerseRef(67, 5)
    assert VerseRef(1, 7).next() == VerseRef(2, 1)
    assert VerseRef(114, 6).next() is None


def test_verseref_ordre_mushaf():
    assert VerseRef(1, 7) < VerseRef(2, 1) < VerseRef(2, 2)


# --- TimeSpan ------------------------------------------------------------
def test_timespan_invalide():  # F2
    with pytest.raises(ValueError):
        TimeSpan(5.0, 3.0)
    with pytest.raises(ValueError):
        TimeSpan(2.0, 2.0)
    with pytest.raises(ValueError):
        TimeSpan(-1.0, 2.0)


def test_timespan_duree():
    assert TimeSpan(1.5, 4.0).duration_s == pytest.approx(2.5)


# --- WordSpan ------------------------------------------------------------
def test_wordspan_invalide():
    with pytest.raises(ValueError):
        WordSpan(VerseRef(1, 1), 0, 2)
    with pytest.raises(ValueError):
        WordSpan(VerseRef(1, 1), 3, 2)


# --- Detection : statut de preuve (I5) -----------------------------------
def _span(s="67:5"):
    return WordSpan(VerseRef.parse(s), 1, 5)


def test_recognized_exige_un_temps_mesure():
    with pytest.raises(ValueError):
        Detection(_span(), None, Status.RECOGNIZED, 0.9)


def test_recognized_peut_avoir_une_frontiere_de_verset_estimee():
    # Un segment qui traverse deux versets : le temps du segment est mesuré, la
    # frontière entre les versets est estimée (ADR-0004).
    d = Detection(_span(), TimeSpan(0, 1), Status.RECOGNIZED, 0.9, time_interpolated=True)
    assert d.time_interpolated


def test_inferred_peut_etre_sans_temps():
    d = Detection(_span(), None, Status.INFERRED, 0.6)
    assert d.status is Status.INFERRED


def test_uncertain_exige_des_candidats():
    with pytest.raises(ValueError):
        Detection(_span("55:13"), TimeSpan(0, 1), Status.UNCERTAIN, 0.5)
    d = Detection(
        _span("55:13"),
        TimeSpan(0, 1),
        Status.UNCERTAIN,
        0.5,
        candidates=(VerseRef(55, 13), VerseRef(55, 16)),
    )
    assert len(d.candidates) == 2


def test_confidence_bornee():
    with pytest.raises(ValueError):
        Detection(_span(), TimeSpan(0, 1), Status.RECOGNIZED, 1.2)


# --- Timeline ------------------------------------------------------------
def test_timeline_filtre_par_statut():
    t = Timeline(
        items=(
            NonQuranSpan(TimeSpan(0, 3), NonQuranKind.FRENCH),
            Detection(_span("67:4"), TimeSpan(3, 6), Status.RECOGNIZED, 0.97),
            Detection(_span("67:5"), None, Status.INFERRED, 0.6),
            Detection(_span("67:6"), TimeSpan(9, 12), Status.RECOGNIZED, 0.95),
        ),
        riwaya=Riwaya.HAFS,
        engine_version="test",
    )
    assert t.verses() == (VerseRef(67, 4), VerseRef(67, 5), VerseRef(67, 6))
    assert t.verses(Status.RECOGNIZED) == (VerseRef(67, 4), VerseRef(67, 6))
    assert t.verses(Status.INFERRED) == (VerseRef(67, 5),)
