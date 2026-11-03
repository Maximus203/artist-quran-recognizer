"""Texte de traduction affiché dans un sous-titre : QuranEnc tel que livré, jamais réécrit (I2).

Seules décorations permises, toutes à l'affichage : les points de suspension aux bords d'un
fragment (comme l'atelier), et — option explicite, décochée par défaut — le retrait des renvois de
note `[1]` (un écart assumé à I2, voir ADR-0014).
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any, Final, Protocol

from aqr.domain.models import VerseRef

_NOTE_MARK: Final = re.compile(r"\s*\[\d+\]")


def strip_note_marks(text: str) -> str:
    """Retire les renvois de note `[1]` (option explicite : écart assumé à I2, ADR-0014)."""
    return _NOTE_MARK.sub("", text)


class TranslationSource(Protocol):
    """Traduction QuranEnc d'un passage (le JSON de `HomeRenderer.translation_json`), ou None."""

    def passage(self, ref: VerseRef, words: tuple[int, int] | None) -> Mapping[str, Any] | None: ...


def translation_text(
    translation: Mapping[str, Any] | None, *, scope: str | None = None, strip_notes: bool = False
) -> str | None:
    """Le texte à afficher : le fragment qui suit l'arabe affiché si le moteur l'a jugé fiable,
    sinon le verset entier ; `scope` force `verse`, `fragment` ou `none` (décision humaine)."""
    if translation is None or scope == "none":
        return None
    fragment = translation.get("fragment")
    use_fragment = (
        scope != "verse"
        and (scope == "fragment" or translation.get("scope") == "fragment")
        and isinstance(fragment, Mapping)
        and isinstance(fragment.get("text"), str)
    )
    if use_fragment:
        assert isinstance(fragment, Mapping)
        text = str(fragment["text"])
        if fragment.get("ellipsis_before"):
            text = "… " + text
        if fragment.get("ellipsis_after"):
            text = text + " …"
    else:
        raw = translation.get("text")
        text = raw if isinstance(raw, str) else ""
    if strip_notes:
        text = strip_note_marks(text)
    return text or None


def wrap_lines(text: str, width: int) -> tuple[str, ...]:
    """Coupe aux espaces en lignes d'au plus `width` signes (un mot plus long reste entier) ; le
    texte rejoint par des espaces redonne l'original."""
    lines: list[str] = []
    current = ""
    for word in text.split():
        if current and len(current) + 1 + len(word) > width:
            lines.append(current)
            current = word
        else:
            current = f"{current} {word}" if current else word
    if current:
        lines.append(current)
    return tuple(lines)
