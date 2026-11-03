"""Réglages du service du direct : une seule configuration, lue dans l'environnement (`AQR_LIVE_*`).

Aucune valeur de seuil ailleurs. Les défauts sont des points de départ mesurés ou conçus
(`docs/evaluation/live-etape3-2026-10-24.md`), pas des garanties : `max_streams` vaut ce que la
machine de développement a tenu à l'étape 2 (16 flux avec moins d'une seconde de retard) et doit
être remesuré sur la machine cible.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, fields

from aqr.live.stream import StreamLimits

DEFAULT_PORT = 8765
DEFAULT_PATH = "/live"


@dataclass(frozen=True)
class LiveServiceConfig:
    host: str = "127.0.0.1"
    port: int = DEFAULT_PORT
    path: str = DEFAULT_PATH

    # -- quotas ---------------------------------------------------------------------------------
    max_streams: int = 16
    """Flux simultanés pour tout le service (mesuré à l'étape 2 : environ 16, un fil par flux)."""
    max_streams_per_account: int = 2
    max_unauthenticated: int = 32
    """Connexions ouvertes qui n'ont pas encore présenté un jeton valide."""

    # -- délais -----------------------------------------------------------------------------------
    start_timeout_s: float = 10.0
    """Temps laissé à une connexion pour envoyer `START`."""
    idle_timeout_s: float = 30.0
    """Aucune trame du client depuis ce délai : la connexion est fermée, la session reste."""
    resume_ttl_s: float = 30.0
    """Durée pendant laquelle une session sans connexion attend une reprise."""
    final_keep_s: float = 120.0
    """Un résultat de session expirée reste disponible ce temps pour une reprise tardive (mémoire
    du service seulement, jamais sur disque)."""
    ping_interval_s: float = 20.0
    ping_timeout_s: float = 20.0
    token_leeway_s: float = 2.0

    # -- tailles --------------------------------------------------------------------------------
    max_start_bytes: int = 4096
    max_block_bytes: int = 32_000
    max_stream_s: float = 3600.0
    max_silence_s: float = 120.0
    silence_rms: float = 0.002
    ring_messages: int = 500
    max_backlog_s: float = 20.0
    """Audio reçu mais pas encore traité au-delà duquel le service cesse de lire la connexion
    (contre-pression : le client voit son tampon d'envoi grossir)."""
    stall_timeout_s: float = 15.0
    """Lecture suspendue plus longtemps que cela : le service est dépassé, le flux est refusé."""

    def __post_init__(self) -> None:
        if not 0 <= self.port <= 65535:  # 0 : le système choisit un port libre (tests)
            raise ValueError(f"port invalide : {self.port}")
        if not self.path.startswith("/"):
            raise ValueError("path doit commencer par /")
        for name in ("max_streams", "max_streams_per_account", "max_unauthenticated"):
            if getattr(self, name) < 1:
                raise ValueError(f"{name} doit être >= 1")
        if self.max_streams_per_account > self.max_streams:
            raise ValueError("max_streams_per_account ne peut pas dépasser max_streams")
        for name in (
            "start_timeout_s",
            "idle_timeout_s",
            "resume_ttl_s",
            "final_keep_s",
            "ping_interval_s",
            "ping_timeout_s",
            "max_stream_s",
            "max_silence_s",
            "max_backlog_s",
            "stall_timeout_s",
        ):
            if getattr(self, name) <= 0:
                raise ValueError(f"{name} doit être > 0")
        if self.max_start_bytes < 256:
            raise ValueError("max_start_bytes doit être >= 256")
        self.stream_limits()  # valide les limites de flux

    def stream_limits(self) -> StreamLimits:
        return StreamLimits(
            max_block_bytes=self.max_block_bytes,
            max_stream_s=self.max_stream_s,
            max_silence_s=self.max_silence_s,
            silence_rms=self.silence_rms,
            ring_messages=self.ring_messages,
        )

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> LiveServiceConfig:
        """`AQR_LIVE_<NOM>` pour chaque champ (`AQR_LIVE_MAX_STREAMS`...) ; illisible = erreur."""
        values: dict[str, object] = {}
        for item in fields(cls):
            raw = env.get(f"AQR_LIVE_{item.name.upper()}")
            if raw is None or raw == "":
                continue
            try:
                values[item.name] = (
                    raw if item.type == "str" else int(raw) if item.type == "int" else float(raw)
                )
            except ValueError as exc:
                raise ValueError(f"AQR_LIVE_{item.name.upper()} illisible : {raw!r}") from exc
        return cls(**values)  # type: ignore[arg-type]
