"""Options d'un export de sous-titres : valeurs par défaut, lecture depuis un objet JSON.

Les défauts sont ceux de `docs/design/export-sous-titres.md` §7. Rien n'est en dur ailleurs : le
moteur d'export lit ses réglages ici, et l'atelier envoie le même objet.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Final

FORMATS: Final = ("srt", "vtt", "ass", "json")
CONTENTS: Final = ("ar_fr", "ar", "fr")
FORMULAS: Final = ("istiadha", "basmala", "takbir", "amin")
POLICIES: Final = ("omit", "marker", "first")
REPETITIONS: Final = ("keep", "merge")
ASS_FONTS: Final = ("Amiri Quran", "Scheherazade New", "Noto Naskh Arabic")
"""Polices arabes proposées pour l'ASS : toutes sous licence OFL. KFGQPC (Hafs) n'y est pas : sa
licence interdit la redistribution."""

DEFAULT_TRANSLATION: Final = "french_hameedullah"


class OptionsError(ValueError):
    """Option inconnue ou hors bornes (message en français)."""


@dataclass(frozen=True)
class ExportOptions:
    format: str = "srt"
    content: str = "ar_fr"
    formulas: frozenset[str] = field(default_factory=lambda: frozenset({"basmala"}))
    repetitions: str = "keep"
    min_s: float = 1.0
    max_s: float = 7.0
    line_chars: int = 42
    offset_ms: int = 0
    rtl: bool = True
    strip_notes: bool = False
    show_ref: bool = False
    bom: bool = False
    karaoke: bool = True
    font: str = "Amiri Quran"
    policy: str = "omit"
    allow_unresolved: bool = False
    translation_id: str = DEFAULT_TRANSLATION

    @property
    def with_arabic(self) -> bool:
        return "ar" in self.content

    @property
    def with_translation(self) -> bool:
        return "fr" in self.content


def _choice(raw: Mapping[str, Any], key: str, allowed: tuple[str, ...], default: str) -> str:
    value = raw.get(key, default)
    if value not in allowed:
        raise OptionsError(f"{key} : « {value} » inconnu (permis : {', '.join(allowed)})")
    return str(value)


def _number(raw: Mapping[str, Any], key: str, default: float, low: float, high: float) -> float:
    value = raw.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int | float) or not low <= value <= high:
        raise OptionsError(f"{key} : nombre entre {low} et {high} attendu")
    return float(value)


def _flag(raw: Mapping[str, Any], key: str, default: bool) -> bool:
    value = raw.get(key, default)
    if not isinstance(value, bool):
        raise OptionsError(f"{key} : booléen attendu")
    return value


def parse_options(raw: Mapping[str, Any] | None) -> ExportOptions:
    """Options depuis un objet JSON (clés absentes = défauts). Toute valeur inconnue est refusée."""
    data: Mapping[str, Any] = raw or {}
    base = ExportOptions()
    unknown = set(data) - set(ExportOptions.__dataclass_fields__)
    if unknown:
        raise OptionsError(f"option(s) inconnue(s) : {sorted(unknown)}")
    formulas = data.get("formulas", sorted(base.formulas))
    if not isinstance(formulas, list | tuple | set | frozenset) or set(formulas) - set(FORMULAS):
        raise OptionsError(f"formulas : liste parmi {', '.join(FORMULAS)}")
    min_s = _number(data, "min_s", base.min_s, 0.0, 30.0)
    max_s = _number(data, "max_s", base.max_s, 0.5, 60.0)
    if max_s < min_s:
        raise OptionsError("max_s doit être supérieur ou égal à min_s")
    translation = data.get("translation_id", base.translation_id)
    if not isinstance(translation, str) or not translation:
        raise OptionsError("translation_id : identifiant attendu")
    return ExportOptions(
        format=_choice(data, "format", FORMATS, base.format),
        content=_choice(data, "content", CONTENTS, base.content),
        formulas=frozenset(str(f) for f in formulas),
        repetitions=_choice(data, "repetitions", REPETITIONS, base.repetitions),
        min_s=min_s,
        max_s=max_s,
        line_chars=int(_number(data, "line_chars", base.line_chars, 10, 200)),
        offset_ms=int(_number(data, "offset_ms", base.offset_ms, -5000, 5000)),
        rtl=_flag(data, "rtl", base.rtl),
        strip_notes=_flag(data, "strip_notes", base.strip_notes),
        show_ref=_flag(data, "show_ref", base.show_ref),
        bom=_flag(data, "bom", base.bom),
        karaoke=_flag(data, "karaoke", base.karaoke),
        font=_choice(data, "font", ASS_FONTS, base.font),
        policy=_choice(data, "policy", POLICIES, base.policy),
        allow_unresolved=_flag(data, "allow_unresolved", base.allow_unresolved),
        translation_id=translation,
    )
