"""Hôtes et origines autorisés du service du direct : la même frontière que l'atelier."""

from __future__ import annotations

import pytest

from aqr.live.access import AccessPolicy, host_header_name


def policy(**env: str) -> AccessPolicy:
    return AccessPolicy.from_env(env)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("127.0.0.1:8765", "127.0.0.1"),
        ("localhost", "localhost"),
        ("LOCALHOST:3000", "localhost"),
        ("[::1]:8765", "[::1]"),
        ("lab.example", "lab.example"),
    ],
)
def test_the_host_header_is_reduced_to_its_name(value: str, expected: str) -> None:
    assert host_header_name(value) == expected


@pytest.mark.parametrize(
    "value",
    [
        "",
        " 127.0.0.1",
        "127.0.0.1 ",
        "a b",
        "evil.example, 127.0.0.1",
        "user@host",
        "h:abc",
        "h:123456",
    ],
)
def test_an_ambiguous_host_header_is_refused(value: str) -> None:
    assert host_header_name(value) is None


def test_the_loopback_and_its_atelier_origin_are_accepted() -> None:
    p = policy()
    assert p.allows("127.0.0.1:8765", "http://127.0.0.1:3000")
    assert p.allows("localhost:8765", "http://localhost:3000")
    assert p.allows("[::1]:8765", "http://[::1]:3000")


def test_a_client_without_origin_is_accepted_when_the_host_is_right() -> None:
    assert policy().allows("127.0.0.1:8765", None)


def test_a_foreign_origin_is_refused_even_on_the_loopback() -> None:
    assert not policy().allows("127.0.0.1:8765", "https://evil.example")


def test_a_rebound_host_is_refused() -> None:
    """DNS rebinding : la page tierce arrive avec `Host: evil.example` vers 127.0.0.1."""
    assert not policy().allows("evil.example:8765", "http://evil.example:8765")
    assert not policy().allows("127.0.0.1.evil.example", None)
    assert not policy().allows("localhost.", None)


def test_the_null_origin_and_odd_origins_are_refused() -> None:
    p = policy()
    for origin in (
        "null",
        "",
        "file://",
        "ftp://127.0.0.1",
        "http://",
        "127.0.0.1",
        "http://127.0.0.1/x",
    ):
        assert not p.allows("127.0.0.1:8765", origin), origin


def test_a_missing_host_is_refused() -> None:
    assert not policy().allows(None, "http://127.0.0.1:3000")


def test_extra_hosts_need_the_access_token_like_the_atelier() -> None:
    off = policy(AQR_ALLOWED_HOSTS="lab.example")
    assert not off.allows("lab.example", "https://lab.example")
    on = policy(AQR_ALLOWED_HOSTS="lab.example", AQR_ACCESS_TOKEN="secret")
    assert on.allows("lab.example", "https://lab.example")
    assert not on.allows("other.example", "https://other.example")


def test_the_public_origin_host_is_accepted_with_the_token() -> None:
    p = policy(AQR_PUBLIC_ORIGIN="https://tunnel.example", AQR_ACCESS_TOKEN="secret")
    assert p.allows("tunnel.example", "https://tunnel.example")


def test_a_malformed_public_origin_opens_nothing() -> None:
    for raw in ("ftp://x.example", "https://x.example/path", "https://u@x.example", "pas une url"):
        p = policy(AQR_PUBLIC_ORIGIN=raw, AQR_ACCESS_TOKEN="secret")
        assert not p.allows("x.example", "https://x.example"), raw


def test_a_forwarded_host_must_be_allowed_too() -> None:
    p = policy()
    assert p.allows("127.0.0.1:8765", None, forwarded_host="localhost")
    assert not p.allows("127.0.0.1:8765", None, forwarded_host="evil.example")
