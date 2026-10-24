"""Jeton de session du direct : HMAC-SHA256, court, signé avec une clé partagée avec l'atelier.

Format `v1.<charge utile>.<signature>` (base64url sans remplissage) :

- charge utile : JSON `{"aud":"aqr.live/1","sub":"<compte>","jti":"<unique>","iat":…,"exp":…,
  "tech":bool}` ;
- signature : HMAC-SHA256 de `aqr.live.token/1.<charge utile>` avec la clé.

L'atelier (Next.js, `web/lib/live-token.ts`) émet le jeton après avoir authentifié l'utilisateur
par son cookie de session ; le service le vérifie. Un vecteur de test commun
(`tests/fixtures/live/token-vectors.json`) fige l'accord entre les deux langages.

La clé n'est jamais dans le dépôt : `AQR_LIVE_KEY` (variable d'environnement) ou, à défaut, un
fichier local créé au premier démarrage (`AQR_LIVE_KEY_FILE`, par défaut
`<AQR_REVIEW_DIR>/live-signing.key`, hors Git). Le jeton ne contient ni audio, ni texte, ni nom.
"""

from __future__ import annotations

import base64
import binascii
import hmac
import json
import os
import secrets
import time
from collections.abc import Mapping
from hashlib import sha256
from pathlib import Path

from aqr.domain.ports import LiveClaims, TokenError

AUDIENCE = "aqr.live/1"
VERSION = "v1"
SIGNING_PREFIX = "aqr.live.token/1."
KEY_MIN_CHARS = 32
LEEWAY_S = 2.0
"""Tolérance d'horloge entre l'atelier et le service (deux processus, une machine)."""
MAX_TOKEN_CHARS = 1024
KEY_FILE_NAME = "live-signing.key"


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class HmacTokenCodec:
    """Émet (tests, outils) et vérifie (service) les jetons ; implémente `SessionTokenVerifier`."""

    def __init__(self, key: str) -> None:
        if len(key) < KEY_MIN_CHARS:
            raise ValueError(f"la clé de signature doit faire au moins {KEY_MIN_CHARS} caractères")
        self._key = key.encode("utf-8")

    def sign(self, payload_b64: str) -> str:
        mac = hmac.new(self._key, (SIGNING_PREFIX + payload_b64).encode("ascii"), sha256)
        return _b64(mac.digest())

    def issue(self, subject: str, ttl_s: float, *, now: float, technical: bool = False) -> str:
        payload = {
            "aud": AUDIENCE,
            "sub": subject,
            "jti": _b64(secrets.token_bytes(16)),
            "iat": now,
            "exp": now + ttl_s,
            "tech": technical,
        }
        body = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        return f"{VERSION}.{body}.{self.sign(body)}"

    def verify(self, token: str, *, now: float) -> LiveClaims:
        invalid = TokenError("token_invalid", "jeton illisible ou falsifié")
        if not isinstance(token, str) or not 0 < len(token) <= MAX_TOKEN_CHARS:
            raise invalid
        parts = token.split(".")
        if len(parts) != 3 or parts[0] != VERSION:
            raise invalid
        _, body, signature = parts
        if not hmac.compare_digest(signature.encode("ascii", "ignore"), self.sign(body).encode()):
            raise invalid
        try:
            payload = json.loads(_unb64(body))
        except (ValueError, binascii.Error) as exc:
            raise invalid from exc
        if not isinstance(payload, dict) or payload.get("aud") != AUDIENCE:
            raise invalid
        subject, token_id = payload.get("sub"), payload.get("jti")
        issued, expires = payload.get("iat"), payload.get("exp")
        technical = payload.get("tech", False)
        if (
            not isinstance(subject, str)
            or not subject
            or not isinstance(token_id, str)
            or not token_id
            or isinstance(issued, bool)
            or isinstance(expires, bool)
            or not isinstance(issued, int | float)
            or not isinstance(expires, int | float)
            or not isinstance(technical, bool)
        ):
            raise invalid
        if issued > now + LEEWAY_S:
            raise invalid
        if expires + LEEWAY_S < now:
            raise TokenError("token_expired", "jeton expiré")
        return LiveClaims(
            subject=subject, token_id=token_id, expires_at=float(expires), technical=technical
        )


def default_key_file(env: Mapping[str, str]) -> Path:
    """Même dossier de données que l'atelier (`AQR_REVIEW_DIR`, sinon son défaut par système)."""
    if env.get("AQR_REVIEW_DIR"):
        return Path(env["AQR_REVIEW_DIR"]) / KEY_FILE_NAME
    if os.name == "nt":
        home = Path(env.get("USERPROFILE") or Path.home())
        return home / "AppData" / "Local" / "aqr-review" / KEY_FILE_NAME
    base = env.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "aqr-review" / KEY_FILE_NAME


def resolve_key(env: Mapping[str, str]) -> str:
    """Clé de signature : `AQR_LIVE_KEY`, sinon le fichier local (créé s'il n'existe pas).

    La création est atomique (`O_EXCL`) : si l'atelier et le service démarrent ensemble, un seul
    écrit et l'autre relit la même clé."""
    direct = env.get("AQR_LIVE_KEY", "").strip()
    if direct:
        if len(direct) < KEY_MIN_CHARS:
            raise ValueError(f"AQR_LIVE_KEY est trop courte (au moins {KEY_MIN_CHARS} caractères)")
        return direct
    path = Path(env["AQR_LIVE_KEY_FILE"]) if env.get("AQR_LIVE_KEY_FILE") else default_key_file(env)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(_b64(secrets.token_bytes(32)) + "\n")
    key = path.read_text(encoding="utf-8").strip()
    for _ in range(20):  # un autre processus vient de créer le fichier et n'a pas fini d'écrire
        if key:
            break
        time.sleep(0.05)
        key = path.read_text(encoding="utf-8").strip()
    if len(key) < KEY_MIN_CHARS:
        raise ValueError(f"la clé de signature {path} est trop courte ou vide : la supprimer")
    return key
