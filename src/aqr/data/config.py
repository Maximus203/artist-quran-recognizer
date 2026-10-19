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
    derived_duration_tolerance_s: float = 0.25
    """Écart toléré entre la durée d'un cas dégradé et celle de son parent (+ décalage) : queue
    de réverbération (0,18 s avec les réglages par défaut) et remplissage MP3."""
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
    mix_recitant_prefix: str = "mix-"
    """Préfixe du récitant d'un mixage local (`mixer.materialize`) : `mix-<reciter>` en minuscules.
    Même voix que `<reciter>` : la quarantaine suit cet alias."""
    quarantine_split: str = "quarantaine"
    """Split d'un récitant dont le jeu `test` a été exposé pendant le réglage : ni évalué, ni
    utilisé au réglage, hors du ratio dev/test, définitif
    (docs/evaluation/protocole-reglage-evaluation.md). Volontairement absent de `splits`
    (= les seuls jeux évaluables)."""


@dataclass(frozen=True)
class FinetuneConfig:
    """Jeu de données du fine-tuning de l'ASR (étape C, docs/evaluation/finetune-data.md)."""

    sample_rate: int = DataConfig.sample_rate
    """Fréquence des WAV extraits (mono, PCM 16 bits) : celle du FastConformer."""
    val_ratio: float = 0.02
    """Part des LOCUTEURS (non de la durée) envoyée en validation quand la source n'a pas de
    découpage officiel (Tadabur) ; tirage par hachage salé, un locuteur n'est que d'un côté."""
    split_seed: str = "aqr-finetune-v1"
    """Sel du hachage train/val : change l'affectation, jamais le principe."""
    min_duration_s: float = 0.5
    max_duration_s: float = 60.0
    """Bornes de durée d'un exemple EXTRAIT. 60 s garde 97,7 % des heures de Tadabur (30 s : 82 %,
    mesuré sur un shard réel) : la borne d'entraînement, qui dépend de la mémoire GPU, se règle
    dans la configuration NeMo (`max_duration`), pas ici."""
    quran_ngram: int = 4
    """Une phrase « non coranique » qui partage N mots consécutifs (normalisés) avec un verset
    est écartée : Common Voice arabe contient des versets lus (I3/I4)."""
    env_var: str = "AQR_FINETUNE_DIR"
    """Dossier hors dépôt des fichiers téléchargés, des WAV extraits et des manifestes."""
    train_split: str = "train"
    val_split: str = "val"
