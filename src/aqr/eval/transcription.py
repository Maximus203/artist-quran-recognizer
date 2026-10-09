"""WER et CER d'une transcription ASR contre le texte du corpus (les versets attendus).

Le texte de référence vient TOUJOURS du corpus Tanzil (I1) : mots Uthmani des versets attendus
(`expected` du cas annoté, dans l'ordre du temps, plages de mots respectées). Deux variantes de
score, TOUJOURS nommées dans le rapport, chacune avec SON normaliseur (`VARIANT_NORMALIZERS`,
appliqué à la référence ET à l'hypothèse) :

- `tolerante` : `normalize_arabic` (lettres de base seulement : ni voyelles, ni ponctuation ; formes
  de l'alef, ى/ي, ة/ه, ؤ, ئ repliés) ; la référence est en plus ramenée à la graphie imla'i par le
  dictionnaire appris du corpus (`aqr.corpus.imlai_corrections`, ADR-0003), car un ASR écrit en
  imla'i.
- `strict-lettres` : `normalize_strict_letters` (docs/evaluation/normalisation.md §3) : mêmes
  étapes, AUCUN repli de lettres sauf `ٱ -> ا`, pas de dictionnaire. Un système n'est juste que
  s'il écrit `ة ى ؤ ئ أ إ آ ء` comme la référence. La référence reste le texte Uthmani : la variante
  est un PLANCHER d'orthographe du Mushaf, PAS un taux d'erreur de l'ASR : elle compte aussi les
  conventions du Mushaf qu'une orthographe imla'i n'a pas (madda écrite `ءَا`, hamza combinant,
  alef suscrit, `ى`). Elle diagnostique, elle ne règle aucun seuil.

Le CER est calculé, dans les deux variantes, sur les lettres SANS espaces : une coupure de mots
différente ne coûte rien au CER (elle coûte au WER), et l'écart tolérante/stricte ne vient que de
la normalisation (replis de lettres, dictionnaire imla'i), jamais des espaces.

WER = erreurs de mots / mots de référence ; CER = erreurs de lettres / lettres de référence
(Levenshtein : substitution, insertion, suppression à coût 1). Agrégation par SOMMES d'erreurs et
de longueurs (`sum_scores`), jamais par moyenne de taux. Aucune valeur n'est tirée d'un modèle.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, NamedTuple, Protocol

from aqr.corpus.normalize import NORMALIZATION_VERSION as NORMALIZATION_VERSION
from aqr.corpus.normalize import STRICT_NORMALIZATION_VERSION as STRICT_NORMALIZATION_VERSION
from aqr.corpus.normalize import (
    normalize_arabic,
    normalize_strict_letters,
    tokenize,
    tokenize_strict_letters,
)
from aqr.data.manifest import ExpectedItem
from aqr.domain.models import VerseRef

TOLERANTE = "tolerante"
STRICT_LETTRES = "strict-lettres"
VARIANTS = (TOLERANTE, STRICT_LETTRES)
VARIANT_DESCRIPTIONS = {
    TOLERANTE: (
        "normalize_arabic + corrections imla'i sur la référence ; CER sur les lettres sans espaces"
    ),
    STRICT_LETTRES: (
        "normalize_strict_letters (aucun repli de lettres sauf alef wasla, sans dictionnaire "
        "imla'i) contre la référence Uthmani : plancher d'orthographe du Mushaf, pas un taux "
        "d'erreur de l'ASR ; CER sur les lettres sans espaces"
    ),
}


class VariantNormalizer(NamedTuple):
    """Normaliseur d'une variante : forme d'un mot/texte, et découpe en mots."""

    normalize: Callable[[str], str]
    tokenize: Callable[[str], list[str]]


# UNE seule table : référence et hypothèse passent par le même normaliseur (jamais un drapeau
# caché dans `normalize_arabic`).
VARIANT_NORMALIZERS: Mapping[str, VariantNormalizer] = {
    TOLERANTE: VariantNormalizer(normalize_arabic, tokenize),
    STRICT_LETTRES: VariantNormalizer(normalize_strict_letters, tokenize_strict_letters),
}


class WordSource(Protocol):
    def words(self, ref: VerseRef) -> tuple[str, ...]: ...


def edit_distance(a: Sequence[Any], b: Sequence[Any]) -> int:
    """Distance de Levenshtein (coût 1) entre deux séquences (mots ou lettres)."""
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a, start=1):
        current = [i]
        for j, y in enumerate(b, start=1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x != y)))
        previous = current
    return previous[-1]


@dataclass(frozen=True)
class TranscriptScore:
    word_errors: int
    word_total: int
    letter_errors: int
    letter_total: int

    @property
    def wer(self) -> float | None:
        return self.word_errors / self.word_total if self.word_total else None

    @property
    def cer(self) -> float | None:
        return self.letter_errors / self.letter_total if self.letter_total else None

    def to_dict(self) -> dict[str, Any]:
        return {
            "word_errors": self.word_errors,
            "word_total": self.word_total,
            "wer": self.wer,
            "letter_errors": self.letter_errors,
            "letter_total": self.letter_total,
            "cer": self.cer,
        }


def sum_scores(scores: Iterable[TranscriptScore]) -> TranscriptScore:
    items = list(scores)
    return TranscriptScore(
        sum(s.word_errors for s in items),
        sum(s.word_total for s in items),
        sum(s.letter_errors for s in items),
        sum(s.letter_total for s in items),
    )


def reference_words(items: Sequence[ExpectedItem], corpus: WordSource) -> tuple[str, ...]:
    """Mots Uthmani des versets attendus, dans l'ordre du temps ; plages de mots respectées."""
    if not items:
        raise ValueError("aucun verset attendu : pas de texte de référence")
    words: list[str] = []
    for item in sorted(items, key=lambda i: i.t):
        verse = corpus.words(item.ref)
        if item.words.is_all or item.words.first is None or item.words.last is None:
            words.extend(verse)
            continue
        if item.words.last > len(verse):
            raise ValueError(
                f"{item.ref} : plage de mots {item.words} hors du verset ({len(verse)} mots)"
            )
        words.extend(verse[item.words.first - 1 : item.words.last])
    return tuple(words)


def _normalized_reference(
    words: Sequence[str], corrections: Mapping[str, str], variant: str
) -> list[str]:
    normalize = VARIANT_NORMALIZERS[variant].normalize
    normalized = [w for w in (normalize(word) for word in words) if w]
    if variant == TOLERANTE:
        return [corrections.get(w, w) for w in normalized]
    return normalized


def score_transcript(
    reference: Sequence[str], hypothesis: str, corrections: Mapping[str, str], variant: str
) -> TranscriptScore:
    """Score d'une transcription brute contre les mots de référence (voir le module)."""
    if variant not in VARIANT_NORMALIZERS:
        raise ValueError(f"variante {variant!r} inconnue (attendu {', '.join(VARIANTS)})")
    ref_words = _normalized_reference(reference, corrections, variant)
    hyp_words = VARIANT_NORMALIZERS[variant].tokenize(hypothesis)
    ref_letters, hyp_letters = "".join(ref_words), "".join(hyp_words)
    return TranscriptScore(
        word_errors=edit_distance(ref_words, hyp_words),
        word_total=len(ref_words),
        letter_errors=edit_distance(ref_letters, hyp_letters),
        letter_total=len(ref_letters),
    )


TRANSCRIPT_SCHEMA = "aqr.transcript/1"


class TranscriptError(ValueError):
    """Fichier de transcription illisible ou hors schéma."""


@dataclass(frozen=True)
class TranscriptFile:
    text: str
    sha256: str
    engine: Mapping[str, Any]
    peak_rss_mb: float | None


def parse_transcript(data: Mapping[str, Any]) -> TranscriptFile:
    """`{"schema": "aqr.transcript/1", "source": {"sha256"}, "engine": {...}, "text": "...",
    "run": {"peak_rss_mb": float | absent}}` : la sortie BRUTE de l'ASR, avant tout matcher."""
    if data.get("schema") != TRANSCRIPT_SCHEMA:
        raise TranscriptError(
            f"schema {data.get('schema')!r} non géré (attendu {TRANSCRIPT_SCHEMA})"
        )
    text = data.get("text")
    if not isinstance(text, str):
        raise TranscriptError("text : chaîne attendue")
    sha = (data.get("source") or {}).get("sha256")
    if not sha:
        raise TranscriptError("source.sha256 absent : audio non vérifiable")
    peak = (data.get("run") or {}).get("peak_rss_mb")
    try:
        peak_value = float(peak) if peak is not None else None
    except (TypeError, ValueError) as exc:
        raise TranscriptError(f"run.peak_rss_mb illisible : {peak!r}") from exc
    return TranscriptFile(text, str(sha), dict(data.get("engine") or {}), peak_value)


def load_transcript(path: Path) -> TranscriptFile:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise TranscriptError(f"{path} : {exc}") from exc
    if not isinstance(data, dict):
        raise TranscriptError(f"{path} : objet JSON attendu")
    return parse_transcript(data)


def normalization_fingerprint(corrections: Mapping[str, str]) -> str:
    """Empreinte de la normalisation effective : versions tolérante et stricte + dictionnaire."""
    payload = json.dumps(
        {
            "version": NORMALIZATION_VERSION,
            "strict_version": STRICT_NORMALIZATION_VERSION,
            "corrections": sorted(corrections.items()),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
