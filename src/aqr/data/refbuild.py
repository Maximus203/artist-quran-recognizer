"""Construction du corpus de référence : mixages + silence + hors-cible + dégradations.

Réutilise `aqr.data.mixer` (scénarios et vérité exacte) et ses sources d'audio (`everyayah/`
téléchargé par `scripts/fetch_everyayah.py`, `speech/`, `specials/`). Les audios sont écrits dans
`out_dir` (hors dépôt) ; seul le manifeste (SHA-256 + métadonnées) est versionnable.
Schéma : `aqr.data.refcorpus`.
"""

from __future__ import annotations

import random
import wave
from array import array
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from aqr.data.config import DataConfig
from aqr.data.degrade import degrade, make_silence
from aqr.data.everyayah import bismillah_clip_path
from aqr.data.ingest import sha256_file
from aqr.data.manifest import AudioCase, Manifest, NonQuranItem
from aqr.data.mixer import (
    SCENARIOS,
    ClipProvider,
    ClipUse,
    DiskClipProvider,
    Mix,
    MixConfig,
    OriginProvider,
    clip_digest,
    generate_mixes,
    write_wav,
)
from aqr.data.refcorpus import (
    LICENSE_UNESTABLISHED,
    SOURCES_KEY,
    Degradation,
    RefCorpusError,
    RefMeta,
    assign_ref_splits,
    case_sources,
    claim_sources,
    degraded_case,
    degraded_id,
    frozen_splits,
    ref_meta,
    validate_ref_manifest,
    with_ref_meta,
)
from aqr.data.reftrace import build_trace, trace_path, write_trace
from aqr.domain.models import NonQuranKind
from aqr.domain.ports import CorpusRepository

DEFAULT_DEGRADATIONS: tuple[Degradation, ...] = (
    Degradation("noise", {"snr_db": 20, "seed": 1}),
    Degradation("noise", {"snr_db": 10, "seed": 1}),
    Degradation("noise", {"snr_db": 0, "seed": 1}),
    Degradation("telephone"),
    Degradation("reverb", {"decay": 0.4, "delay_ms": 60}),
    Degradation("mp3_low", {"kbps": 32}),
    Degradation("silence_pad", {"pad_s": 2}, shift_s=2.0),
)
OFF_TARGET_KINDS = (NonQuranKind.FRENCH, NonQuranKind.ARABIC_SPEECH, NonQuranKind.OTHER_LANGUAGE)
SILENCE_DURATIONS_S = (5.0, 30.0)
_CATEGORY = {
    NonQuranKind.FRENCH: "C09",
    NonQuranKind.ARABIC_SPEECH: "C10",
    NonQuranKind.OTHER_LANGUAGE: "C10",
    NonQuranKind.SILENCE: "C12",
}
SILENCE_RECITANT = "synthetic-silence"
OFF_TARGET_MAX_DRAWS = 50
"""Tirages tentés pour trouver un clip encore inutilisé avant de conclure qu'il n'y en a plus."""


@dataclass
class BuildReport:
    manifest: Manifest = field(default_factory=Manifest)
    skipped: list[tuple[str, str]] = field(default_factory=list)
    removed: list[tuple[str, str]] = field(default_factory=list)
    """(id, raison) : cas de l'ancien manifeste qui n'ont pas été conservés."""
    problems: list[str] = field(default_factory=list)
    trace: dict[str, Any] = field(default_factory=dict)
    """Contenu de `manifest.build.json` (écrit avec le manifeste quand il n'y a aucun problème)."""


@runtime_checkable
class ExclusionReporter(Protocol):
    """Fournisseur qui écarte des récitants et sait dire pourquoi."""

    def excluded_reciters(self) -> tuple[tuple[str, str], ...]: ...


class ReferenceClipProvider(DiskClipProvider):
    """Sources disque, sans les récitants dont la basmala manque (EveryAyah n'en publie pas pour
    tous) : le mixeur en a besoin pour les versets 1, et mieux vaut un récitant de moins qu'un
    mixage sans vérité. Les récitants écartés sont listés par `excluded_reciters`."""

    def _without_basmala(self) -> tuple[str, ...]:
        root = self._dir / "everyayah"
        return tuple(r for r in super().reciters() if not bismillah_clip_path(root, r).exists())

    def reciters(self) -> tuple[str, ...]:
        missing = set(self._without_basmala())
        return tuple(r for r in super().reciters() if r not in missing)

    def excluded_reciters(self) -> tuple[tuple[str, str], ...]:
        return tuple(
            (r, "bismillah.mp3 absent : EveryAyah ne publie pas la basmala de ce récitant")
            for r in self._without_basmala()
        )


def ensure_outside_repo(out_dir: Path, repo_root: Path) -> None:
    """Aucun audio dans git : refuse un dossier de sortie situé dans le dépôt."""
    resolved, root = out_dir.expanduser().resolve(), repo_root.resolve()
    if resolved == root or root in resolved.parents:
        raise RefCorpusError(f"{out_dir} est dans le dépôt : l'audio doit rester hors de git")


def _wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as handle:
        return round(handle.getnframes() / handle.getframerate(), 3)


def source_entries(provider: ClipProvider, clips: Iterable[ClipUse]) -> list[dict[str, str]]:
    """Provenance des clips non récités : `kind`, `file` (si le fournisseur a des fichiers) et
    `sha256` (du fichier, à défaut des échantillons)."""
    entries = []
    for clip in clips:
        origin = provider.origin(clip.digest) if isinstance(provider, OriginProvider) else None
        entries.append(
            {
                "kind": clip.kind.value,
                **({"file": origin.name} if origin else {}),
                "sha256": origin.sha256 if origin else clip.digest,
            }
        )
    return entries


def mix_to_case(
    mix: Mix,
    out_dir: Path,
    config: DataConfig,
    mix_config: MixConfig,
    sources: Sequence[dict[str, str]] = (),
) -> AudioCase:
    case_id = f"ref-{mix.id}"
    target = out_dir / "mix" / f"{case_id}.wav"
    target.parent.mkdir(parents=True, exist_ok=True)
    write_wav(target, mix.samples, mix_config.sample_rate)
    case = AudioCase(
        id=case_id,
        file=f"mix/{case_id}.wav",
        sha256=sha256_file(target),
        categorie=mix.categorie,
        recitant=mix.reciter,
        riwaya="hafs",
        langues=mix.langues,
        license=LICENSE_UNESTABLISHED,
        duree_s=_wav_duration(target),
        statut=config.statut_annote,
        source=f"mixage de clips everyayah.com/data/{mix.reciter}",
        tolerance_ms=(
            mix_config.approximate_tolerance_ms
            if mix.boundaries == "approximate"
            else config.tolerance_ms
        ),
        origine="mix",
        boundaries=mix.boundaries,
        expected=mix.expected,
        non_quran=mix.non_quran,
        extra={
            "scenario": mix.scenario,
            "seed": mix.seed,
            **({SOURCES_KEY: list(sources)} if sources else {}),
        },
    )
    return with_ref_meta(case, RefMeta(condition="clean", non_quran=not mix.expected))


def _non_quran_case(
    case_id: str,
    path: Path,
    out_dir: Path,
    kind: NonQuranKind,
    *,
    recitant: str,
    condition: str,
    source: str,
    langues: tuple[str, ...],
    config: DataConfig,
    sources: Sequence[dict[str, str]] = (),
) -> AudioCase:
    duration = _wav_duration(path)
    case = AudioCase(
        id=case_id,
        file=str(path.relative_to(out_dir)),
        sha256=sha256_file(path),
        categorie=(_CATEGORY[kind],),
        recitant=recitant,
        riwaya="inconnu",
        langues=langues,
        license=LICENSE_UNESTABLISHED,
        duree_s=duration,
        statut=config.statut_annote,
        source=source,
        tolerance_ms=config.tolerance_ms,
        origine="mix",
        non_quran=(NonQuranItem((0.0, duration), kind),),
        extra={SOURCES_KEY: list(sources)} if sources else {},
    )
    return with_ref_meta(case, RefMeta(condition=condition, non_quran=True))


def silence_cases(out_dir: Path, config: DataConfig) -> list[AudioCase]:
    cases = []
    for seconds in SILENCE_DURATIONS_S:
        case_id = f"ref-silence-{seconds:g}s"
        path = out_dir / "generated" / f"{case_id}.wav"
        make_silence(path, seconds, sample_rate=config.sample_rate)
        cases.append(
            _non_quran_case(
                case_id,
                path,
                out_dir,
                NonQuranKind.SILENCE,
                recitant=SILENCE_RECITANT,
                condition="silence",
                source="ffmpeg anullsrc",
                langues=(),
                config=config,
            )
        )
    return cases


def _draw_speech(
    provider: ClipProvider, kind: NonQuranKind, seed: int, index: int, seen: set[str]
) -> array[int] | None:
    """Premier clip de `kind` pas encore utilisé, tiré de façon reproductible (None : aucun)."""
    for attempt in range(OFF_TARGET_MAX_DRAWS):
        tag = f"{seed}:offtarget:{kind.value}:{index}" + (f":{attempt}" if attempt else "")
        samples = provider.speech(kind, random.Random(tag))
        if samples is None:
            return None
        if clip_digest(samples) not in seen:
            return samples
    return None


def off_target_cases(
    provider: ClipProvider,
    out_dir: Path,
    config: DataConfig,
    *,
    seed: int,
    per_kind: int,
    skipped: list[tuple[str, str]],
) -> list[AudioCase]:
    """Un cas par enregistrement distinct (jamais deux fois le même audio), `per_kind` au plus.

    Le pseudo-récitant est dérivé du contenu (`speech-<nature>-<sha256 des échantillons>`) : le
    même enregistrement donne toujours le même récitant, donc le même jeu.
    """
    cases = []
    lang = {
        NonQuranKind.FRENCH: ("fr",),
        NonQuranKind.ARABIC_SPEECH: ("ar",),
        NonQuranKind.OTHER_LANGUAGE: (),
    }
    for kind in OFF_TARGET_KINDS:
        seen: set[str] = set()
        for index in range(per_kind):
            samples = _draw_speech(provider, kind, seed, index, seen)
            if samples is None:
                reason = (
                    f"aucun clip speech/{kind.value}_*"
                    if not seen
                    else f"{len(seen)} clip(s) distinct(s) seulement, {per_kind} demandé(s)"
                )
                skipped.append((f"off_target:{kind.value}", reason))
                break
            digest = clip_digest(samples)
            seen.add(digest)
            (entry,) = source_entries(provider, [ClipUse(kind, digest)])
            case_id = f"ref-offtarget-{kind.value}-{index}"
            path = out_dir / "generated" / f"{case_id}.wav"
            path.parent.mkdir(parents=True, exist_ok=True)
            write_wav(path, samples, config.sample_rate)
            cases.append(
                _non_quran_case(
                    case_id,
                    path,
                    out_dir,
                    kind,
                    recitant=f"speech-{kind.value}-{digest[:12]}",
                    condition="off_target",
                    source=f"parole hors cible {entry.get('file', f'speech/{kind.value}_*')}",
                    langues=lang[kind],
                    config=config,
                    sources=[entry],
                )
            )
    return cases


def degrade_cases(
    parents: Sequence[AudioCase],
    out_dir: Path,
    degradations: Sequence[Degradation],
    config: DataConfig,
) -> list[AudioCase]:
    """Dégrade chaque cas récité (audio dans `out_dir/degraded/`) : un dérivé par dégradation,
    avec la vérité du parent décalée de `shift_s` et le split du parent."""
    children: list[AudioCase] = []
    for parent in parents:
        if not parent.expected:  # on ne dégrade que les cas récités
            continue
        for degradation in degradations:
            path = out_dir / "degraded" / f"{degraded_id(parent.id, degradation)}.wav"
            degrade(degradation, out_dir / parent.file, path, sample_rate=config.sample_rate)
            children.append(
                degraded_case(
                    parent, degradation, sha256=sha256_file(path), duree_s=_wav_duration(path)
                )
            )
    return children


def _parent_id(case: AudioCase) -> str | None:
    try:
        return ref_meta(case).parent
    except RefCorpusError:
        return None  # bloc ref illisible : conservé tel quel, la validation finale le signalera


def _kept_cases(
    existing: Manifest,
    bases: Sequence[AudioCase],
    degradations: Sequence[Degradation],
    removed: list[tuple[str, str]],
) -> list[AudioCase]:
    """Cas de l'ancien manifeste que cette construction ne régénère pas.

    Un dérivé dont le parent est régénéré n'est jamais gardé : son audio vient de l'ancien parent.
    Si sa dégradation est encore demandée il est régénéré ; sinon il est retiré et signalé.
    """
    base_ids = {c.id for c in bases}
    regenerated = base_ids | {
        degraded_id(c.id, d) for c in bases if c.expected for d in degradations
    }
    kept = []
    for case in existing.cases:
        if case.id in regenerated:
            continue
        parent = _parent_id(case)
        if parent in base_ids:
            label = case.id.removeprefix(f"{parent}--")
            removed.append(
                (case.id, f"dégradation {label} absente de ce lancement : parent {parent} régénéré")
            )
            continue
        kept.append(case)
    return kept


def _claim_or_drop(
    cases: Sequence[AudioCase],
    claims: dict[str, str],
    out_dir: Path,
    skipped: list[tuple[str, str]],
) -> list[AudioCase]:
    """Écarte (et signale) les cas dont une source est déjà dans l'autre jeu ; efface leur audio."""
    kept, dropped = claim_sources(cases, claims)
    for case, reason in dropped:
        skipped.append((case.id, reason))
        (out_dir / case.file).unlink(missing_ok=True)
    return kept


def build_ref_corpus(
    provider: ClipProvider,
    corpus: CorpusRepository,
    out_dir: Path,
    manifest_path: Path,
    *,
    seed: int,
    per_scenario: int,
    scenarios: Sequence[str] | None = None,
    degradations: Sequence[Degradation] = DEFAULT_DEGRADATIONS,
    config: DataConfig | None = None,
    environment: Mapping[str, Any] | None = None,
) -> BuildReport:
    """Écrit les audios dans `out_dir`, le manifeste dans `manifest_path` et, à côté, sa trace de
    construction `manifest.build.json` (idempotent). `environment` (commande, SHA git...) est
    recopié tel quel dans la trace : seul l'appelant le connaît."""
    cfg = config or DataConfig()
    mix_config = MixConfig(sample_rate=cfg.sample_rate)
    report = BuildReport()
    existing = Manifest.load(manifest_path)
    # avant d'écrire quoi que ce soit : une fuite du manifeste existant arrête le build
    frozen = frozen_splits(existing.cases, cfg)
    excluded = provider.excluded_reciters() if isinstance(provider, ExclusionReporter) else ()
    report.skipped.extend((f"reciter:{name}", reason) for name, reason in excluded)
    mixes = generate_mixes(
        provider, corpus, seed=seed, per_scenario=per_scenario, scenarios=scenarios,
        config=mix_config,
    )  # fmt: skip
    report.skipped.extend(mixes.skipped)
    mix_bases = [
        mix_to_case(m, out_dir, cfg, mix_config, source_entries(provider, m.clips))
        for m in mixes.mixes
    ]
    mix_bases += silence_cases(out_dir, cfg)
    off_bases = off_target_cases(
        provider, out_dir, cfg, seed=seed, per_kind=per_scenario, skipped=report.skipped
    )

    kept = _kept_cases(existing, [*mix_bases, *off_bases], degradations, report.removed)
    claims: dict[str, str] = {}
    claim_sources(kept, claims)  # enregistrements déjà réclamés par les cas conservés
    # 1) mixages et silence : jeu du récitant ; un enregistrement source ne sert qu'à un jeu
    mix_bases = assign_ref_splits([*kept, *mix_bases], cfg, frozen=frozen)[len(kept) :]
    mix_bases = _claim_or_drop(mix_bases, claims, out_dir, report.skipped)
    # 2) parole hors cible : un pseudo-récitant par enregistrement, du côté qui le réclame déjà
    pins = {
        c.recitant: claims[s["sha256"]]
        for c in off_bases
        for s in case_sources(c)
        if s["sha256"] in claims
    }
    off_bases = assign_ref_splits([*kept, *mix_bases, *off_bases], cfg, frozen={**pins, **frozen})[
        len(kept) + len(mix_bases) :
    ]
    off_bases = _claim_or_drop(off_bases, claims, out_dir, report.skipped)
    split_bases = [*mix_bases, *off_bases]

    children = degrade_cases(split_bases, out_dir, degradations, cfg)
    final = Manifest(cases=[*kept, *split_bases, *children])
    report.problems = validate_ref_manifest(final, cfg)
    report.manifest = final
    report.trace = build_trace(
        manifest=final,
        manifest_path=manifest_path,
        out_dir=out_dir,
        seed=seed,
        per_scenario=per_scenario,
        scenarios=list(scenarios) if scenarios else sorted(SCENARIOS),
        degradations=degradations,
        config=cfg,
        retained=provider.reciters(),
        excluded=excluded,
        skipped=report.skipped,
        removed=report.removed,
        environment=environment,
    )
    if not report.problems:
        final.save(manifest_path)
        write_trace(trace_path(manifest_path), report.trace)
    return report
