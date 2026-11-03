"""Écrivains de sous-titres (SRT, WebVTT, ASS) : un seul rendu, partagé par `aqr recognize` et
`aqr export-subtitles`. Aucun corpus ici : les textes sont des chaînes quelconques."""

from __future__ import annotations

import pytest

from aqr.rendering.subtitles import (
    PDF,
    RLE,
    Cue,
    CueWord,
    format_ass_time,
    write_ass,
    write_srt,
    write_vtt,
)

AR = "نص عربي"
CUES = [
    Cue(1.0, 4.5, arabic="un deux trois", translation=("Première ligne", "Deuxième ligne")),
    Cue(5.0, 6.25, arabic=None, translation=("Traduction seule",)),
]


def test_srt_blocs_numerotes_separes_par_une_ligne_vide() -> None:
    srt = write_srt(CUES, rtl=False)
    assert srt == (
        "1\n00:00:01,000 --> 00:00:04,500\nun deux trois\nPremière ligne\nDeuxième ligne\n"
        "\n"
        "2\n00:00:05,000 --> 00:00:06,250\nTraduction seule\n"
    )


def test_srt_vide() -> None:
    assert write_srt([], rtl=False) == ""


def test_rtl_encadre_la_ligne_arabe_seule() -> None:
    srt = write_srt([Cue(0.0, 1.0, arabic=AR, translation=("fr",))], rtl=True)
    assert f"{RLE}{AR}{PDF}\nfr" in srt


def test_la_reference_est_une_ligne_a_part_avant_l_arabe() -> None:
    cue = Cue(0.0, 1.0, arabic="ar", translation=("fr",), reference="2:255")
    assert write_srt([cue], rtl=False).splitlines()[2:5] == ["2:255", "ar", "fr"]


def test_vtt_entete_note_d_attribution_et_point_decimal() -> None:
    vtt = write_vtt(CUES, rtl=False, note="Texte coranique : Tanzil.\nTraduction : QuranEnc.")
    assert vtt.startswith("WEBVTT\n\nNOTE\nTexte coranique : Tanzil.\nTraduction : QuranEnc.\n\n")
    assert "00:00:01.000 --> 00:00:04.500\nun deux trois" in vtt


def test_vtt_sans_note() -> None:
    assert write_vtt([], rtl=False).startswith("WEBVTT\n")
    assert "NOTE" not in write_vtt(CUES, rtl=False)


@pytest.mark.parametrize(
    ("seconds", "text"),
    [(0, "0:00:00.00"), (1.234, "0:00:01.23"), (61.999, "0:01:02.00"), (3725.5, "1:02:05.50")],
)
def test_temps_ass_en_centiemes(seconds: float, text: str) -> None:
    assert format_ass_time(seconds) == text


def test_ass_karaoke_mot_a_mot_avec_pauses() -> None:
    cue = Cue(
        10.0,
        13.0,
        arabic="a b c",
        translation=("fr",),
        words=(CueWord("a", 10.2, 11.0), CueWord("b", 11.0, 12.0), CueWord("c", 12.5, 13.0)),
    )
    ass = write_ass([cue], font="Amiri Quran", karaoke=True, note="Attribution")
    assert "; Attribution" in ass
    assert "Style: Arabic,Amiri Quran," in ass
    # 0,2 s avant le premier mot, 0,8 s, 1 s, 0,5 s de pause puis 0,5 s
    assert (
        "Dialogue: 0,0:00:10.00,0:00:13.00,Arabic,,0,0,0,,{\\k20}{\\k80}a {\\k100}b {\\k50}{\\k50}c"
        in ass
    )
    assert "Dialogue: 0,0:00:10.00,0:00:13.00,Translation,,0,0,0,,fr" in ass


def test_ass_sans_karaoke_ecrit_le_texte_tel_quel() -> None:
    cue = Cue(
        0.0,
        2.0,
        arabic="a b",
        translation=(),
        words=(CueWord("a", 0.0, 1.0), CueWord("b", 1.0, 2.0)),
    )
    ass = write_ass([cue], font="Amiri Quran", karaoke=False)
    assert ",Arabic,,0,0,0,,a b\n" in ass and "\\k" not in ass


def test_ass_echappe_les_accolades_et_les_retours_a_la_ligne() -> None:
    cue = Cue(0.0, 1.0, arabic=None, translation=("avant {gras} après", "suite"))
    ass = write_ass([cue], font="Amiri Quran", karaoke=False)
    assert "avant \\{gras\\} après\\Nsuite" in ass
