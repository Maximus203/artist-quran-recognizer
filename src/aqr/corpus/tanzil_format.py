"""Parseur du format Tanzil « texte avec numéros de verset » (sourate|verset|texte)."""

from __future__ import annotations

from aqr.domain.models import VerseRef


def parse_tanzil_txt(raw: str) -> dict[VerseRef, str]:
    verses: dict[VerseRef, str] = {}
    for line in raw.splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("|", 2)
        if len(parts) != 3:
            continue
        surah_s, ayah_s, text = parts
        verses[VerseRef(int(surah_s), int(ayah_s))] = text
    return verses
