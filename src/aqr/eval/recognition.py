"""Lecteur de la sortie JSON `aqr.recognition/1` (indépendant du moteur qui l'écrit).

Schéma lu (voir docs/EVALUATION-METRICS.md) : `source`, `engine`, `decoder`, `timing`,
`intervals` (chronologiques) de trois sortes :
- `verse` : ref, words [a, b], status recognized|inferred|uncertain, t [début, fin] ou null,
  time_interpolated, confidence, candidates ; champs additifs (ADR-0010) : `word_times` (un
  [début, fin] par mot de `words`, dans l'ordre) avec `word_times_source` (`ctc-alignment` mesuré,
  `interpolated` estimé), `promoted_by` ;
- `non_quran` : label, t ; la basmala porte en plus `basmala: true`, `ref` (1:1), `text` (corpus)
  et `translation` ; isti'adha, takbir et amin un libellé `label_ar` (pas un texte du Mushaf) ;
- `abstention` : reason, t, best_score (absence de décision, jamais un verset).

Le lecteur ne juge rien : il valide la forme et renvoie des objets typés. Un verset `recognized`
sans horodatage est une sortie invalide (il serait invérifiable) et lève `RecognitionError`.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from aqr.domain.models import Status, TimeSpan, VerseRef
from aqr.domain.word_timing import MAX_REPAIRED_OVERLAP_S, without_overlap

SCHEMA = "aqr.recognition/1"


class RecognitionError(ValueError):
    """Sortie de reconnaissance illisible ou hors schéma."""


@dataclass(frozen=True)
class VerseInterval:
    ref: VerseRef
    first_word: int
    last_word: int
    status: Status
    t: tuple[float, float] | None
    time_interpolated: bool = False
    confidence: float = 0.0
    candidates: tuple[VerseRef, ...] = ()
    word_times: tuple[tuple[float, float], ...] | None = None
    """Temps de chaque mot de `words` ; None = non fourni (ancien format, verset non nommé)."""
    word_times_source: str | None = None
    """`ctc-alignment` (mesuré) ou `interpolated` (estimé) : obligatoire avec `word_times`."""
    promoted_by: str | None = None
    """`neighbor` : `uncertain` promu parce qu'il prolonge un verset reconnu voisin (ADR-0010)."""


@dataclass(frozen=True)
class NonQuranInterval:
    label: str
    t: tuple[float, float]
    basmala: bool = False
    """Vrai pour la basmala : le verset 1:1 (`ref`), son texte vient du corpus (I1)."""
    ref: VerseRef | None = None
    text: str | None = None
    label_ar: str | None = None
    """Libellé arabe constant d'une formule (isti'adha, takbir, amin) : pas du texte du Mushaf."""


@dataclass(frozen=True)
class AbstentionInterval:
    reason: str
    t: tuple[float, float]
    best_score: float | None = None


Interval = VerseInterval | NonQuranInterval | AbstentionInterval


@dataclass(frozen=True)
class Recognition:
    intervals: tuple[Interval, ...]
    source: Mapping[str, Any] = field(default_factory=dict)
    engine: Mapping[str, Any] = field(default_factory=dict)
    decoder: Mapping[str, Any] = field(default_factory=dict)
    timing: Mapping[str, Any] = field(default_factory=dict)


def _span(raw: object, where: str) -> tuple[float, float]:
    if not (isinstance(raw, Sequence) and not isinstance(raw, str) and len(raw) == 2):
        raise RecognitionError(f"{where} : t doit être [début, fin]")
    try:
        start, end = float(raw[0]), float(raw[1])
    except (TypeError, ValueError) as exc:
        raise RecognitionError(f"{where} : t illisible {raw!r}") from exc
    if start < 0 or end <= start:
        raise RecognitionError(f"{where} : intervalle invalide {start} -> {end}")
    return start, end


_BASMALA_REF = VerseRef(1, 1)
_T_TOLERANCE_S = 0.002
"""Arrondi des temps à la milliseconde dans la sortie : les bornes d'un mot peuvent s'écarter de `t`
d'autant."""


def _parse_word_times(
    raw: Mapping[str, Any],
    first: int,
    last: int,
    t: tuple[float, float] | None,
    where: str,
    overlap_tolerance_s: float,
) -> tuple[tuple[tuple[float, float], ...] | None, str | None]:
    """`word_times` : un [début, fin] par mot de `words`, dans l'ordre, dans `t`. Un recouvrement
    minime de deux mots voisins (≤ `overlap_tolerance_s`) est normalisé (partagé par moitié) plutôt
    que de rendre tout le document illisible ; un recouvrement plus grand est refusé."""
    if raw.get("word_times") is None:
        if raw.get("word_times_source") is not None:
            raise RecognitionError(f"{where} : word_times_source sans word_times")
        return None, None
    source = raw.get("word_times_source")
    if source not in ("ctc-alignment", "interpolated"):
        raise RecognitionError(
            f"{where} : word_times_source {source!r} inconnu (ctc-alignment, interpolated)"
        )
    items = raw["word_times"]
    if not isinstance(items, Sequence) or isinstance(items, str):
        raise RecognitionError(f"{where} : word_times doit être une liste")
    if len(items) != last - first + 1:
        raise RecognitionError(
            f"{where} : word_times a {len(items)} temps pour {last - first + 1} mots"
        )
    times: list[tuple[float, float]] = []
    for n, pair in enumerate(items):
        start, end = _span(pair, f"{where}.word_times[{n}]")  # refuse un mot vide
        times.append((start, end))
    ordered = without_overlap([TimeSpan(a, b) for a, b in times], overlap_tolerance_s)
    if ordered is None:
        raise RecognitionError(
            f"{where} : word_times chevauchent le mot précédent de plus de {overlap_tolerance_s} s"
        )
    times = [(w.start_s, w.end_s) for w in ordered]
    if t is not None and (
        times[0][0] < t[0] - _T_TOLERANCE_S or times[-1][1] > t[1] + _T_TOLERANCE_S
    ):
        raise RecognitionError(f"{where} : word_times hors de l'intervalle t {list(t)}")
    return tuple(times), str(source)


def _parse_non_quran(raw: Mapping[str, Any], where: str) -> NonQuranInterval:
    label = str(raw.get("label", "unclassified"))
    t = _span(raw.get("t"), where)
    flag = raw.get("basmala", False)
    if not isinstance(flag, bool):  # « false », 1, « oui » : un drapeau n'est pas du texte
        raise RecognitionError(f"{where} : basmala doit être un booléen, pas {flag!r}")
    basmala = flag
    label_ar = raw.get("label_ar")
    if label_ar is not None and (not isinstance(label_ar, str) or not label_ar):
        raise RecognitionError(f"{where} : label_ar doit être un texte non vide")
    if basmala:
        if label != "basmala":
            raise RecognitionError(f"{where} : basmala: true sur le libellé {label!r}")
        if str(raw.get("ref")) != str(_BASMALA_REF):
            raise RecognitionError(
                f"{where} : la basmala est le verset 1:1, pas {raw.get('ref')!r}"
            )
        if label_ar is not None:
            raise RecognitionError(f"{where} : un libellé n'est pas le texte de la basmala")
        return NonQuranInterval(label, t, basmala=True, ref=_BASMALA_REF, text=raw.get("text"))
    if any(raw.get(key) is not None for key in ("text", "ref", "translation")):
        # Seule la basmala (verset 1:1) porte du texte du Mushaf, et sa traduction, dans une zone
        # non coranique ; `basmala: true` est ce qui l'annonce.
        raise RecognitionError(
            f"{where} : texte, référence ou traduction sur une zone sans `basmala: true` "
            f"(libellé {label!r})"
        )
    return NonQuranInterval(label, t, label_ar=label_ar)


def _parse_one(
    raw: object, index: int, overlap_tolerance_s: float = MAX_REPAIRED_OVERLAP_S
) -> Interval:
    where = f"intervals[{index}]"
    if not isinstance(raw, Mapping):
        raise RecognitionError(f"{where} : objet attendu")
    kind = raw.get("kind")
    try:
        if kind == "verse":
            status = Status(raw["status"])
            t = _span(raw["t"], where) if raw.get("t") is not None else None
            if status is Status.RECOGNIZED and t is None:
                raise RecognitionError(f"{where} : un verset recognized doit avoir t")
            words = raw.get("words") or [1, 1]
            first, last = int(words[0]), int(words[1])
            if first < 1 or last < first:
                raise RecognitionError(f"{where} : words invalide {words!r}")
            word_times, word_times_source = _parse_word_times(
                raw, first, last, t, where, overlap_tolerance_s
            )
            return VerseInterval(
                ref=VerseRef.parse(str(raw["ref"])),
                first_word=first,
                last_word=last,
                status=status,
                t=t,
                time_interpolated=bool(raw.get("time_interpolated", False)),
                confidence=float(raw.get("confidence", 0.0)),
                candidates=tuple(VerseRef.parse(str(c)) for c in raw.get("candidates") or ()),
                word_times=word_times,
                word_times_source=word_times_source,
                promoted_by=None if raw.get("promoted_by") is None else str(raw["promoted_by"]),
            )
        if kind == "non_quran":
            return _parse_non_quran(raw, where)
        if kind == "abstention":
            score = raw.get("best_score")
            return AbstentionInterval(
                str(raw.get("reason", "")),
                _span(raw.get("t"), where),
                float(score) if score is not None else None,
            )
    except RecognitionError:
        raise
    except (KeyError, ValueError, TypeError, IndexError) as exc:
        raise RecognitionError(f"{where} : {exc}") from exc
    raise RecognitionError(f"{where} : kind inconnu {kind!r} (verse, non_quran, abstention)")


def parse_intervals(
    raw: Sequence[object], *, word_overlap_tolerance_s: float = MAX_REPAIRED_OVERLAP_S
) -> tuple[Interval, ...]:
    return tuple(_parse_one(item, i, word_overlap_tolerance_s) for i, item in enumerate(raw))


def parse_recognition(
    data: Mapping[str, Any], *, word_overlap_tolerance_s: float = MAX_REPAIRED_OVERLAP_S
) -> Recognition:
    if data.get("schema") != SCHEMA:
        raise RecognitionError(f"schema {data.get('schema')!r} non géré (attendu {SCHEMA})")
    intervals = data.get("intervals")
    if not isinstance(intervals, list):
        raise RecognitionError("intervals : liste attendue")
    return Recognition(
        intervals=parse_intervals(intervals, word_overlap_tolerance_s=word_overlap_tolerance_s),
        source=dict(data.get("source") or {}),
        engine=dict(data.get("engine") or {}),
        decoder=dict(data.get("decoder") or {}),
        timing=dict(data.get("timing") or {}),
    )


def parse_recognition_text(text: str, origin: str) -> Recognition:
    """Lit un document déjà en mémoire (l'évaluation vérifie l'empreinte de CES octets-là)."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RecognitionError(f"{origin} : {exc}") from exc
    if not isinstance(data, dict):
        raise RecognitionError(f"{origin} : objet JSON attendu")
    return parse_recognition(data)


def load_recognition(path: Path) -> Recognition:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise RecognitionError(f"{path} : {exc}") from exc
    return parse_recognition_text(text, str(path))
