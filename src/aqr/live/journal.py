"""Journal unique du service du direct (un seul point d'écriture, aucun `print`).

Une ligne par événement : `nom cle=valeur ...`. Jamais d'audio, de jeton, de texte coranique ni de
traduction : les clés sensibles, les octets, les textes longs et tout texte arabe sont remplacés
par `<omis>`. Un compte est écrit sous la forme d'un pseudonyme court et stable, pas de son
identifiant.
"""

from __future__ import annotations

import logging
import re
from hashlib import sha256
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


class LiveJournal:
    def __init__(self) -> None:
        self._logger = logging.getLogger(LOGGER_NAME)

    def _line(self, event: str, fields: dict[str, Any]) -> str:
        pairs = " ".join(f"{key}={_safe(key, fields[key])}" for key in sorted(fields))
        return f"{event} {pairs}".rstrip()

    def debug(self, event: str, **fields: Any) -> None:
        self._logger.debug(self._line(event, fields))

    def info(self, event: str, **fields: Any) -> None:
        self._logger.info(self._line(event, fields))

    def warning(self, event: str, **fields: Any) -> None:
        self._logger.warning(self._line(event, fields))

    def error(self, event: str, **fields: Any) -> None:
        self._logger.error(self._line(event, fields))


journal = LiveJournal()
