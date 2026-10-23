"""Écrivains de sous-titres : SRT, WebVTT et ASS, à partir d'une liste de `Cue`.

Un seul rendu pour `aqr recognize --format srt,vtt` et `aqr export-subtitles` (jamais deux). Ce
module ne connaît ni le corpus ni les décisions : il met en forme des lignes déjà construites. Le
texte arabe qu'on lui donne vient du corpus (I1), la traduction de QuranEnc sans modification (I2).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from aqr.domain.models import TimeSpan

RLE: Final = "\u202b"
"""RIGHT-TO-LEFT EMBEDDING : encadre la ligne arabe dans un lecteur qui n'applique pas l'algorithme
bidirectionnel au sous-titre entier."""
PDF: Final = "\u202c"
"""POP DIRECTIONAL FORMATTING : ferme l'encadrement ouvert par `RLE`."""


def format_timestamp(seconds: float, decimal_sep: str) -> str:
    total_ms = round(seconds * 1000)
    hours, total_ms = divmod(total_ms, 3_600_000)
    minutes, total_ms = divmod(total_ms, 60_000)
    secs, millis = divmod(total_ms, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{decimal_sep}{millis:03d}"


def format_interval(start_s: float, end_s: float, decimal_sep: str) -> str:
    """`HH:MM:SS,mmm --> HH:MM:SS,mmm` (SRT : virgule ; WebVTT : point)."""
    start = format_timestamp(start_s, decimal_sep)
    return f"{start} --> {format_timestamp(end_s, decimal_sep)}"


def format_range(time: TimeSpan, decimal_sep: str) -> str:
    return format_interval(time.start_s, time.end_s, decimal_sep)


_ARABIC_STYLE: Final = "Arabic"
_TRANSLATION_STYLE: Final = "Translation"


@dataclass(frozen=True)
class CueWord:
    """Un mot arabe du sous-titre et son temps (karaoké ASS) ; `text` garde les signes de pause."""

    text: str
    start_s: float
    end_s: float


@dataclass(frozen=True)
class Cue:
    start_s: float
    end_s: float
    arabic: str | None = None
    translation: tuple[str, ...] = ()
    reference: str | None = None
    words: tuple[CueWord, ...] = ()
    """Temps des mots, dans l'ordre : seulement s'ils couvrent exactement `arabic` (karaoké)."""

    def lines(self, *, rtl: bool) -> list[str]:
        out: list[str] = []
        if self.reference:
            out.append(self.reference)
        if self.arabic:
            out.append(f"{RLE}{self.arabic}{PDF}" if rtl else self.arabic)
        out.extend(self.translation)
        return out


def write_srt(cues: Sequence[Cue], *, rtl: bool) -> str:
    blocks = [
        f"{n}\n{format_interval(cue.start_s, cue.end_s, ',')}\n"
        + "\n".join(cue.lines(rtl=rtl))
        + "\n"
        for n, cue in enumerate(cues, start=1)
    ]
    return "\n".join(blocks)


def write_vtt(cues: Sequence[Cue], *, rtl: bool, note: str | None = None) -> str:
    blocks = ["WEBVTT\n"]
    if note:
        blocks.append("NOTE\n" + note + "\n")
    blocks.extend(
        f"{format_interval(cue.start_s, cue.end_s, '.')}\n" + "\n".join(cue.lines(rtl=rtl)) + "\n"
        for cue in cues
    )
    return "\n".join(blocks)


def format_ass_time(seconds: float) -> str:
    """`H:MM:SS.cc` (centièmes), le format de l'ASS."""
    total = round(max(0.0, seconds) * 100)
    hours, total = divmod(total, 360_000)
    minutes, total = divmod(total, 6_000)
    secs, cs = divmod(total, 100)
    return f"{hours}:{minutes:02d}:{secs:02d}.{cs:02d}"


def _ass_text(text: str) -> str:
    return text.replace("{", "\\{").replace("}", "\\}").replace("\n", "\\N")


def _karaoke(cue: Cue) -> str:
    """`{\\k<cs>}mot ` pour chaque mot ; une pause entre deux mots (ou avant le premier) devient un
    `{\\k}` vide. Les bornes sont arrondies une fois depuis le début du sous-titre : pas de
    dérive."""
    pieces: list[str] = []
    cursor = 0
    for index, word in enumerate(cue.words):
        begin = max(cursor, round((word.start_s - cue.start_s) * 100))
        end = max(begin, round((word.end_s - cue.start_s) * 100))
        if begin > cursor:
            pieces.append(f"{{\\k{begin - cursor}}}")
        separator = " " if index < len(cue.words) - 1 else ""
        pieces.append(f"{{\\k{end - begin}}}{_ass_text(word.text)}{separator}")
        cursor = end
    return "".join(pieces)


_ASS_STYLE_FIELDS: Final = (
    "Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, "
    "Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
    "Alignment, MarginL, MarginR, MarginV, Encoding"
)
_ASS_COLOURS: Final = "&H00FFFFFF,&H0000D7FF,&H00000000,&H80000000"
_ASS_SHAPE: Final = "0,0,0,0,100,100,0,0,1"


def _ass_header(comments: str, font: str) -> str:
    return (
        "[Script Info]\n"
        f"{comments}ScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\n"
        "ScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        f"Format: {_ASS_STYLE_FIELDS}\n"
        f"Style: {_ARABIC_STYLE},{font},72,{_ASS_COLOURS},{_ASS_SHAPE},3,1,2,60,60,150,1\n"
        f"Style: {_TRANSLATION_STYLE},Arial,44,&H00E6E6E6,&H00E6E6E6,&H00000000,&H80000000,"
        f"{_ASS_SHAPE},2,1,2,60,60,50,1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )


def write_ass(cues: Sequence[Cue], *, font: str, karaoke: bool, note: str | None = None) -> str:
    comments = "".join(f"; {line}\n" for line in note.splitlines()) if note else ""
    out = [_ass_header(comments, font)]
    for cue in cues:
        start, end = format_ass_time(cue.start_s), format_ass_time(cue.end_s)
        if cue.arabic:
            body = _karaoke(cue) if karaoke and cue.words else _ass_text(cue.arabic)
            out.append(f"Dialogue: 0,{start},{end},{_ARABIC_STYLE},,0,0,0,,{body}\n")
        lines = ([cue.reference] if cue.reference else []) + list(cue.translation)
        if lines:
            text = _ass_text("\n".join(lines))
            out.append(f"Dialogue: 0,{start},{end},{_TRANSLATION_STYLE},,0,0,0,,{text}\n")
    return "".join(out)
