"""Journal unique du service du direct (un seul point d'écriture, aucun `print`).

Une ligne par événement : `nom cle=valeur ...`. Jamais d'audio, de jeton, de texte coranique ni de
traduction : les clés sensibles, les octets, les textes longs et tout texte arabe sont remplacés
par `<omis>`. Un compte est écrit sous la forme d'un pseudonyme court et stable, pas de son
identifiant.
"""

from __future__ import annotations

import json
import logging
import os
import re
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from typing import Any

LOGGER_NAME = "aqr.live"
_FORBIDDEN_KEYS = frozenset({"token", "audio", "pcm", "samples", "text", "translation", "payload"})
_MAX_VALUE_CHARS = 120
_ARABIC = re.compile("[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")
_OMITTED = "<omis>"


def pseudonym(subject: str) -> str:
    """Huit caractères stables dérivés du compte : relier des lignes sans nommer le compte."""
    return sha256(f"aqr.live.account/{subject}".encode()).hexdigest()[:8]


def _safe(key: str, value: Any) -> str:
    if key in _FORBIDDEN_KEYS or isinstance(value, bytes | bytearray | memoryview):
        return _OMITTED
    if isinstance(value, bool):
        return "true" if value else "false"
    text = f"{value:g}" if isinstance(value, float) else str(value)
    if len(text) > _MAX_VALUE_CHARS or _ARABIC.search(text):
        return _OMITTED
    return text.replace("\n", " ").replace("\r", " ")


def _json_value(key: str, value: Any) -> Any:
    """Valeur pour le fichier : nombres et booléens tels quels, le reste suit `_safe`."""
    if key in _FORBIDDEN_KEYS or isinstance(value, bytes | bytearray | memoryview):
        return _OMITTED
    if isinstance(value, bool | int):
        return value
    if isinstance(value, float):
        return value
    return _safe(key, value)


def log_dir_from_env(env: Mapping[str, str]) -> Path | None:
    """Dossier des journaux, comme l'atelier : `AQR_LOG_DIR`, sinon `<AQR_REVIEW_DIR>/logs`."""
    if env.get("AQR_LOG_DIR"):
        return Path(env["AQR_LOG_DIR"]).resolve()
    if env.get("AQR_REVIEW_DIR"):
        return (Path(env["AQR_REVIEW_DIR"]) / "logs").resolve()
    return None


class FileSink:
    """Journal du direct en fichier : `live-AAAA-MM-JJ.log` (UTC), une ligne JSON par événement,
    droits 0640, même format que les journaux de l'atelier (`web/lib/log-files.ts`) pour que le
    rapport quotidien les lise ensemble. Jamais bloquant : une erreur d'écriture est ignorée."""

    def __init__(
        self,
        directory: Path,
        *,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
        retention_days: int = 30,
    ) -> None:
        self._dir = directory
        self._now = now
        self._retention = retention_days

    def write(self, level: str, event: str, fields: dict[str, Any]) -> None:
        moment = self._now()
        record: dict[str, Any] = {
            "ts": moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z",
            "level": "warn" if level == "warning" else level,
            "scope": "live",
            "msg": event,
        }
        record.update({key: _json_value(key, value) for key, value in fields.items()})
        line = json.dumps(record, ensure_ascii=False) + "\n"
        try:
            self._dir.mkdir(parents=True, exist_ok=True, mode=0o750)
            path = self._dir / f"live-{moment.strftime('%Y-%m-%d')}.log"
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o640)
            with os.fdopen(fd, "a", encoding="utf-8") as handle:
                handle.write(line)
        except OSError:
            pass  # la journalisation ne doit jamais arrêter le service

    def prune(self) -> int:
        """Supprime les fichiers plus vieux que la rétention ; rend leur nombre."""
        removed = 0
        try:
            limit = self._now().timestamp() - self._retention * 86400
            for path in self._dir.glob("live-*.log"):
                if path.stat().st_mtime < limit:
                    path.unlink()
                    removed += 1
        except OSError:
            pass
        return removed


class LiveJournal:
    def __init__(self, sink: FileSink | None = None) -> None:
        self._logger = logging.getLogger(LOGGER_NAME)
        self._sink = sink

    def attach_file(self, sink: FileSink | None) -> None:
        """Ajoute (ou retire) la copie en fichier ; la console reste la voie de secours."""
        self._sink = sink

    def _emit(self, level: str, event: str, fields: dict[str, Any]) -> None:
        getattr(self._logger, level)(self._line(event, fields))
        if self._sink is not None:
            self._sink.write(level, event, fields)

    def _line(self, event: str, fields: dict[str, Any]) -> str:
        pairs = " ".join(f"{key}={_safe(key, fields[key])}" for key in sorted(fields))
        return f"{event} {pairs}".rstrip()

    def debug(self, event: str, **fields: Any) -> None:
        self._logger.debug(self._line(event, fields))  # le détail de mise au point reste en console

    def info(self, event: str, **fields: Any) -> None:
        self._emit("info", event, fields)

    def warning(self, event: str, **fields: Any) -> None:
        self._emit("warning", event, fields)

    def error(self, event: str, **fields: Any) -> None:
        self._emit("error", event, fields)


journal = LiveJournal()
