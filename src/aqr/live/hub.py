"""LiveHub (couche application) : qui peut ouvrir un flux, combien, et comment le reprendre.

Pur et synchrone : le temps est passé par l'appelant, aucune entrée-sortie. Il porte :

- les jetons à usage unique (un `jti` ne sert qu'une fois, oublié quand il ne peut plus rejouer) ;
- les quotas : flux simultanés pour tout le service et par compte (une session sans connexion en
  attente de reprise garde sa place) ;
- les sessions et la reprise : liée au compte qui l'a ouverte, valable `resume_ttl_s` après la
  coupure, jamais de rejeu d'audio, seulement des messages.

Les refus sont des `ProtocolError` dont le code est celui d'`aqr.live/1`. Une session inconnue,
terminée, expirée ou d'un autre compte reçoivent la MÊME réponse (`session_expired`) : on ne révèle
pas l'existence d'une session à qui ne la possède pas.
"""

from __future__ import annotations

import secrets
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from aqr.domain.ports import LiveClaims, SessionTokenVerifier, TokenError
from aqr.live.journal import journal, pseudonym
from aqr.live.protocol import ProtocolError, ResumeRequest, StartMessage
from aqr.live.service_config import LiveServiceConfig
from aqr.live.stream import LiveStream

StreamFactory = Callable[[str, str | None, bool, int | None], LiveStream]
"""(identifiant de session, traduction, mode technique) -> flux neuf, avec son modèle chargé."""

_SESSION_ID_BYTES = 16


@dataclass
class LiveSession:
    id: str
    subject: str
    stream: LiveStream
    created_at: float
    detached_at: float | None = None
    generation: int = 1
    """Augmente à chaque connexion qui prend la session : l'ancienne sait qu'elle est remplacée."""


class LiveHub:
    def __init__(
        self,
        config: LiveServiceConfig,
        verifier: SessionTokenVerifier,
        factory: StreamFactory,
    ) -> None:
        self._config = config
        self._verifier = verifier
        self._factory = factory
        self._lock = threading.Lock()
        self._used: dict[str, float] = {}
        self._sessions: dict[str, LiveSession] = {}

    # ------------------------------------------------------------------ jetons
    def authenticate(self, token: str, now: float) -> LiveClaims:
        try:
            claims = self._verifier.verify(token, now=now)
        except TokenError as error:
            raise ProtocolError(error.code, str(error)) from error
        with self._lock:
            self._used = {k: exp for k, exp in self._used.items() if exp >= now}
            if claims.token_id in self._used:
                journal.warning("token.replayed", account=pseudonym(claims.subject))
                raise ProtocolError("token_replayed", "jeton déjà utilisé")
            self._used[claims.token_id] = claims.expires_at + self._config.token_leeway_s
        return claims

    @property
    def used_token_count(self) -> int:
        with self._lock:
            return len(self._used)

    # ------------------------------------------------------------------ sessions
    @property
    def active_count(self) -> int:
        with self._lock:
            return len(self._sessions)

    def count_for(self, subject: str) -> int:
        with self._lock:
            return sum(1 for s in self._sessions.values() if s.subject == subject)

    def sessions(self) -> list[LiveSession]:
        with self._lock:
            return list(self._sessions.values())

    def open_session(self, claims: LiveClaims, start: StartMessage, now: float) -> LiveSession:
        config = self._config
        with self._lock:
            if len(self._sessions) >= config.max_streams:
                journal.warning("quota.global", active=len(self._sessions))
                raise ProtocolError("server_busy", "toutes les places sont prises")
            mine = sum(1 for s in self._sessions.values() if s.subject == claims.subject)
            if mine >= config.max_streams_per_account:
                journal.warning("quota.account", account=pseudonym(claims.subject), active=mine)
                raise ProtocolError("too_many_streams", "limite par compte atteinte")
            session_id = secrets.token_urlsafe(_SESSION_ID_BYTES)
            technical = claims.technical and start.technical
            stream = self._factory(session_id, start.translation, technical, start.surah)
            session = LiveSession(session_id, claims.subject, stream, created_at=now)
            self._sessions[session_id] = session
        journal.info(
            "session.open",
            session=session_id,
            account=pseudonym(claims.subject),
            technical=technical,
            active=self.active_count,
        )
        return session

    def resume_session(
        self, claims: LiveClaims, request: ResumeRequest, now: float
    ) -> tuple[LiveSession, list[dict[str, Any]]]:
        with self._lock:
            session = self._sessions.get(request.session_id)
            if (
                session is None
                or session.subject != claims.subject
                or session.stream.ended
                or self._stale(session, now)
            ):
                raise ProtocolError("session_expired", "session inconnue, terminée ou expirée")
            replay = session.stream.messages_after(request.last_seq)
            if replay is None:
                raise ProtocolError("replay_unavailable", "trop de messages à rejouer")
            session.generation += 1
            session.detached_at = None
        journal.info("session.resume", session=session.id, account=pseudonym(claims.subject))
        return session, replay

    def detach(self, session: LiveSession, now: float) -> None:
        """La connexion de la session s'est coupée : elle attend une reprise `resume_ttl_s`."""
        with self._lock:
            if session.id in self._sessions and session.detached_at is None:
                session.detached_at = now

    def finish(self, session: LiveSession) -> None:
        """Le flux est terminé pour de bon : la place est rendue."""
        with self._lock:
            removed = self._sessions.pop(session.id, None)
        if removed is not None:
            journal.info("session.close", session=session.id, active=self.active_count)

    def expire(self, now: float) -> list[LiveSession]:
        """Retire les sessions sans connexion depuis plus de `resume_ttl_s` ; rend celles-ci."""
        with self._lock:
            gone = [s for s in self._sessions.values() if self._stale(s, now)]
            for session in gone:
                del self._sessions[session.id]
        for session in gone:
            journal.info("session.expired", session=session.id)
        return gone

    def _stale(self, session: LiveSession, now: float) -> bool:
        return (
            session.detached_at is not None
            and now - session.detached_at > self._config.resume_ttl_s
        )
