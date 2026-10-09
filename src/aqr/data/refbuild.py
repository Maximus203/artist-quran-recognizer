"""Construction du corpus de référence : mixages + silence + hors-cible + dégradations.

Réutilise `aqr.data.mixer` (scénarios et vérité exacte) et ses sources d'audio (`everyayah/`
téléchargé par `scripts/fetch_everyayah.py`, `speech/`, `specials/`). Les audios sont écrits dans
`out_dir` (hors dépôt) ; seul le manifeste (SHA-256 + métadonnées) est versionnable.
Schéma : `aqr.data.refcorpus`.
"""

from __future__ import annotations

import random
import wave
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

from aqr.data.config import DataConfig
from aqr.data.degrade import degrade, make_silence
from aqr.data.ingest import sha256_file
from aqr.data.manifest import AudioCase, Manifest, NonQuranItem
from aqr.data.mixer import ClipProvider, Mix, MixConfig, generate_mixes, write_wav
from aqr.data.refcorpus import (
    LICENSE_UNESTABLISHED,
    Degradation,
    RefCorpusError,
    RefMeta,
    assign_ref_splits,
    degraded_case,
    degraded_id,
    validate_ref_manifest,
    with_ref_meta,
)
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


@dataclass
class BuildReport:
    manifest: Manifest = field(default_factory=Manifest)
    skipped: list[tuple[str, str]] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)


def ensure_outside_repo(out_dir: Path, repo_root: Path) -> None:
    """Aucun audio dans git : refuse un dossier de sortie situé dans le dépôt."""
    resolved, root = out_dir.expanduser().resolve(), repo_root.resolve()
    if resolved == root or root in resolved.parents:
        raise RefCorpusError(f"{out_dir} est dans le dépôt : l'audio doit rester hors de git")


def _wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as handle:
        return round(handle.getnframes() / handle.getframerate(), 3)


def mix_to_case(mix: Mix, out_dir: Path, config: DataConfig, mix_config: MixConfig) -> AudioCase:
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
        extra={"scenario": mix.scenario, "seed": mix.seed},
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


def off_target_cases(
    provider: ClipProvider,
    out_dir: Path,
    config: DataConfig,
    *,
    seed: int,
    per_kind: int,
    skipped: list[tuple[str, str]],
) -> list[AudioCase]:
    cases = []
    lang = {
        NonQuranKind.FRENCH: ("fr",),
        NonQuranKind.ARABIC_SPEECH: ("ar",),
        NonQuranKind.OTHER_LANGUAGE: (),
    }
    for kind in OFF_TARGET_KINDS:
        for index in range(per_kind):
            samples = provider.speech(kind, random.Random(f"{seed}:offtarget:{kind.value}:{index}"))
            if samples is None:
                skipped.append((f"off_target:{kind.value}", f"aucun clip speech/{kind.value}_*"))
                break
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
                    recitant=f"speech-{kind.value}-{index}",
                    condition="off_target",
                    source=f"speech/{kind.value}_* (clip choisi par graine {seed})",
                    langues=lang[kind],
                    config=config,
                )
            )
    return cases


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
) -> BuildReport:
    """Écrit les audios dans `out_dir` et le manifeste dans `manifest_path` (idempotent)."""
    cfg = config or DataConfig()
    mix_config = MixConfig(sample_rate=cfg.sample_rate)
    report = BuildReport()
    mixes = generate_mixes(
        provider, corpus, seed=seed, per_scenario=per_scenario, scenarios=scenarios,
        config=mix_config,
    )  # fmt: skip
    report.skipped.extend(mixes.skipped)
    bases = [mix_to_case(m, out_dir, cfg, mix_config) for m in mixes.mixes]
    bases += silence_cases(out_dir, cfg)
    bases += off_target_cases(
        provider, out_dir, cfg, seed=seed, per_kind=per_scenario, skipped=report.skipped
    )

    existing = Manifest.load(manifest_path)
    replaced = {c.id for c in bases} | {
        degraded_id(c.id, d) for c in bases if c.expected for d in degradations
    }
    kept = [c for c in existing.cases if c.id not in replaced]
    split_bases = assign_ref_splits([*kept, *bases], cfg)[len(kept) :]

    children: list[AudioCase] = []
    for parent in split_bases:
        if parent.expected:  # on ne dégrade que les cas récités
            for degradation in degradations:
                path = out_dir / "degraded" / f"{degraded_id(parent.id, degradation)}.wav"
                degrade(degradation, out_dir / parent.file, path, sample_rate=cfg.sample_rate)
                children.append(
                    degraded_case(
                        parent, degradation, sha256=sha256_file(path), duree_s=_wav_duration(path)
                    )
                )
    final = Manifest(cases=[*kept, *split_bases, *children])
    report.problems = validate_ref_manifest(final, cfg)
    report.manifest = final
    if not report.problems:
        final.save(manifest_path)
    return report
