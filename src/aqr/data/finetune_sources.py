"""Sources du jeu de fine-tuning de l'ASR (étape C) : dépôts, fichiers, licence, exclusions.

Révisions et empreintes : `data/finetune/LOCK.json` (versionné), jamais ici. Provenance, licences,
volumes et raisons des exclusions : `docs/evaluation/finetune-data.md`. EveryAyah et le lot 1 n'y
figurent pas : la décision d'usage provisoire interdit d'entraîner sur ces audios
(`docs/data-lots/ref-corpus-provenance.md`).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class SourceKind(StrEnum):
    TADABUR = "tadabur"
    """Parquet : un verset récité par ligne (audio WAV en octets, sourate, verset, récitant)."""
    FLEURS = "fleurs"
    """Parquet : une phrase lue par ligne (audio WAV en octets, transcription)."""
    COMMON_VOICE = "common_voice"
    """Archive tar de MP3 + TSV de transcriptions (format Common Voice)."""


@dataclass(frozen=True)
class DataUnit:
    pattern: str
    """Motif (fnmatch) des fichiers de données du dépôt."""
    split: str | None
    """Jeu imposé par le découpage officiel (locuteurs disjoints) ; None = tirage par locuteur."""
    transcript: str | None = None
    """Fichier de transcriptions associé (Common Voice) ; None si l'audio porte son texte."""


@dataclass(frozen=True)
class DatasetSpec:
    key: str
    repo_id: str
    kind: SourceKind
    license: str
    quran: bool
    """True : récitation (texte pris au corpus) ; False : parole arabe non coranique."""
    units: tuple[DataUnit, ...]
    aux: tuple[str, ...]
    """Petits fichiers toujours téléchargés (dictionnaires, transcriptions)."""
    role: str


@dataclass(frozen=True)
class ExcludedVoice:
    split: str
    """Jeu du dépôt où la voix sert déjà (`test`, ou `dev` par précaution)."""
    reason: str


TADABUR = "tadabur"

FINETUNE_SOURCES: dict[str, DatasetSpec] = {
    spec.key: spec
    for spec in (
        DatasetSpec(
            key=TADABUR,
            repo_id="FaisaI/tadabur",
            kind=SourceKind.TADABUR,
            license="cc-by-nc-4.0",
            quran=True,
            units=(DataUnit("data/train-*.parquet", None),),
            aux=("sheikh_dict.json",),
            role="récitation : 1 400 h, 600+ récitants, verset par verset",
        ),
        DatasetSpec(
            key="fleurs-ar",
            repo_id="google/fleurs",
            kind=SourceKind.FLEURS,
            license="cc-by-4.0",
            quran=False,
            units=(
                DataUnit("parquet-data/ar_eg/train-*.parquet", "train"),
                DataUnit("parquet-data/ar_eg/validation-*.parquet", "val"),
            ),
            aux=(),
            role="arabe lu non coranique (phrases Wikipédia), découpage officiel",
        ),
        DatasetSpec(
            key="common-voice-ar",
            repo_id="fsicoli/common_voice_17_0",
            kind=SourceKind.COMMON_VOICE,
            license="cc0-1.0",
            quran=False,
            units=(
                DataUnit("audio/ar/train/ar_train_*.tar", "train", "transcript/ar/train.tsv"),
                DataUnit("audio/ar/dev/ar_dev_*.tar", "val", "transcript/ar/dev.tsv"),
            ),
            aux=("transcript/ar/train.tsv", "transcript/ar/dev.tsv"),
            role="arabe lu non coranique, miroir non officiel de Common Voice 17.0 (CC0)",
        ),
    )
}

# Voix Tadabur (`reciter_id` de `sheikh_dict.json`, révision épinglée) déjà présentes dans les jeux
# d'évaluation du dépôt : jamais en entraînement ni en validation. Aucun nom de personne ici pour le
# lot 1 (identifiants anonymes, docs/DATA-COLLECTION.md) ; la correspondance a été faite à la main,
# méthode et limites dans docs/evaluation/finetune-data.md.
EXCLUDED_TADABUR_RECITERS: dict[int, ExcludedVoice] = {
    33: ExcludedVoice("test", "corpus de référence, jeu test (Husary_128kbps) ; aussi lot 1, dev"),
    2: ExcludedVoice("test", "lot 1, jeu test"),
    128: ExcludedVoice("test", "lot 1, jeu test"),
    63: ExcludedVoice("dev", "corpus de référence, jeu dev (Alafasy_128kbps)"),
    86: ExcludedVoice("dev", "lot 1, jeu dev"),
}
