"""Configuration de l'outillage de données (aucune valeur codée en dur ailleurs)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DataConfig:
    sample_rate: int = 16000
    """Fréquence du WAV dérivé (mono) : celle attendue par les ASR (B1)."""
    tolerance_ms: int = 300
    """Tolérance de frontière par défaut d'un cas (docs/ARCHITECTURE.md §7)."""
    dev_ratio: float = 0.7
    """Part de la durée affectée à `dev` (le reste en `test`), par récitant."""
    split_seed: str = "aqr-split-v1"
    """Sel du hachage qui ordonne les récitants : change l'affectation, jamais le principe."""
    audio_extensions: tuple[str, ...] = (
        ".mp3",
        ".m4a",
        ".wav",
        ".ogg",
        ".opus",
        ".flac",
        ".mp4",
        ".mkv",
        ".webm",
        ".aac",
    )
    categories: tuple[str, ...] = tuple(f"C{n:02d}" for n in range(1, 16))
    """C01–C15 (docs/TEST-CORPUS.md)."""
    riwayas: tuple[str, ...] = ("hafs", "warsh", "inconnu")
    manifest_version: int = 1
    statut_a_annoter: str = "a_annoter"
    statut_annote: str = "annote"
    splits: tuple[str, ...] = ("dev", "test")
