"""Ressources des smokes e2e (audio, ffmpeg, modèles, corpus vérifié) et mode strict.

`AQR_SMOKE_STRICT=1` (exporté par `scripts/smoke_e2e.sh`) : une ressource absente est un ÉCHEC
avec sa raison, jamais un skip qui laisse `pytest` rendre 0. Hors strict : skip avec la raison,
repris par le résumé « NON EXÉCUTÉ » de `tests/e2e/conftest.py`.

Le smoke navigateur (`web/e2e/browser-smoke.mjs`) réutilise ces contrôles sans les recopier :
    python -m tests.support.smoke_env --needs audio,ffmpeg,models,corpus   # JSON des manques
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import NoReturn

import pytest

from aqr.corpus.checksums import CorpusChecksumError, CorpusLock
from aqr.models.lock import ModelLockError, ModelsLock

ROOT = Path(__file__).resolve().parents[2]
STRICT_ENV = "AQR_SMOKE_STRICT"
RECITER = "Alafasy_128kbps"
SURAH = 112
VERSES = 4
NEEDS = ("audio", "ffmpeg", "models", "corpus")
# `aqr recognize --asr <asr>` charge ce modèle ASR et le segmenteur de récitation par défaut.
MODEL_KEYS = {
    "whisper": ("whisper-base-quran", "recitation-segmenter"),
    "fastconformer": ("fastconformer-quran", "recitation-segmenter"),
}


@dataclass(frozen=True)
class Missing:
    resource: str
    reason: str


def strict(env: Mapping[str, str] | None = None) -> bool:
    value = (os.environ if env is None else env).get(STRICT_ENV, "")
    return value.strip().lower() in {"1", "true", "yes", "on"}


def corpus_dir(env: Mapping[str, str]) -> Path:
    return Path(env.get("AQR_CORPUS_DIR") or ROOT / "data" / "corpus")


def clip_paths(audio_dir: Path) -> list[Path]:
    return [audio_dir / "everyayah" / RECITER / f"{SURAH:03d}{n:03d}.mp3" for n in range(1, 5)]


def find_missing(
    env: Mapping[str, str],
    needs: Sequence[str] = NEEDS,
    *,
    which: Callable[[str], str | None] | None = None,
    models_lock: Path = ROOT / "models" / "LOCK.json",
    asr: str = "whisper",
) -> list[Missing]:
    """Toutes les ressources manquantes parmi `needs`, avec la raison de chacune."""
    if asr not in MODEL_KEYS:
        raise ValueError(f"asr inconnu : {asr!r} ({' | '.join(MODEL_KEYS)})")
    find_executable = which or shutil.which
    checks: dict[str, Callable[[], str | None]] = {
        "audio": lambda: _audio_problem(env),
        "ffmpeg": lambda: None if find_executable("ffmpeg") else "ffmpeg absent du PATH",
        "models": lambda: _models_problem(env, models_lock, MODEL_KEYS[asr]),
        "corpus": lambda: _corpus_problem(env),
    }
    unknown = set(needs) - checks.keys()
    if unknown:
        raise ValueError(f"ressource inconnue : {sorted(unknown)}")
    problems = ((name, checks[name]()) for name in needs)
    return [Missing(name, reason) for name, reason in problems if reason]


def _audio_problem(env: Mapping[str, str]) -> str | None:
    if not env.get("AQR_AUDIO_DIR"):
        return "AQR_AUDIO_DIR absent (dossier hors dépôt, voir scripts/fetch_everyayah.py)"
    audio_dir = Path(env["AQR_AUDIO_DIR"])
    if not audio_dir.is_dir():
        return f"AQR_AUDIO_DIR={audio_dir} n'existe pas"
    absent = [clip for clip in clip_paths(audio_dir) if not clip.is_file()]
    if absent:
        return (
            f"clip EveryAyah absent : {absent[0]} ({len(absent)}/{VERSES} manquant(s) ; "
            f"lancer scripts/fetch_everyayah.py --reciters {RECITER} --surahs {SURAH})"
        )
    return None


def _models_problem(env: Mapping[str, str], lock_path: Path, keys: Sequence[str]) -> str | None:
    if not env.get("AQR_MODELS_DIR"):
        return "AQR_MODELS_DIR absent (scripts/fetch_models.py)"
    models_dir = Path(env["AQR_MODELS_DIR"])
    if not models_dir.is_dir():
        return f"AQR_MODELS_DIR={models_dir} n'existe pas"
    try:
        lock = ModelsLock.load(lock_path)
    except (ModelLockError, ValueError, KeyError) as exc:
        return f"{lock_path} illisible : {exc}"
    for key in keys:
        if key not in lock.models:
            return f"modèle {key!r} absent de {lock_path.name} (scripts/fetch_models.py)"
        for name, locked in lock.models[key].files.items():
            path = models_dir / key / name
            if not path.is_file():
                return f"{key}/{name} absent de {models_dir} (scripts/fetch_models.py)"
            if path.stat().st_size != locked.size:
                return (
                    f"{key}/{name} : taille {path.stat().st_size} != {locked.size} épinglée "
                    "(téléchargement incomplet ? scripts/fetch_models.py)"
                )
    return None


def _corpus_problem(env: Mapping[str, str]) -> str | None:
    directory = corpus_dir(env)
    lock_path = directory / "LOCK.json"
    if not lock_path.is_file():
        return f"LOCK.json introuvable dans {directory} (python scripts/fetch_corpus.py)"
    try:
        CorpusLock.load(lock_path).verify(directory)  # existence + sha256 de chaque fichier
    except (CorpusChecksumError, ValueError, KeyError, TypeError) as exc:
        return f"corpus non vérifié : {exc}"
    return None


def unavailable(missing: Sequence[Missing]) -> NoReturn:
    """Échec explicite en mode strict, skip net sinon."""
    detail = " ; ".join(f"{m.resource} : {m.reason}" for m in missing)
    if strict():
        pytest.fail(f"{STRICT_ENV}=1 : ressource(s) absente(s) — {detail}", pytrace=False)
    pytest.skip(f"{detail} ({STRICT_ENV}=1 en ferait un échec)")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Lister les ressources de smoke manquantes")
    parser.add_argument("--needs", default=",".join(NEEDS))
    parser.add_argument("--asr", default="whisper", choices=tuple(MODEL_KEYS))
    args = parser.parse_args(argv)
    missing = find_missing(os.environ, tuple(n for n in args.needs.split(",") if n), asr=args.asr)
    print(json.dumps([asdict(m) for m in missing], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
