"""Protocole `aqr.live/1` : messages du client, codes d'erreur, enveloppe des messages du serveur.

Contrat documenté dans `docs/LIVE-PROTOCOL.md` (ADR-0011 §6). Ce module est pur : il valide ce que
le client envoie (jamais de plantage, une `ProtocolError` avec un code) et fabrique les messages
d'erreur. Les messages d'événements (CANDIDATES, LOCKED...) sont fabriqués par `presenter.py`.

Chaque `message` d'erreur est une phrase de français clair : ce qui ne marche pas, la cause
probable, ce que l'utilisateur peut faire ; jamais un code brut ni une trace.
"""

from __future__ import annotations

import json
import re
from collections.abc import Collection
from dataclasses import dataclass
from typing import Any, Final

SCHEMA: Final = "aqr.live/1"
ENCODING: Final = "pcm_s16le"
SAMPLE_RATE: Final = 16000
CHANNELS: Final = 1
DEFAULT_TRANSLATION: Final = "french_hameedullah"
MAX_TOKEN_CHARS: Final = 1024
_SESSION_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


@dataclass(frozen=True)
class ErrorSpec:
    message: str
    recoverable: bool
    """Le client peut réessayer ou reprendre (même session ou nouvelle) sans rien changer."""
    close: bool = True
    """La connexion est fermée après ce message."""


ERROR_CODES: Final[dict[str, ErrorSpec]] = {
    "bad_message": ErrorSpec(
        "Le service n'a pas compris un message du client : il est mal formé ou arrive au mauvais "
        "moment. L'écoute s'arrête ; relancez-la depuis l'application.",
        recoverable=False,
    ),
    "unsupported_schema": ErrorSpec(
        "Cette version de l'application ne parle pas la même version du protocole que le service. "
        "Rechargez la page pour récupérer la version à jour.",
        recoverable=False,
    ),
    "bad_audio_format": ErrorSpec(
        "Le format du son annoncé n'est pas celui que le service attend (PCM 16 bits, 16 kHz, une "
        "seule voie). L'écoute ne peut pas démarrer ; rechargez la page, et si cela continue "
        "signalez-le : le micro de cet appareil n'est peut-être pas pris en charge.",
        recoverable=False,
    ),
    "bad_audio_block": ErrorSpec(
        "Un bloc de son reçu est vide, de taille impaire ou trop grand pour être du son valide. "
        "L'écoute s'arrête pour ne pas fausser la détection ; relancez-la.",
        recoverable=True,
    ),
    "stream_too_long": ErrorSpec(
        "L'écoute a atteint la durée maximale autorisée pour un seul flux. Ce qui a été détecté "
        "est conservé dans le résultat final ; relancez une nouvelle écoute pour continuer.",
        recoverable=True,
    ),
    "silence_too_long": ErrorSpec(
        "Aucun son n'a été entendu depuis trop longtemps (micro coupé ou muet ?). L'écoute est "
        "arrêtée pour libérer la place d'un autre flux ; relancez-la quand vous êtes prêt.",
        recoverable=True,
    ),
    "idle_timeout": ErrorSpec(
        "Plus aucune donnée n'est arrivée du navigateur depuis trop longtemps (connexion coupée "
        "ou onglet endormi ?). La session reste disponible un court moment pour reprendre là où "
        "elle s'est arrêtée.",
        recoverable=True,
    ),
    "start_timeout": ErrorSpec(
        "La connexion est restée ouverte sans démarrer l'écoute. Elle a été fermée ; relancez "
        "l'écoute depuis l'application.",
        recoverable=True,
    ),
    "session_expired": ErrorSpec(
        "Cette session d'écoute n'existe plus : elle a expiré après une coupure trop longue, ou "
        "elle est déjà terminée. Relancez une nouvelle écoute : l'ancienne ne peut pas être "
        "reprise.",
        recoverable=True,
    ),
    "replay_unavailable": ErrorSpec(
        "La reprise n'est pas possible : trop de messages se sont écoulés pendant la coupure pour "
        "que le service puisse les rejouer tous. Relancez une nouvelle écoute.",
        recoverable=True,
    ),
    "token_invalid": ErrorSpec(
        "Le laissez-passer de cette écoute est illisible ou ne vient pas de l'application. "
        "Rechargez la page et reconnectez-vous si besoin.",
        recoverable=True,
    ),
    "token_expired": ErrorSpec(
        "Le laissez-passer de cette écoute a expiré avant la connexion. Relancez l'écoute : un "
        "nouveau est demandé automatiquement.",
        recoverable=True,
    ),
    "token_replayed": ErrorSpec(
        "Ce laissez-passer a déjà servi et ne vaut qu'une fois. Relancez l'écoute pour en obtenir "
        "un nouveau.",
        recoverable=True,
    ),
    "too_many_streams": ErrorSpec(
        "Ce compte a déjà le nombre maximal d'écoutes en cours. Terminez-en une (autre onglet ou "
        "autre appareil) avant d'en démarrer une nouvelle.",
        recoverable=True,
    ),
    "server_busy": ErrorSpec(
        "Le service d'écoute est occupé : toutes les places sont prises ou le calcul ne suit "
        "plus. Rien n'est perdu côté application ; réessayez dans quelques instants.",
        recoverable=True,
    ),
    "service_stopping": ErrorSpec(
        "Le service d'écoute s'arrête (maintenance ou redémarrage). Votre écoute est interrompue "
        "et ne peut pas être reprise après le redémarrage ; relancez-la dans quelques instants.",
        recoverable=True,
    ),
    "internal": ErrorSpec(
        "Le service d'écoute a rencontré un problème inattendu. L'incident est consigné dans son "
        "journal ; relancez l'écoute, et signalez-le s'il se reproduit.",
        recoverable=True,
    ),
}


class ProtocolError(Exception):
    """Message ou flux refusé. `code` est une clé de `ERROR_CODES`."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


def envelope(message_type: str, seq: int, **fields: Any) -> dict[str, Any]:
    return {"schema": SCHEMA, "type": message_type, "seq": seq, **fields}


def error_message(code: str, *, retry_after_s: float | None = None) -> dict[str, Any]:
    """Message `ERROR` (hors flux d'événements : `seq` 0, jamais rejoué)."""
    spec = ERROR_CODES[code]
    body: dict[str, Any] = {
        "code": code,
        "message": spec.message,
        "recoverable": spec.recoverable,
    }
    if retry_after_s is not None:
        body["retry_after_s"] = retry_after_s
    return envelope("ERROR", 0, **body)


# ------------------------------------------------------------------------------------- client
@dataclass(frozen=True)
class ResumeRequest:
    session_id: str
    last_seq: int


@dataclass(frozen=True)
class StartMessage:
    token: str
    translation: str | None
    technical: bool
    resume: ResumeRequest | None


@dataclass(frozen=True)
class EndMessage:
    pass


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _parse_audio(raw: object) -> None:
    ok = (
        isinstance(raw, dict)
        and raw.get("encoding") == ENCODING
        and _is_int(raw.get("sample_rate"))
        and raw.get("sample_rate") == SAMPLE_RATE
        and _is_int(raw.get("channels"))
        and raw.get("channels") == CHANNELS
    )
    if not ok:
        raise ProtocolError("bad_audio_format", "audio attendu : pcm_s16le, 16000 Hz, 1 voie")


def _parse_options(raw: object, translations: Collection[str] | None) -> tuple[str | None, bool]:
    if raw is None:
        return DEFAULT_TRANSLATION, False
    if not isinstance(raw, dict):
        raise ProtocolError("bad_message", "options : objet attendu")
    translation: object = raw.get("translation", DEFAULT_TRANSLATION)
    if translation is None or translation == "none":
        chosen: str | None = None
    elif isinstance(translation, str) and (translations is None or translation in translations):
        chosen = translation
    else:
        raise ProtocolError("bad_message", "options.translation inconnue")
    technical = raw.get("technical", False)
    if not isinstance(technical, bool):
        raise ProtocolError("bad_message", "options.technical : booléen attendu")
    return chosen, technical


def _parse_resume(raw: object) -> ResumeRequest | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ProtocolError("bad_message", "resume : objet attendu")
    session_id, last_seq = raw.get("session_id"), raw.get("last_seq")
    if not isinstance(session_id, str) or not _SESSION_ID.match(session_id):
        raise ProtocolError("bad_message", "resume.session_id invalide")
    if not isinstance(last_seq, int) or isinstance(last_seq, bool) or last_seq < 0:
        raise ProtocolError("bad_message", "resume.last_seq invalide")
    return ResumeRequest(session_id, last_seq)


def parse_client_text(
    text: str, *, max_bytes: int, translations: Collection[str] | None = None
) -> StartMessage | EndMessage:
    """Un message texte du client. `translations` : identifiants de traduction connus (None = ne
    pas vérifier). Lève `ProtocolError` pour tout ce qui n'est pas un `START` ou un `END` valide."""
    if len(text.encode("utf-8", "ignore")) > max_bytes:
        raise ProtocolError("bad_message", "message trop gros")
    try:
        body = json.loads(text)
    except (ValueError, RecursionError) as exc:
        raise ProtocolError("bad_message", "JSON illisible") from exc
    if not isinstance(body, dict):
        raise ProtocolError("bad_message", "objet JSON attendu")
    kind = body.get("type")
    if kind == "END":
        return EndMessage()
    if kind != "START":
        raise ProtocolError("bad_message", "type de message inconnu")
    if body.get("schema") != SCHEMA:
        raise ProtocolError("unsupported_schema", f"schéma attendu : {SCHEMA}")
    _parse_audio(body.get("audio"))
    token = body.get("token")
    if not isinstance(token, str) or not 0 < len(token) <= MAX_TOKEN_CHARS:
        raise ProtocolError("token_invalid", "jeton absent ou illisible")
    translation, technical = _parse_options(body.get("options"), translations)
    return StartMessage(token, translation, technical, _parse_resume(body.get("resume")))
