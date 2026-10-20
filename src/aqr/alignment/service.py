"""`aqr align` : alignement forcé d'une liste de versets DÉCLARÉE sur un passage (ADR-0006).

L'humain (ou une préannotation qu'il valide) dit QUOI est récité ; l'alignement dit QUAND, mot par
mot, et à quel point l'audio soutient ce texte. La sortie `aqr.alignment/1` n'est jamais une
reconnaissance : elle sert à poser des limites de vérité terrain que l'humain valide à l'oreille.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aqr.alignment.forced import (
    AlignedSpan,
    AlignmentConfig,
    PassageAligner,
    PassageAlignment,
    emittable_encoder,
)
from aqr.alignment.plan import PLAN_SCHEMA
from aqr.corpus.alignment_text import (
    FORMULA_KINDS,
    AlignmentTexts,
    Declared,
    Formula,
    recited_span,
)
from aqr.domain.models import NonQuranKind, TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import AudioClip, CtcAcousticModel

SCHEMA = "aqr.alignment/2"
NOTICE = (
    "Alignement d'un texte DÉCLARÉ (--verses) : dit où ces versets seraient récités et à quel "
    "point l'audio les soutient (evidence.llr_per_frame, proche de 0 = soutenu). Ce n'est pas une "
    "reconnaissance ; des limites de vérité terrain exigent une validation à l'oreille."
)
DEFAULT_ENERGY_RATIO = 0.1
"""Provisoire (docs/evaluation/alignment-2026-10-19.md) : 0,05 colle le mieux aux limites EveryAyah
(studio) mais déborde dans les pauses réverbérées d'une prière (lot1-06) ; 0,10 est un compromis
mesuré des deux côtés, à remplacer par un réglage sur des limites validées à l'oreille."""

_FORMULA_NAMES = {kind.value for kind in FORMULA_KINDS}
_ITEM = re.compile(
    r"^(?P<s>\d+):(?P<a>\d+)(?:-(?:(?P<s2>\d+):)?(?P<a2>\d+))?(?:\[(?P<w1>\d+)-(?P<w2>\d+)\])?$"
)


def parse_verse_spec(spec: str, word_count: Callable[[VerseRef], int]) -> list[Declared]:
    """« 112:1-4 », « 21:51-23:118 », « 2:255[1-10] », séparés par des virgules, dans l'ordre
    récité.

    Un verset entier exclut la basmala que Tanzil concatène au verset 1 (`recited_span`) ; une
    plage de mots explicite est prise telle quelle (indices Uthmani). Les formules de la prière
    (« amin », « takbir », « istiadha », « basmala ») se déclarent à leur place : alignées comme
    le reste, elles empêchent un verset voisin d'absorber leur voix."""
    items = [item.strip() for item in spec.split(",") if item.strip()]
    if not items:
        raise ValueError("--verses vide : ex. « 112:1-4 » ou « 2:255[1-10] »")
    spans: list[Declared] = []
    for item in items:
        try:
            spans.extend(_parse_item(item, word_count))
        except ValueError as exc:
            raise ValueError(f"--verses : « {item} » : {exc}") from exc
    return spans


def _parse_item(item: str, word_count: Callable[[VerseRef], int]) -> list[Declared]:
    if item.lower() in _FORMULA_NAMES:
        return [Formula(NonQuranKind(item.lower()))]
    match = _ITEM.match(item)
    if match is None:
        raise ValueError("illisible (ex. 112:1-4, 21:51-23:118, 2:255[1-10])")
    start = VerseRef(int(match["s"]), int(match["a"]))
    if match["w1"] is not None:
        if match["a2"] is not None:
            raise ValueError("une plage de mots vaut pour UN verset")
        first, last = int(match["w1"]), int(match["w2"])
        if first < 1 or last < first or last > word_count(start):
            raise ValueError(f"{start} a {word_count(start)} mots")
        return [WordSpan(start, first, last)]
    end = start
    if match["a2"] is not None:
        end = VerseRef(int(match["s2"] or match["s"]), int(match["a2"]))
        if end < start:
            raise ValueError("la fin précède le début")
    spans: list[Declared] = []
    ref: VerseRef | None = start
    while ref is not None and ref <= end:
        spans.append(recited_span(ref, word_count(ref)))
        ref = ref.next()
    return spans


@dataclass(frozen=True)
class AlignOptions:
    models_dir: Path | None = None
    lock_path: Path = Path("models/LOCK.json")
    corpus_dir: Path = Path("data/corpus")
    device: str = "auto"
    energy_ratio: float | None = DEFAULT_ENERGY_RATIO


@dataclass(frozen=True)
class AlignmentService:
    extract: Callable[[Path], AudioClip]
    model: CtcAcousticModel
    texts: AlignmentTexts
    config: AlignmentConfig
    corpus_version: str
    max_passage_s: float


class AlignerUnavailable(RuntimeError):
    """Utilisation impossible (modèles absents) : code de sortie 2."""


def build_alignment_service(options: AlignOptions, env: Mapping[str, str]) -> AlignmentService:
    models_dir = options.models_dir or (
        Path(env["AQR_MODELS_DIR"]) if env.get("AQR_MODELS_DIR") else None
    )
    if models_dir is None:
        raise AlignerUnavailable(
            "Variable d'environnement manquante : AQR_MODELS_DIR (ou --models-dir) ; "
            "télécharger les modèles avec `python scripts/fetch_models.py`"
        )
    from aqr.adapters.fastconformer import FastConformerConfig, FastConformerQuranASR
    from aqr.adapters.ffmpeg_extractor import FfmpegAudioExtractor
    from aqr.corpus.tanzil_repository import TanzilCorpusRepository

    corpus = TanzilCorpusRepository(options.corpus_dir)
    config = FastConformerConfig(
        models_dir=models_dir, lock_path=options.lock_path, device=options.device
    )
    return AlignmentService(
        extract=FfmpegAudioExtractor().extract,
        model=FastConformerQuranASR(config),
        texts=AlignmentTexts.from_corpus_dir(options.corpus_dir, corpus),
        config=AlignmentConfig(energy_ratio=options.energy_ratio),
        corpus_version=f"tanzil.net hafs ({corpus.version})",
        max_passage_s=config.lattice_max_s,
    )


@dataclass(frozen=True)
class PassageRequest:
    t: TimeSpan
    declared: str


def align_passages(
    service: AlignmentService, clip: AudioClip, requests: Sequence[PassageRequest]
) -> list[dict[str, Any]]:
    """Aligne chaque passage ; une déclaration illisible, un passage hors du fichier ou un texte
    trop long pour sa durée donnent une entrée `error` sans arrêter les autres passages."""
    duration = len(clip.samples) / clip.sample_rate
    aligner = PassageAligner(service.texts, emittable_encoder(service.model), service.config)
    out: list[dict[str, Any]] = []
    for request in requests:
        entry: dict[str, Any] = {
            "declared": request.declared,
            "t": [round(request.t.start_s, 3), round(request.t.end_s, 3)],
        }
        out.append(entry)
        try:
            spans = parse_verse_spec(request.declared, service.texts.word_count)
            if request.t.end_s > duration + 1e-6 or request.t.duration_s > service.max_passage_s:
                raise ValueError(
                    f"passage {request.t.start_s:.1f}-{request.t.end_s:.1f} s invalide : le "
                    f"fichier dure {duration:.1f} s, un passage au plus "
                    f"{service.max_passage_s:.0f} s"
                )
            result = aligner.align(service.model.lattice(clip, request.t), spans)
        except (ValueError, KeyError) as exc:
            entry["error"] = str(exc.args[0] if isinstance(exc, KeyError) else exc)
            continue
        if result is None:
            entry["error"] = (
                f"le texte déclaré ({request.declared}) ne tient pas dans le passage : trop de "
                "mots pour sa durée"
            )
            continue
        entry.update(_passage_fields(service, result))
    return out


def _passage_fields(service: AlignmentService, result: PassageAlignment) -> dict[str, Any]:
    texts = service.texts
    return {
        "variant": result.variant.value,
        "evidence": {
            "llr_per_frame": round(result.evidence.llr_per_frame, 4),
            "forced_logprob": round(result.evidence.forced_logprob, 3),
            "free_logprob": round(result.evidence.free_logprob, 3),
            "frames": result.evidence.frames,
        },
        "spans": [_span_fields(texts, aligned) for aligned in result.spans],
    }


def _span_fields(texts: AlignmentTexts, aligned: AlignedSpan) -> dict[str, Any]:
    timing = {
        "t": [round(aligned.time.start_s, 3), round(aligned.time.end_s, 3)],
        "word_times": [
            [w.word, round(w.time.start_s, 3), round(w.time.end_s, 3)] for w in aligned.words
        ],
    }
    span = aligned.span
    if isinstance(span, Formula):
        return {"kind": "non_quran", "label": span.kind.value, **timing}
    return {
        "kind": "verse",
        "ref": str(span.ref),
        "words": [span.first_word, span.last_word],
        "partial": span != recited_span(span.ref, texts.word_count(span.ref)),
        **timing,
    }


def alignment_document(
    *, source: Mapping[str, Any], service: AlignmentService, passages: list[dict[str, Any]]
) -> dict[str, Any]:
    config = service.config
    return {
        "schema": SCHEMA,
        "kind": "forced_alignment",
        "notice": NOTICE,
        "source": dict(source),
        "engine": {"model": service.model.engine, "corpus": service.corpus_version},
        "config": {
            "energy_ratio": config.energy_ratio,
            "verse_end_extension_s": config.verse_end_extension_s,
            "variants": [v.value for v in config.variants],
        },
        "passages": passages,
    }


def read_plan(raw: Mapping[str, Any], sha256: str) -> list[PassageRequest]:
    """Passages d'un plan `aqr.align-plan/1` (proposé par `aqr plan-alignment`, corrigé par
    l'humain) ; refusé s'il a été établi pour un autre audio."""
    if raw.get("schema") != PLAN_SCHEMA:
        raise ValueError(f"plan : schéma {raw.get('schema')!r} inattendu (attendu {PLAN_SCHEMA})")
    expected = (raw.get("source") or {}).get("sha256")
    if expected and str(expected).lower() != sha256:
        raise ValueError("plan établi pour un autre audio (sha256 différent)")
    passages = raw.get("passages") or []
    if not passages:
        raise ValueError("plan sans passage")
    return [
        PassageRequest(TimeSpan(float(p["t"][0]), float(p["t"][1])), str(p["verses"]))
        for p in passages
    ]


def passage_of(at: str | None, duration_s: float) -> TimeSpan:
    """« a-b » en secondes (défaut : tout le fichier)."""
    if at is None:
        return TimeSpan(0.0, duration_s)
    try:
        start, end = (float(value) for value in at.split("-", 1))
    except ValueError as exc:
        raise ValueError(f"--at : « {at} » illisible (ex. 12.5-40)") from exc
    return TimeSpan(start, end)
