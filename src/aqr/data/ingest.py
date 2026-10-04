"""`aqr data ingest` : de `inbox/` au manifeste (docs/DATA-COLLECTION.md §5, étape 1).

Pour chaque audio déposé avec sa fiche `.yaml` : validation stricte de la fiche, SHA-256,
rangement par catégorie, WAV dérivé (mono, `config.sample_rate`) dans `_derived/`, ajout au
manifeste avec le statut `a_annoter`. Idempotent : un contenu déjà connu (même SHA-256) n'est
jamais dupliqué, et un fichier en erreur n'empêche pas le traitement des autres.
"""

from __future__ import annotations

import hashlib
import re
import shutil
import subprocess
import wave
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from aqr.data.config import DataConfig
from aqr.data.fiche import Fiche, FicheError, load_fiche
from aqr.data.manifest import AudioCase, Manifest

Converter = Callable[[Path, Path, int], None]
"""(source, destination WAV, fréquence) -> écrit un WAV mono PCM 16 bits."""


@dataclass
class IngestReport:
    added: list[str] = field(default_factory=list)
    duplicates: list[tuple[str, str]] = field(default_factory=list)
    """(nom du fichier déposé, id du cas déjà connu)."""
    errors: list[tuple[str, list[str]]] = field(default_factory=list)
    """(nom du fichier, problèmes lisibles)."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ffmpeg_converter(src: Path, dest: Path, sample_rate: int) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise RuntimeError("ffmpeg introuvable dans le PATH (requis pour dériver le WAV)")
    subprocess.run(
        [
            ffmpeg, "-nostdin", "-y", "-v", "error", "-i", str(src), "-vn",
            "-ac", "1", "-ar", str(sample_rate), "-c:a", "pcm_s16le", str(dest),
        ],
        check=True,
        capture_output=True,
    )  # fmt: skip


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as handle:
        return handle.getnframes() / handle.getframerate()


def slugify(stem: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")
    return slug or "audio"


def _derive(src: Path, derived: Path, convert: Converter, config: DataConfig) -> float:
    derived.parent.mkdir(parents=True, exist_ok=True)
    tmp = derived.with_suffix(".tmp.wav")
    try:
        convert(src, tmp, config.sample_rate)
        duration = wav_duration(tmp)
        tmp.replace(derived)
    finally:
        tmp.unlink(missing_ok=True)
    return duration


def _audio_files(inbox: Path, config: DataConfig) -> list[Path]:
    if not inbox.is_dir():
        return []
    return sorted(
        p for p in inbox.iterdir() if p.is_file() and p.suffix.lower() in config.audio_extensions
    )


def ingest(
    inbox: Path,
    audio_dir: Path,
    manifest_path: Path,
    *,
    config: DataConfig,
    convert: Converter = ffmpeg_converter,
) -> IngestReport:
    report = IngestReport()
    manifest = Manifest.load(manifest_path)
    derived_dir = audio_dir / "_derived"

    for audio in _audio_files(inbox, config):
        sidecar = audio.with_suffix(".yaml")
        if not sidecar.exists():
            report.errors.append((audio.name, [f"fiche absente : {sidecar.name} attendue à côté"]))
            continue
        try:
            fiche = load_fiche(sidecar, config)
        except FicheError as exc:
            report.errors.append((audio.name, exc.problems))
            continue
        if fiche.fichier != audio.name:
            report.errors.append(
                (audio.name, [f"fichier : la fiche annonce {fiche.fichier!r}, pas {audio.name!r}"])
            )
            continue

        sha = sha256_file(audio)
        case_id = slugify(fiche.id or audio.stem)
        known = manifest.by_sha(sha)
        if known is not None:
            wav = derived_dir / f"{known.id}.wav"
            if not wav.exists():
                _derive(audio, wav, convert, config)
            report.duplicates.append((audio.name, known.id))
            continue
        if any(c.id == case_id for c in manifest.cases):
            report.errors.append(
                (
                    audio.name,
                    [f"id {case_id!r} déjà pris par un autre contenu (ajouter `id:` à la fiche)"],
                )
            )
            continue

        try:
            duration = _derive(audio, derived_dir / f"{case_id}.wav", convert, config)
        except (subprocess.CalledProcessError, RuntimeError, wave.Error, OSError) as exc:
            report.errors.append((audio.name, [f"conversion WAV impossible : {exc}"]))
            continue

        target_dir = audio_dir / fiche.categorie[0]
        target_dir.mkdir(parents=True, exist_ok=True)
        shutil.move(str(audio), target_dir / audio.name)
        shutil.move(str(sidecar), target_dir / sidecar.name)
        manifest.upsert(_new_case(case_id, fiche, sha, duration, config))
        manifest.save(manifest_path)
        report.added.append(case_id)
    return report


def _new_case(
    case_id: str, fiche: Fiche, sha: str, duration: float, config: DataConfig
) -> AudioCase:
    return AudioCase(
        id=case_id,
        file=f"{fiche.categorie[0]}/{fiche.fichier}",
        sha256=sha,
        categorie=fiche.categorie,
        recitant=fiche.recitant,
        riwaya=fiche.riwaya,
        langues=fiche.langues,
        license=fiche.droits,
        duree_s=round(duration, 3),
        statut=config.statut_a_annoter,
        source=fiche.source,
        tolerance_ms=config.tolerance_ms,
    )
