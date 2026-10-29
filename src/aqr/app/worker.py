"""Worker chaud : un processus Python qui garde le moteur chargé entre deux analyses.

Chaque analyse relançait `python -m aqr.cli recognize` et rechargeait les modèles (environ 50 s). Le
worker lit des requêtes JSON, une par ligne, sur l'entrée standard et répond une ligne par requête :

    -> {"id": "…", "argv": ["recognize", "audio.wav", "--out-dir", "…", …]}
    <- {"id": "…", "code": 0, "stdout": "…", "stderr": "…"}

Il écrit d'abord `{"event": "ready"}`. Les arguments sont ceux de la ligne de commande habituelle :
rien n'est dupliqué, c'est le même `main`. Le protocole vit sur la sortie standard d'origine ; tout
ce que le reste du programme imprime (bibliothèques comprises) part dans `stderr`, jamais dans
le flux du protocole. Une requête qui échoue (même par exception) ne tue pas le service.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
from collections.abc import Callable, Iterable, Mapping
from pathlib import Path
from typing import Any, TextIO

from aqr.pipeline.factory import RecognizeOptions

RunRequest = Callable[[list[str], TextIO, TextIO], int]
_TAIL = 100_000


def _stat(path: Path | None) -> tuple[int, int] | None:
    try:
        info = os.stat(path) if path is not None else None
    except OSError:
        return None
    return None if info is None else (info.st_mtime_ns, info.st_size)


def _stamp(options: RecognizeOptions) -> tuple[object, ...]:
    """Empreinte légère de ce qui rend un moteur périmé : le verrou des modèles (la référence) et
    les entrées directes du dossier des poids (ajout, retrait ou remplacement d'un modèle)."""
    children: list[tuple[str, tuple[int, int] | None]] = []
    if options.models_dir is not None:
        try:
            with os.scandir(options.models_dir) as entries:
                children = sorted((e.name, _stat(Path(e.path))) for e in entries)
        except OSError:
            children = []
    return (_stat(options.lock_path), tuple(children))


class CachedFactory:
    """Fabrique de moteur qui garde le dernier : le même jeu d'options ne recharge rien.

    Un seul moteur est conservé (mémoire de la carte graphique) : changer d'options, ou mettre à
    jour les modèles (verrou ou dossier modifiés), reconstruit.
    """

    def __init__(self, build: Callable[[RecognizeOptions, Mapping[str, str]], Any]) -> None:
        self._build = build
        self._key: tuple[RecognizeOptions, tuple[object, ...]] | None = None
        self._value: Any = None

    def __call__(self, options: RecognizeOptions, env: Mapping[str, str]) -> Any:
        key = (options, _stamp(options))
        if self._key != key:
            self._value = None  # libère l'ancien avant de charger le nouveau
            self._value = self._build(options, env)
            self._key = key
        return self._value


def _reply(out: TextIO, payload: dict[str, Any]) -> None:
    out.write(json.dumps(payload, ensure_ascii=False) + "\n")
    out.flush()


def _parse(line: str) -> tuple[str | None, list[str] | None]:
    try:
        message = json.loads(line)
    except ValueError:
        return None, None
    if not isinstance(message, dict):
        return None, None
    ident = message.get("id")
    argv = message.get("argv")
    if not isinstance(ident, str):
        return None, None
    if not isinstance(argv, list) or not all(isinstance(a, str) for a in argv):
        return ident, None
    return ident, argv


def serve(stdin: Iterable[str], out: TextIO, run: RunRequest) -> None:
    """Boucle du worker : une réponse par ligne lue, jusqu'à la fin de l'entrée."""
    _reply(out, {"event": "ready"})
    for raw in stdin:
        line = raw.strip()
        if not line:
            continue
        ident, argv = _parse(line)
        if argv is None:
            _reply(
                out,
                {
                    "id": ident,
                    "code": 2,
                    "stdout": "",
                    "stderr": 'ERREUR requête illisible : {"id": …, "argv": […]} attendu.',
                },
            )
            continue
        stdout, stderr = io.StringIO(), io.StringIO()
        try:
            with contextlib.redirect_stderr(stderr), contextlib.redirect_stdout(stderr):
                code = run(argv, stdout, stderr)
        except SystemExit as exit_:  # argparse quitte au lieu de lever
            code = exit_.code if isinstance(exit_.code, int) else (0 if exit_.code is None else 2)
        except Exception as exc:  # une requête en échec ne doit pas tuer le service
            stderr.write(f"ERREUR {exc}\n")
            code = 1
        _reply(
            out,
            {
                "id": ident,
                "code": code,
                "stdout": stdout.getvalue()[-_TAIL:],
                "stderr": stderr.getvalue()[-_TAIL:],
            },
        )
