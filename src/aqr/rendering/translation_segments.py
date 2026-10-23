"""Traduction découpée en fragments alignés sur des plages de mots arabes (runtime, sans numpy).

Pourquoi : pour un verset PARTIEL (le récitant s'arrête, reprend), l'arabe affiche les seuls mots
entendus ; la traduction du verset entier « ne commence pas au début de la lecture ». Les
frontières de découpage sont calculées HORS LIGNE (`scripts/build_translation_segments.py`,
algorithme déterministe, aucun modèle génératif : ADR-0001) et lues ici.

Invariant I2 : la traduction n'est jamais modifiée, seulement DÉCOUPÉE en tranches consécutives
du texte d'origine (`texte[start:end]`) ; la jonction des tranches redonne le texte à
l'espace de jonction près. Le fichier de données ne contient ni texte coranique ni traduction :
des indices de mots, des offsets de caractères et l'empreinte SHA-256 du texte français concerné.
Si la traduction change (empreinte différente), le verset n'a plus de découpage : repli sur le
verset entier, jamais un décalage silencieux (I3 : un fragment faux est pire que pas de fragment).
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from aqr.domain.models import VerseRef

SEGMENTS_SCHEMA: Final = "aqr.translation-segments/1"
FINGERPRINT_HEX: Final = 16
"""Longueur (hex) de l'empreinte SHA-256 conservée par verset : 64 bits, collision négligeable
pour 6 236 textes, fichier de données léger."""

_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")


class SegmentStoreError(ValueError):
    """Fichier de frontières illisible ou hors schéma."""


def fingerprint(text: str) -> str:
    """Empreinte SHA-256 (tronquée) du texte de traduction d'un verset."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:FINGERPRINT_HEX]


@dataclass(frozen=True)
class Segment:
    """Tranche consécutive de la traduction, alignée sur la plage de mots arabes [first, last]."""

    first_word: int
    last_word: int
    start: int
    end: int
    """`texte[start:end]` : tranche exacte, espaces de jonction exclus."""
    confidence: float | None = None
    """Confiance de la frontière qui OUVRE ce segment (None pour le premier)."""


@dataclass(frozen=True)
class Fragment:
    first_word: int
    last_word: int
    text: str
    approximate: bool
    ellipsis_before: bool
    ellipsis_after: bool


@dataclass(frozen=True)
class FragmentPolicy:
    """Quand un fragment est assez fidèle à la plage affichée (réglages, jamais en dur)."""

    min_edge_overlap: float = 0.5
    """Un segment de bord n'est gardé que si la plage en couvre au moins cette part (en mots)."""
    max_overreach: float = 1.0
    """Mots du fragment au-delà de la plage affichée, en part de la largeur de la plage ;
    au-delà, la traduction du verset entier est préférée (repli honnête)."""


def _to_int(value: object, where: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise SegmentStoreError(f"{where} : entier attendu, reçu {value!r}")
    return value


def _build_segments(
    entry_cuts: Sequence[object], text: str, word_count: int
) -> tuple[Segment, ...] | None:
    starts: list[tuple[int, int, float | None]] = [(1, 0, None)]
    for raw in entry_cuts:
        if not (isinstance(raw, Sequence) and not isinstance(raw, str) and len(raw) >= 2):
            return None
        try:
            word = _to_int(raw[0], "cut")
            offset = _to_int(raw[1], "cut")
        except SegmentStoreError:
            return None
        confidence = float(raw[2]) if len(raw) > 2 and isinstance(raw[2], int | float) else None
        prev_word, prev_offset, _c = starts[-1]
        if not (prev_word < word <= word_count and prev_offset < offset < len(text)):
            return None
        # une frontière tombe entre deux mots : un espace avant, un caractère visible dessus
        if not (text[offset - 1].isspace() and not text[offset].isspace()):
            return None
        starts.append((word, offset, confidence))
    segments: list[Segment] = []
    for index, (word, offset, confidence) in enumerate(starts):
        last_word = starts[index + 1][0] - 1 if index + 1 < len(starts) else word_count
        end = starts[index + 1][1] if index + 1 < len(starts) else len(text)
        segments.append(Segment(word, last_word, offset, len(text[:end].rstrip()), confidence))
    return tuple(segments)


@dataclass(frozen=True)
class SegmentStore:
    """Frontières de découpage d'une traduction (un fichier par `translation_id`)."""

    translation_id: str
    method: str
    verses: Mapping[str, Mapping[str, object]]

    @classmethod
    def from_document(cls, document: Mapping[str, object]) -> SegmentStore:
        if document.get("schema") != SEGMENTS_SCHEMA:
            raise SegmentStoreError(
                f"schema {document.get('schema')!r} non géré (attendu {SEGMENTS_SCHEMA})"
            )
        verses = document.get("verses")
        if not isinstance(verses, Mapping):
            raise SegmentStoreError("verses : objet attendu")
        return cls(
            translation_id=str(document.get("translation_id", "")),
            method=str(document.get("method", "")),
            verses=verses,
        )

    def segments(self, ref: VerseRef, text: str, word_count: int) -> tuple[Segment, ...] | None:
        """Segments du verset, ou None si le verset est inconnu, si le texte français a changé
        (empreinte) ou si le nombre de mots arabes ne correspond plus : pas de découpage."""
        entry = self.verses.get(str(ref))
        if not isinstance(entry, Mapping):
            return None
        if entry.get("h") != fingerprint(text) or entry.get("w") != word_count:
            return None
        cuts = entry.get("cuts")
        if not isinstance(cuts, Sequence) or isinstance(cuts, str):
            return None
        return _build_segments(cuts, text, word_count)


class SegmentLibrary:
    """Les fichiers `<dossier>/<translation_id>.json`, chargés à la demande ; un fichier absent
    ou illisible veut dire « pas de découpage » (repli sur le verset entier), jamais une panne."""

    def __init__(self, directory: Path) -> None:
        self._directory = directory
        self._stores: dict[str, SegmentStore | None] = {}

    def store(self, translation_id: str) -> SegmentStore | None:
        if translation_id in self._stores:
            return self._stores[translation_id]
        loaded = self._load(translation_id)
        self._stores[translation_id] = loaded
        return loaded

    def _load(self, translation_id: str) -> SegmentStore | None:
        if not _SAFE_ID.match(translation_id):
            return None
        path = self._directory / f"{translation_id}.json"
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(document, dict):
                return None
            return SegmentStore.from_document(document)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, SegmentStoreError):
            return None


def select_fragment(
    segments: Sequence[Segment],
    text: str,
    first: int,
    last: int,
    word_count: int,
    policy: FragmentPolicy,
) -> Fragment | None:
    """Fragment de traduction de la plage de mots [first, last], ou None (repli sur le verset).

    Réunion des segments qui recouvrent la plage ; un segment de bord à peine recouvert est
    écarté. `approximate` : le fragment ne couvre pas exactement la plage. None si le verset n'a
    qu'un segment, si le fragment est le verset entier ou s'il déborde trop de la plage.
    """
    if first < 1 or last < first:
        raise ValueError(f"plage de mots invalide : [{first}, {last}]")
    if len(segments) < 2:
        return None
    chosen = [s for s in segments if s.last_word >= first and s.first_word <= last]
    if not chosen:
        return None

    def overlap(segment: Segment) -> float:
        shared = min(last, segment.last_word) - max(first, segment.first_word) + 1
        return shared / (segment.last_word - segment.first_word + 1)

    if len(chosen) > 1 and overlap(chosen[0]) < policy.min_edge_overlap:
        chosen = chosen[1:]
    if len(chosen) > 1 and overlap(chosen[-1]) < policy.min_edge_overlap:
        chosen = chosen[:-1]
    first_word, last_word = chosen[0].first_word, chosen[-1].last_word
    if first_word <= 1 and last_word >= word_count:
        return None  # le fragment est le verset entier : rien de plus précis à montrer
    width = last - first + 1
    extra = (last_word - first_word + 1) - width
    if extra > policy.max_overreach * width:
        return None
    return Fragment(
        first_word=first_word,
        last_word=last_word,
        text=text[chosen[0].start : chosen[-1].end],
        approximate=(first_word, last_word) != (first, last),
        ellipsis_before=first_word > 1,
        ellipsis_after=last_word < word_count,
    )
