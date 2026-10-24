"""Jeton de session du direct (ADR-0011, étape 3) : signé, court, lié au compte."""

from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

from aqr.adapters.ws.hmac_tokens import (
    KEY_MIN_CHARS,
    HmacTokenCodec,
    default_key_file,
    resolve_key,
)
from aqr.domain.ports import LiveClaims, TokenError

KEY = "k" * 40
NOW = 1_800_000_000.0


def codec(key: str = KEY) -> HmacTokenCodec:
    return HmacTokenCodec(key)


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def test_a_token_round_trips_with_its_claims() -> None:
    token = codec().issue("7", ttl_s=60, now=NOW, technical=True)
    claims = codec().verify(token, now=NOW + 10)
    assert claims.subject == "7"
    assert claims.technical is True
    assert claims.expires_at == pytest.approx(NOW + 60)
    assert len(claims.token_id) >= 16


def test_two_tokens_never_share_an_identifier() -> None:
    ids = {codec().verify(codec().issue("7", 60, now=NOW), now=NOW).token_id for _ in range(50)}
    assert len(ids) == 50


def test_the_token_carries_no_audio_text_or_name() -> None:
    token = codec().issue("7", 60, now=NOW)
    payload = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
    assert set(payload) == {"aud", "sub", "jti", "iat", "exp", "tech"}


def test_an_expired_token_is_refused_with_its_own_code() -> None:
    token = codec().issue("7", ttl_s=60, now=NOW)
    with pytest.raises(TokenError) as raised:
        codec().verify(token, now=NOW + 65)
    assert raised.value.code == "token_expired"


def test_a_little_clock_skew_is_tolerated_but_not_a_minute() -> None:
    token = codec().issue("7", ttl_s=60, now=NOW)
    assert codec().verify(token, now=NOW + 62)  # 2 s de tolérance (leeway)
    with pytest.raises(TokenError):
        codec().verify(token, now=NOW + 70)


def test_a_token_from_the_future_is_refused() -> None:
    token = codec().issue("7", ttl_s=60, now=NOW + 3600)
    with pytest.raises(TokenError) as raised:
        codec().verify(token, now=NOW)
    assert raised.value.code == "token_invalid"


def test_another_key_cannot_forge_a_token() -> None:
    token = codec("z" * 40).issue("7", 60, now=NOW)
    with pytest.raises(TokenError) as raised:
        codec().verify(token, now=NOW)
    assert raised.value.code == "token_invalid"


def test_a_modified_payload_breaks_the_signature() -> None:
    version, payload, signature = codec().issue("7", 60, now=NOW).split(".")
    forged = json.loads(base64.urlsafe_b64decode(payload + "=="))
    forged["sub"] = "1"
    other = b64(json.dumps(forged).encode())
    with pytest.raises(TokenError) as raised:
        codec().verify(f"{version}.{other}.{signature}", now=NOW)
    assert raised.value.code == "token_invalid"


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "abc",
        "v1.only",
        "v1.a.b.c",
        "v2.e30.AAAA",
        "v1..",
        "v1.!!!.???",
        "x" * 5000,
        "v1." + b64(b"not json") + ".AAAA",
    ],
)
def test_malformed_tokens_are_refused_without_crashing(bad: str) -> None:
    with pytest.raises(TokenError) as raised:
        codec().verify(bad, now=NOW)
    assert raised.value.code == "token_invalid"


def test_a_token_for_another_audience_is_refused() -> None:
    good = codec()
    payload = b64(
        json.dumps(
            {
                "aud": "autre",
                "sub": "7",
                "jti": "j" * 22,
                "iat": NOW,
                "exp": NOW + 60,
                "tech": False,
            }
        ).encode()
    )
    token = f"v1.{payload}.{good.sign(payload)}"
    with pytest.raises(TokenError) as raised:
        good.verify(token, now=NOW)
    assert raised.value.code == "token_invalid"


def test_a_short_key_is_refused() -> None:
    with pytest.raises(ValueError):
        HmacTokenCodec("short")


def test_the_key_comes_from_the_environment_first(tmp_path: Path) -> None:
    key = resolve_key(
        {"AQR_LIVE_KEY": "e" * KEY_MIN_CHARS, "AQR_LIVE_KEY_FILE": str(tmp_path / "k")}
    )
    assert key == "e" * KEY_MIN_CHARS
    assert not (tmp_path / "k").exists()


def test_a_missing_key_is_generated_once_in_a_local_file(tmp_path: Path) -> None:
    env = {"AQR_LIVE_KEY_FILE": str(tmp_path / "sub" / "live.key")}
    first = resolve_key(env)
    second = resolve_key(env)
    assert first == second
    assert len(first) >= KEY_MIN_CHARS
    assert (tmp_path / "sub" / "live.key").read_text(encoding="utf-8").strip() == first


def test_an_existing_but_too_short_key_file_is_a_clear_error(tmp_path: Path) -> None:
    path = tmp_path / "live.key"
    path.write_text("court", encoding="utf-8")
    with pytest.raises(ValueError, match="trop courte"):
        resolve_key({"AQR_LIVE_KEY_FILE": str(path)})


def test_the_default_key_file_sits_next_to_the_review_data() -> None:
    assert default_key_file({"AQR_REVIEW_DIR": "/data/review"}) == Path("/data/review") / (
        "live-signing.key"
    )


def test_claims_are_a_plain_value() -> None:
    claims = LiveClaims(subject="1", token_id="t", expires_at=1.0)
    assert claims.technical is False
