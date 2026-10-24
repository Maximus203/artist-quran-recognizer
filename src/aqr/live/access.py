"""Hôtes et origines autorisés du service du direct (ADR-0011 §6, précédent #68 : DNS rebinding).

Même frontière que l'atelier (`web/lib/local-request.ts`) :

- par défaut la boucle locale seulement (`127.0.0.1`, `localhost`, `[::1]`) ;
- `AQR_ALLOWED_HOSTS` et l'hôte de `AQR_PUBLIC_ORIGIN` s'ajoutent **seulement si**
  `AQR_ACCESS_TOKEN` est défini (fail-closed, comme l'atelier) ; le service ne vérifie pas ce jeton
  d'accès lui-même : le jeton de session signé, émis par l'atelier après ses propres contrôles, est
  son identifiant ;
- l'en-tête `Host` (et `X-Forwarded-Host`) doit être un hôte autorisé : une page tierce dont le nom
  résout vers la boucle locale arrive avec un autre `Host` ;
- l'en-tête `Origin`, quand le navigateur en envoie un, doit nommer un hôte autorisé. Le port n'est
  pas comparé : l'atelier et le service n'écoutent pas sur le même. Un client sans `Origin` (outil,
  test) est accepté : il doit de toute façon présenter un jeton valide.

Fonctions pures : aucune lecture réseau.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

LOOPBACK = frozenset({"127.0.0.1", "localhost", "[::1]"})
_HOST = re.compile(r"^(\[[0-9a-f:.]+\]|[a-z0-9._-]+)(?::(\d{1,5}))?$", re.IGNORECASE)


def host_header_name(value: str) -> str | None:
    """Nom d'hôte d'un en-tête `Host`, ou None s'il est mal formé ou ambigu (liste, espaces,
    identifiants, port non numérique). Le nom reste tel quel (minuscules)."""
    match = _HOST.match(value)
    if match is None or value != value.strip():
        return None
    return match.group(1).lower()


def _hosts(raw: str) -> list[str]:
    return [re.sub(r":\d+$", "", item.strip().lower()) for item in raw.split(",") if item.strip()]


def _public_origin_host(raw: str) -> str | None:
    """Hôte de `AQR_PUBLIC_ORIGIN`, ou None si la valeur est absente ou mal formée (refus)."""
    if not raw:
        return None
    try:
        parts = urlsplit(raw)
        plain = parts.path in ("", "/") and not parts.query and not parts.fragment
        if (
            parts.scheme not in ("http", "https")
            or not plain
            or parts.username
            or not parts.hostname
        ):
            return None
        return f"[{parts.hostname}]" if ":" in parts.hostname else parts.hostname.lower()
    except ValueError:
        return None


@dataclass(frozen=True)
class AccessPolicy:
    hosts: frozenset[str]

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> AccessPolicy:
        extra: list[str] = []
        if env.get("AQR_ACCESS_TOKEN"):
            extra.extend(_hosts(env.get("AQR_ALLOWED_HOSTS", "")))
            public = _public_origin_host(env.get("AQR_PUBLIC_ORIGIN", ""))
            if public:
                extra.append(public)
        return cls(hosts=LOOPBACK | frozenset(extra))

    def host_allowed(self, host_header: str | None) -> bool:
        if host_header is None:
            return False
        name = host_header_name(host_header)
        return name is not None and name in self.hosts

    def origin_allowed(self, origin: str | None) -> bool:
        """Absent : accepté (client hors navigateur). Présent : un hôte autorisé, sans chemin."""
        if origin is None:
            return True
        try:
            parts = urlsplit(origin)
            hostname = parts.hostname
            if (
                parts.scheme not in ("http", "https")
                or not hostname
                or parts.path
                or parts.query
                or parts.fragment
                or parts.username
            ):
                return False
            name = f"[{hostname}]" if ":" in hostname else hostname.lower()
            parts.port  # noqa: B018 - lève ValueError si le port est invalide
        except ValueError:
            return False
        return name in self.hosts

    def allows(
        self, host_header: str | None, origin: str | None, forwarded_host: str | None = None
    ) -> bool:
        if not self.host_allowed(host_header):
            return False
        if forwarded_host is not None and not self.host_allowed(forwarded_host):
            return False
        return self.origin_allowed(origin)
