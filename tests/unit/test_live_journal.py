"""Journal du service du direct : jamais d'audio, de jeton ni de texte coranique (ADR-0011 §6)."""

from __future__ import annotations

import logging

import pytest

from aqr.live.journal import LiveJournal, pseudonym


@pytest.fixture()
def records(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.DEBUG, logger="aqr.live")
    return caplog


def test_an_event_is_one_readable_line_of_key_values(records: pytest.LogCaptureFixture) -> None:
    LiveJournal().info("session.open", session="abc", blocks=3, ratio=0.5, ok=True)
    assert records.messages == ["session.open blocks=3 ok=true ratio=0.5 session=abc"]


@pytest.mark.parametrize(
    "key", ["token", "audio", "pcm", "samples", "text", "translation", "payload"]
)
def test_sensitive_fields_are_never_written(records: pytest.LogCaptureFixture, key: str) -> None:
    LiveJournal().info("x", **{key: "secret-value"})
    assert "secret-value" not in records.text
    assert f"{key}=<omis>" in records.text


def test_bytes_and_long_values_are_never_written(records: pytest.LogCaptureFixture) -> None:
    LiveJournal().info("x", blob=b"\x00\x01" * 10, long="a" * 500)
    assert "\\x00" not in records.text
    assert "a" * 100 not in records.text
    assert "blob=<omis>" in records.text
    assert "long=<omis>" in records.text


def test_arabic_text_is_never_written_whatever_the_key(records: pytest.LogCaptureFixture) -> None:
    LiveJournal().info("x", note="قل هو الله أحد")
    assert "قل" not in records.text
    assert "note=<omis>" in records.text


def test_levels(records: pytest.LogCaptureFixture) -> None:
    journal = LiveJournal()
    journal.warning("w")
    journal.error("e", code="internal")
    assert [r.levelname for r in records.records] == ["WARNING", "ERROR"]


def test_an_account_is_logged_as_a_short_stable_pseudonym() -> None:
    assert pseudonym("7") == pseudonym("7")
    assert pseudonym("7") != pseudonym("8")
    assert pseudonym("7") != "7"
    assert len(pseudonym("7")) == 8
