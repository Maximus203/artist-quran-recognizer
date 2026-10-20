"""Contrôle des étiquettes du jeu de fine-tuning par le modèle de base, avant tout entraînement.

Tadabur est segmenté et étiqueté automatiquement (WhisperX) ; sa riwaya n'est pas documentée ; une
basmala peut être récitée sans être annoncée. Chaque exemple récité est donc noté par
l'alignement forcé (ADR-0006) de son étiquette — le champ `text` du manifeste, retrouvé dans le
corpus — sur le treillis CTC du modèle de base : la preuve `llr_per_frame` (ADR-0005) est proche
de 0 quand l'audio soutient le texte, très négative quand il dit autre chose (autre verset,
segment débordant sur le voisin, autre lecture). Pour un verset 1, l'hypothèse inverse sur la
basmala est aussi notée : si elle explique nettement mieux l'audio, l'étiquette est fausse.

La queue de distribution est écartée au seuil de `LabelQcConfig` (calibré à l'oreille, jamais en
dur) ; les scores vivent dans un fichier à part et le manifeste filtré reprend les lignes
d'origine telles quelles. Pur : le modèle et l'audio sont injectés (`LatticeOf`, `encode`).
"""

from __future__ import annotations

import json
import statistics
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass
from enum import StrEnum
from typing import Any

from aqr.alignment.forced import AlignmentConfig, PassageAligner
from aqr.corpus.alignment_text import AlignmentTexts, AlignmentVariant, recited_span
from aqr.data.config import LabelQcConfig
from aqr.domain.models import VerseRef, WordSpan
from aqr.domain.ports import CtcLattice

_SECONDS_PER_HOUR = 3600
_REPORT_PRECISION = 4
_MAD_TO_SIGMA = 1.4826
"""MAD → écart-type pour une loi normale : rend `robust_k` lisible comme un nombre de sigmas."""
_PERCENTILES = (1, 2, 5, 10, 25, 50, 75, 90, 95, 99)

LatticeOf = Callable[[Mapping[str, Any]], CtcLattice]
"""Treillis CTC du modèle de base sur tout l'audio d'une ligne de manifeste."""


class QcFlag(StrEnum):
    BASMALA_UNANNOUNCED = "basmala_recitee_non_annoncee"
    BASMALA_MISSING = "basmala_annoncee_absente"
    LOW_SCORE = "preuve_faible"
    NOT_ALIGNED = "texte_non_aligne"
    """Le texte ne tient pas dans les trames de l'audio (trop de symboles pour sa durée)."""
    TEXT_MISMATCH = "texte_different_du_corpus"


@dataclass(frozen=True)
class LabelScore:
    key: str
    """`audio_filepath` de la ligne (unique dans un manifeste)."""
    split: str
    ref: str
    speaker: str
    duration: float
    text: str
    llr_per_frame: float | None
    variant: str | None
    """Graphie retenue par l'alignement (`AlignmentVariant`)."""
    frames: int
    basmala_in_text: bool | None
    """Verset 1 précédé d'une basmala : l'étiquette l'annonce-t-elle ? None ailleurs."""
    basmala_alt_llr: float | None
    """Preuve de l'hypothèse inverse sur la basmala (verset 1 seulement)."""
    error: QcFlag | None
    unknown_symbols: int = 0
    """Symboles `<unk>` de l'étiquette (caractères que le modèle n'a jamais appris) : retirés pour
    la notation, comptés parce qu'une cible d'entraînement ne devrait pas en contenir."""

    def to_json(self) -> dict[str, Any]:
        data = asdict(self)
        data["error"] = None if self.error is None else self.error.value
        return data

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> LabelScore:
        fields = dict(data)
        error = fields.pop("error")
        return cls(**fields, error=None if error is None else QcFlag(error))


class LabelScorer:
    def __init__(
        self,
        texts: AlignmentTexts,
        encode: Callable[[str], Sequence[int]],
        lattice_of: LatticeOf,
        config: AlignmentConfig | None = None,
        *,
        unknown_symbol: int | None = None,
        target: Callable[[str], str] | None = None,
    ) -> None:
        """`unknown_symbol` (`<unk>`) est retiré du texte à aligner : le modèle ne l'émet jamais,
        l'exiger noterait comme fausse toute étiquette juste qui contient un tel caractère.
        `target` : graphie des cibles d'entraînement (`finetune.model_graphie`) ; une étiquette
        est le texte d'un verset si les deux coïncident une fois écrits dans cette graphie."""
        self._texts = texts
        self._lattice_of = lattice_of
        self._encode = encode
        self._unknown = unknown_symbol
        self._target: Callable[[str], str] = target or (lambda text: text)
        self._aligner = PassageAligner(texts, self._known, config)

    def _known(self, text: str) -> list[int]:
        return [s for s in self._encode(text) if s != self._unknown]

    def _unknown_count(self, text: str) -> int:
        """Symboles `<unk>` que l'étiquette demanderait au modèle d'émettre."""
        if self._unknown is None:
            return 0
        return sum(list(self._encode(w)).count(self._unknown) for w in text.split())

    def score(self, entry: Mapping[str, Any], split: str) -> LabelScore:
        """Note une ligne de manifeste coranique ; ValueError si elle n'a pas de verset."""
        key = str(entry["audio_filepath"])
        if not entry.get("aqr_ref"):
            raise ValueError(f"{key} : sans aqr_ref, seule la récitation est contrôlée")
        ref = VerseRef.parse(str(entry["aqr_ref"]))
        text = str(entry["text"])
        hypotheses = self._hypotheses(ref)
        written = self._target(text)
        labelled = [
            (span, b)
            for span, b in hypotheses
            if self._target(" ".join(self._words(span))) == written
        ]

        def result(**measures: Any) -> LabelScore:
            values: dict[str, Any] = {
                "llr_per_frame": None,
                "variant": None,
                "frames": 0,
                "basmala_in_text": None,
                "basmala_alt_llr": None,
                "error": None,
                "unknown_symbols": 0,
                **measures,
            }
            return LabelScore(
                key=key,
                split=split,
                ref=str(ref),
                speaker=str(entry.get("aqr_speaker") or ""),
                duration=float(entry["duration"]),
                text=text,
                **values,
            )

        if not labelled:
            return result(error=QcFlag.TEXT_MISMATCH)
        span, basmala = labelled[0]
        unknown = self._unknown_count(text)
        lattice = self._lattice_of(entry)
        main = self._aligner.align(lattice, [span])
        if main is None:
            return result(
                frames=lattice.frames,
                basmala_in_text=basmala,
                error=QcFlag.NOT_ALIGNED,
                unknown_symbols=unknown,
            )
        alternative = None
        if basmala is not None:
            other = next(s for s, b in hypotheses if b is not basmala)
            aligned = self._aligner.align(lattice, [other])
            alternative = None if aligned is None else aligned.evidence.llr_per_frame
        return result(
            llr_per_frame=main.evidence.llr_per_frame,
            variant=main.variant.value,
            frames=lattice.frames,
            basmala_in_text=basmala,
            basmala_alt_llr=alternative,
            unknown_symbols=unknown,
        )

    def _hypotheses(self, ref: VerseRef) -> list[tuple[WordSpan, bool | None]]:
        """Plages que peut annoncer une étiquette : avec ou sans basmala pour un verset 1."""
        count = self._texts.word_count(ref)
        full, recited = WordSpan(ref, 1, count), recited_span(ref, count)
        if recited == full:
            return [(full, None)]
        return [(recited, False), (full, True)]

    def _words(self, span: WordSpan) -> list[str]:
        # La graphie du manifeste : Tanzil `simple` (finetune.quran_target_text).
        return [w.text for w in self._texts.words(span, AlignmentVariant.VOCALIZED)]


def verdict(score: LabelScore, config: LabelQcConfig) -> QcFlag | None:
    """Raison d'écarter l'exemple, ou None s'il est gardé."""
    if config.min_llr_per_frame is None:
        raise ValueError(
            "LabelQcConfig.min_llr_per_frame non calibré : fixer le seuil à l'oreille "
            "(docs/evaluation/finetune-label-qc.md)"
        )
    if score.error is not None or score.llr_per_frame is None:
        return score.error or QcFlag.NOT_ALIGNED
    alternative = score.basmala_alt_llr
    if alternative is not None and alternative - score.llr_per_frame >= config.basmala_margin:
        return QcFlag.BASMALA_MISSING if score.basmala_in_text else QcFlag.BASMALA_UNANNOUNCED
    if score.llr_per_frame < config.min_llr_per_frame:
        return QcFlag.LOW_SCORE
    return None


def filter_manifest(
    lines: Iterable[str], scores: Mapping[str, LabelScore], config: LabelQcConfig
) -> tuple[list[str], list[tuple[LabelScore, QcFlag]]]:
    """(lignes gardées, inchangées ; exemples écartés et leur raison)."""
    kept: list[str] = []
    rejected: list[tuple[LabelScore, QcFlag]] = []
    for line in lines:
        if not line.strip():
            continue
        key = str(json.loads(line)["audio_filepath"])
        score = scores.get(key)
        if score is None:
            raise KeyError(f"{key} : sans score (lancer `score` avant `filter`)")
        flag = verdict(score, config)
        if flag is None:
            kept.append(line)
        else:
            rejected.append((score, flag))
    return kept, rejected


# --- Rapport ------------------------------------------------------------------------------------


def _hours(seconds: float) -> float:
    return round(seconds / _SECONDS_PER_HOUR, _REPORT_PRECISION)


def _quantile(ordered: Sequence[float], q: float) -> float:
    """Interpolation linéaire entre rangs (comme `numpy.quantile` par défaut)."""
    position = q * (len(ordered) - 1)
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def _distribution(values: Sequence[float], config: LabelQcConfig) -> dict[str, Any] | None:
    if not values:
        return None
    ordered = sorted(values)
    low, high = ordered[0], ordered[-1]
    median = statistics.median(ordered)
    sigma = _MAD_TO_SIGMA * statistics.median(abs(v - median) for v in ordered)
    bins = config.histogram_bins
    width = (high - low) / bins or 1.0
    counts = [0] * bins
    for value in ordered:
        counts[min(int((value - low) / width), bins - 1)] += 1
    return {
        "count": len(ordered),
        "min": low,
        "max": high,
        "quantiles": {f"p{p}": _quantile(ordered, p / 100) for p in _PERCENTILES},
        "mad_sigma": sigma,
        "robust_threshold": median - config.robust_k * sigma,
        "histogram": [
            {"from": low + i * width, "to": low + (i + 1) * width, "count": count}
            for i, count in enumerate(counts)
        ],
    }


def qc_report(scores: Sequence[LabelScore], config: LabelQcConfig) -> dict[str, Any]:
    """Distribution des preuves, comptes par raison et exemples écartés à écouter."""
    judged = [(score, verdict(score, config)) for score in scores]
    kept = [s for s, flag in judged if flag is None]
    rejected = [(s, flag) for s, flag in judged if flag is not None]
    by_flag: dict[str, dict[str, Any]] = {}
    for score, flag in rejected:
        tally = by_flag.setdefault(flag.value, {"count": 0, "seconds": 0.0})
        tally["count"] += 1
        tally["seconds"] += score.duration
    return {
        "threshold": {
            "min_llr_per_frame": config.min_llr_per_frame,
            "basmala_margin": config.basmala_margin,
        },
        "scored": len(scores),
        "aligned": sum(s.llr_per_frame is not None for s in scores),
        "kept": {
            "count": len(kept),
            "hours": _hours(sum(s.duration for s in kept)),
            "speakers": len({s.speaker for s in kept}),
        },
        "rejected": {
            flag: {"count": t["count"], "hours": _hours(t["seconds"])}
            for flag, t in sorted(by_flag.items())
        },
        "unknown_symbols": {
            "labels": sum(s.unknown_symbols > 0 for s in scores),
            "hours": _hours(sum(s.duration for s in scores if s.unknown_symbols > 0)),
        },
        "distribution": _distribution(
            [s.llr_per_frame for s in scores if s.llr_per_frame is not None], config
        ),
        "rejected_examples": rejected_examples(rejected, config.report_examples),
    }


def rejected_examples(
    rejected: Iterable[tuple[LabelScore, QcFlag]], limit: int | None = None
) -> list[dict[str, Any]]:
    """Exemples écartés à écouter, les pires d'abord : sans alignement (rien n'explique l'audio),
    puis par preuve croissante."""
    worst = sorted(
        rejected,
        key=lambda item: (item[0].llr_per_frame is not None, item[0].llr_per_frame or 0.0),
    )
    return [
        {
            "key": s.key,
            "split": s.split,
            "ref": s.ref,
            "speaker": s.speaker,
            "duration": s.duration,
            "llr_per_frame": s.llr_per_frame,
            "basmala_alt_llr": s.basmala_alt_llr,
            "flag": flag.value,
            "text": s.text,
        }
        for s, flag in worst[:limit]
    ]
