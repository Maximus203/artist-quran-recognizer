"""Ressources des smokes e2e (audio, ffmpeg, modèles, corpus vérifié) et mode strict.

Le mode strict est le DÉFAUT (variable absente ou vide, `scripts/smoke_e2e.sh` l'exporte aussi) :
une ressource absente est un ÉCHEC avec sa raison, jamais un skip qui laisse `pytest` rendre 0.
Seul `AQR_SMOKE_STRICT=0` (explicite) autorise le skip avec la raison, repris par le résumé
« NON EXÉCUTÉ » de `tests/e2e/conftest.py`.

Moteur du smoke CLI : `AQR_SMOKE_ASR` = `whisper` (défaut) | `fastconformer`. Le contrôle porte sur
les modèles de CE moteur (`MODEL_KEYS`) et sur l'interpréteur qui le fait tourner (`AQR_PYTHON`,
sinon celui de pytest) : FastConformer exige le venv NeMo. Une valeur inconnue est une ressource
manquante nommée « asr » (échec en strict), jamais un repli silencieux sur Whisper. Le smoke
navigateur lit `AQR_SMOKE_ASR` puis, à défaut, son ancien nom `AQR_ASR`.

Le smoke navigateur (`web/e2e/browser-smoke.mjs`) réutilise ces contrôles sans les recopier :
    python -m tests.support.smoke_env --needs audio,ffmpeg,models,corpus   # JSON des manques
Ce module n'importe pas pytest au chargement (l'interpréteur du moteur n'en a pas forcément).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import NoReturn

from aqr.corpus.checksums import CorpusChecksumError, CorpusLock
from aqr.models.lock import ModelLockError, ModelsLock

ROOT = Path(__file__).resolve().parents[2]
STRICT_ENV = "AQR_SMOKE_STRICT"
RECITER = "Alafasy_128kbps"
SURAH = 112
VERSES = 4
NEEDS = ("audio", "ffmpeg", "models", "corpus")
ENGINE_NEED = "engine"  # interpréteur du moteur choisi : demandé explicitement, pas par défaut
ASR_ENV = "AQR_SMOKE_ASR"
DEFAULT_ASR = "whisper"
MODELS_LOCK = ROOT / "models" / "LOCK.json"
# `aqr recognize --asr <asr>` charge ce modèle ASR et le segmenteur de récitation par défaut.
MODEL_KEYS = {
    "whisper": ("whisper-base-quran", "recitation-segmenter"),
    "fastconformer": ("fastconformer-quran", "recitation-segmenter"),
}


# Module qui prouve que l'interpréteur sait faire tourner le moteur.
ENGINE_MODULE = {"whisper": "transformers", "fastconformer": "nemo"}


class UnknownAsr(ValueError):
    """`AQR_SMOKE_ASR` ne désigne aucun moteur connu."""


@dataclass(frozen=True)
class Missing:
    resource: str
    reason: str


_NOT_STRICT = {"0", "false", "no", "off"}


def strict(env: Mapping[str, str] | None = None) -> bool:
    """Vrai sauf refus explicite (`AQR_SMOKE_STRICT=0|false|no|off`) : un oubli reste strict."""
    value = (os.environ if env is None else env).get(STRICT_ENV, "")
    return value.strip().lower() not in _NOT_STRICT


def selected_asr(env: Mapping[str, str]) -> str:
    """Moteur du smoke : `AQR_SMOKE_ASR` (insensible à la casse), `whisper` si absent ou vide."""
    value = env.get(ASR_ENV, "").strip().lower() or DEFAULT_ASR
    if value not in MODEL_KEYS:
        raise UnknownAsr(f"{ASR_ENV}={env.get(ASR_ENV)!r} inconnu ({' | '.join(MODEL_KEYS)})")
    return value


def engine_python(env: Mapping[str, str]) -> str:
    """Interpréteur qui fait tourner le moteur : `AQR_PYTHON`, sinon celui qui exécute pytest."""
    return env.get("AQR_PYTHON") or sys.executable


def module_problem(python: str, module: str) -> str | None:
    """Pourquoi `python` ne peut pas servir à `module` (sans l'importer), sinon `None`."""
    code = "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec(sys.argv[1]) else 1)"
    try:
        done = subprocess.run(
            [python, "-c", code, module], capture_output=True, timeout=60, check=False
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return f"interpréteur inexécutable : {exc}"
    if done.returncode != 0:
        return f"module {module!r} introuvable"
    return None


_DEFAULT_MODULE_CHECK = module_problem  # `find_missing(module_problem=...)` masque le nom


def corpus_dir(env: Mapping[str, str]) -> Path:
    return Path(env.get("AQR_CORPUS_DIR") or ROOT / "data" / "corpus")


def clip_paths(audio_dir: Path) -> list[Path]:
    return [audio_dir / "everyayah" / RECITER / f"{SURAH:03d}{n:03d}.mp3" for n in range(1, 5)]


def find_missing(
    env: Mapping[str, str],
    needs: Sequence[str] = NEEDS,
    *,
    which: Callable[[str], str | None] | None = None,
    models_lock: Path | None = None,
    asr: str | None = None,
    module_problem: Callable[[str, str], str | None] | None = None,
) -> list[Missing]:
    """Toutes les ressources manquantes parmi `needs`, avec la raison de chacune.

    `asr` : moteur explicite (inconnu : `ValueError`) ; sinon celui de `AQR_SMOKE_ASR` dans `env`
    (inconnu : ressource « asr » manquante, les contrôles propres au moteur sont alors omis)."""
    unknown_asr: Missing | None = None
    if asr is None:
        try:
            asr = selected_asr(env)
        except UnknownAsr as exc:
            unknown_asr = Missing("asr", str(exc))
            asr = DEFAULT_ASR  # seulement pour les contrôles indépendants du moteur
    elif asr not in MODEL_KEYS:
        raise ValueError(f"asr inconnu : {asr!r} ({' | '.join(MODEL_KEYS)})")
    engine_asr = asr
    find_executable = which or shutil.which
    check_module = module_problem or _DEFAULT_MODULE_CHECK
    lock_path = models_lock or MODELS_LOCK
    checks: dict[str, Callable[[], str | None]] = {
        "audio": lambda: _audio_problem(env),
        "ffmpeg": lambda: None if find_executable("ffmpeg") else "ffmpeg absent du PATH",
        "models": lambda: _models_problem(env, lock_path, MODEL_KEYS[engine_asr]),
        "corpus": lambda: _corpus_problem(env),
        ENGINE_NEED: lambda: _engine_problem(env, engine_asr, check_module),
    }
    unknown = set(needs) - checks.keys()
    if unknown:
        raise ValueError(f"ressource inconnue : {sorted(unknown)}")
    engine_specific = {"models", ENGINE_NEED}
    wanted = [n for n in needs if not (unknown_asr and n in engine_specific)]
    problems = ((name, checks[name]()) for name in wanted)
    found = [Missing(name, reason) for name, reason in problems if reason]
    return [unknown_asr, *found] if unknown_asr else found


def _engine_problem(
    env: Mapping[str, str], asr: str, check_module: Callable[[str, str], str | None]
) -> str | None:
    python = engine_python(env)
    problem = check_module(python, ENGINE_MODULE[asr])
    if problem is None:
        return None
    hint = (
        "FastConformer exige le venv NeMo : AQR_PYTHON=<venv>/bin/python"
        if asr == "fastconformer"
        else "AQR_PYTHON=<interpréteur du moteur>"
    )
    return f"{asr} : {problem} pour l'interpréteur {python} ({hint})"


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
    """Échec explicite (mode strict, défaut), skip net seulement si AQR_SMOKE_STRICT=0."""
    import pytest  # paresseux : la ligne de commande tourne aussi sous l'interpréteur du moteur

    detail = " ; ".join(f"{m.resource} : {m.reason}" for m in missing)
    if strict():
        pytest.fail(
            f"mode strict (défaut ; {STRICT_ENV}=0 pour autoriser le skip) : "
            f"ressource(s) absente(s) — {detail}",
            pytrace=False,
        )
    pytest.skip(f"{detail} ({STRICT_ENV}=0 explicite : skip autorisé)")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Lister les ressources de smoke manquantes")
    parser.add_argument("--needs", default=",".join(NEEDS))
    parser.add_argument(
        "--asr",
        choices=tuple(MODEL_KEYS),
        help=f"défaut : ${ASR_ENV}, sinon {DEFAULT_ASR}",
    )
    args = parser.parse_args(argv)
    missing = find_missing(os.environ, tuple(n for n in args.needs.split(",") if n), asr=args.asr)
    print(json.dumps([asdict(m) for m in missing], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
