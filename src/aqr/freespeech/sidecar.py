"""Fichier `aqr.free-speech/1` : transcription et traduction automatiques de l'arabe hors Coran.

Fichier SÉPARÉ du résultat `aqr.recognition/1` : le résultat ne contient que du texte relu contre le
corpus (I1), la parole libre est produite par des modèles et ne s'y mélange jamais. Un passage
retenu ne porte aucun texte, seulement la raison (il pourrait être coranique, I3).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

SCHEMA: Final = "aqr.free-speech/1"
NOTICE: Final = (
    "Transcription et traduction automatiques, hors Coran : approximatives, à vérifier. "
    "Ce n'est ni le texte du Mushaf ni une traduction officielle."
)

STATUSES: Final = ("translated", "withheld")
REVIEWS: Final = ("pending", "approved", "rejected")
REASONS: Final = (
    "too_short",
    "silent",
    "language",
    "low_confidence",
    "too_few_words",
    "hallucination",
    "quran_like",
    "known_formula",
    "translation_implausible",
    "no_translation",
)
_TEXT_FIELDS: Final = frozenset(
    {"transcript_ar", "translation_fr", "confidence", "language", "review"}
)


class SidecarError(ValueError):
    """Fichier de parole libre invalide (message en français)."""


@dataclass(frozen=True)
class FreeSpeechItem:
    index: int
    t: tuple[float, float]
    status: str
    reason: str | None = None
    transcript_ar: str | None = None
    translation_fr: str | None = None
    confidence: float | None = None
    language: str | None = None
    review: str | None = None

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "index": self.index,
            "t": [round(self.t[0], 3), round(self.t[1], 3)],
            "status": self.status,
        }
        if self.status == "withheld":
            out["reason"] = self.reason
            return out
        out.update(
            transcript_ar=self.transcript_ar,
            translation_fr=self.translation_fr,
            confidence=None if self.confidence is None else round(self.confidence, 3),
            language=self.language,
            review=self.review or "pending",
        )
        return out


def build_document(
    items: Sequence[FreeSpeechItem],
    *,
    transcriber: str,
    translator: str,
    recognition_sha256: str,
    thresholds: Mapping[str, float | int],
) -> dict[str, Any]:
    return {
        "schema": SCHEMA,
        "notice": NOTICE,
        "source": {"recognition_sha256": recognition_sha256},
        "engine": {
            "transcriber": transcriber,
            "translator": translator,
            "thresholds": dict(thresholds),
        },
        "items": [item.to_json() for item in items],
    }


def _text(raw: Mapping[str, Any], key: str, where: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value.strip():
        raise SidecarError(f"{where} : {key} doit être un texte non vide")
    return value


def validate_document(document: object) -> None:
    """Refuse un fichier qui laisserait du texte sur un passage retenu, ou un statut inconnu."""
    if not isinstance(document, dict) or document.get("schema") != SCHEMA:
        raise SidecarError(f"schéma attendu : {SCHEMA}")
    items = document.get("items")
    if not isinstance(items, list):
        raise SidecarError("items doit être une liste")
    seen: set[int] = set()
    for rank, raw in enumerate(items):
        where = f"items[{rank}]"
        if not isinstance(raw, dict):
            raise SidecarError(f"{where} : objet attendu")
        index = raw.get("index")
        if not isinstance(index, int) or isinstance(index, bool) or index < 0 or index in seen:
            raise SidecarError(f"{where} : index entier, positif et unique attendu")
        seen.add(index)
        t = raw.get("t")
        if not (
            isinstance(t, list)
            and len(t) == 2
            and all(isinstance(x, int | float) and not isinstance(x, bool) for x in t)
            and 0 <= t[0] < t[1]
        ):
            raise SidecarError(f"{where} : t doit être [début, fin] croissant")
        status = raw.get("status")
        if status not in STATUSES:
            raise SidecarError(f"{where} : statut inconnu {status!r}")
        if status == "withheld":
            if raw.get("reason") not in REASONS:
                raise SidecarError(f"{where} : raison inconnue {raw.get('reason')!r}")
            if _TEXT_FIELDS & raw.keys():
                raise SidecarError(f"{where} : un passage retenu ne porte aucun texte (I3)")
            continue
        _text(raw, "transcript_ar", where)
        _text(raw, "translation_fr", where)
        if raw.get("review") not in REVIEWS:
            raise SidecarError(f"{where} : review parmi {', '.join(REVIEWS)}")
