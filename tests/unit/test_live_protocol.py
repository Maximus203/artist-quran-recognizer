"""Messages client -> serveur d'`aqr.live/1` : validation stricte, jamais de plantage."""

from __future__ import annotations

import json

import pytest

from aqr.live.protocol import (
    ERROR_CODES,
    SCHEMA,
    EndMessage,
    ProtocolError,
    StartMessage,
    error_message,
    parse_client_text,
)

TRANSLATIONS = frozenset({"french_hameedullah", "french_rashid"})


def start(**changes: object) -> dict[str, object]:
    body: dict[str, object] = {
        "type": "START",
        "schema": SCHEMA,
        "token": "v1.x.y",
        "audio": {"encoding": "pcm_s16le", "sample_rate": 16000, "channels": 1},
        "options": {"translation": "french_hameedullah", "technical": False},
    }
    body.update(changes)
    return body


def parse(body: object) -> StartMessage | EndMessage:
    return parse_client_text(json.dumps(body), max_bytes=4096, translations=TRANSLATIONS)


def test_a_valid_start_is_parsed_with_its_defaults() -> None:
    message = parse(start())
    assert isinstance(message, StartMessage)
    assert message.token == "v1.x.y"
    assert message.translation == "french_hameedullah"
    assert message.technical is False
    assert message.resume is None


def test_options_are_optional_and_default_to_the_french_translation_without_technical() -> None:
    body = start()
    del body["options"]
    message = parse(body)
    assert isinstance(message, StartMessage)
    assert message.translation == "french_hameedullah"
    assert message.technical is False


def test_translation_none_means_no_translation() -> None:
    for value in ("none", None):
        message = parse(start(options={"translation": value}))
        assert isinstance(message, StartMessage)
        assert message.translation is None


def test_a_resume_request_carries_the_session_and_the_last_seq() -> None:
    message = parse(start(resume={"session_id": "abcdefgh12345678", "last_seq": 17}))
    assert isinstance(message, StartMessage)
    assert message.resume is not None
    assert (message.resume.session_id, message.resume.last_seq) == ("abcdefgh12345678", 17)


def test_end_is_parsed() -> None:
    assert isinstance(parse({"type": "END"}), EndMessage)


@pytest.mark.parametrize(
    ("body", "code"),
    [
        (start(schema="aqr.live/2"), "unsupported_schema"),
        (start(schema=None), "unsupported_schema"),
        (
            start(audio={"encoding": "pcm_f32le", "sample_rate": 16000, "channels": 1}),
            "bad_audio_format",
        ),
        (
            start(audio={"encoding": "pcm_s16le", "sample_rate": 44100, "channels": 1}),
            "bad_audio_format",
        ),
        (
            start(audio={"encoding": "pcm_s16le", "sample_rate": 16000, "channels": 2}),
            "bad_audio_format",
        ),
        (
            start(audio={"encoding": "pcm_s16le", "sample_rate": "16000", "channels": 1}),
            "bad_audio_format",
        ),
        (start(audio=None), "bad_audio_format"),
        (start(audio="pcm"), "bad_audio_format"),
        (start(token=None), "token_invalid"),
        (start(token=""), "token_invalid"),
        (start(token=12), "token_invalid"),
        (start(token="x" * 2000), "token_invalid"),
        (start(options={"translation": "klingon"}), "bad_message"),
        (start(options={"translation": 4}), "bad_message"),
        (start(options={"technical": "oui"}), "bad_message"),
        (start(options="x"), "bad_message"),
        (start(resume={"session_id": "", "last_seq": 1}), "bad_message"),
        (start(resume={"session_id": "a b", "last_seq": 1}), "bad_message"),
        (start(resume={"session_id": "abcdefgh12345678", "last_seq": -1}), "bad_message"),
        (start(resume={"session_id": "abcdefgh12345678", "last_seq": "3"}), "bad_message"),
        (start(resume={"session_id": "abcdefgh12345678", "last_seq": True}), "bad_message"),
        (start(resume="abc"), "bad_message"),
        ({"type": "STOP"}, "bad_message"),
        ({"type": 3}, "bad_message"),
        ({}, "bad_message"),
        ([], "bad_message"),
        ("texte", "bad_message"),
        (None, "bad_message"),
    ],
)
def test_a_malformed_message_is_refused_with_the_right_code(body: object, code: str) -> None:
    with pytest.raises(ProtocolError) as raised:
        parse(body)
    assert raised.value.code == code


@pytest.mark.parametrize("text", ["", "{", "pas du json", "\x00\x01", "{" * 10_000, "nan", "[1,"])
def test_unreadable_json_is_a_protocol_error_not_a_crash(text: str) -> None:
    with pytest.raises(ProtocolError) as raised:
        parse_client_text(text, max_bytes=100_000)
    assert raised.value.code == "bad_message"


def test_an_oversized_text_message_is_refused_before_parsing() -> None:
    with pytest.raises(ProtocolError) as raised:
        parse_client_text(json.dumps(start(pad="x" * 5000)), max_bytes=4096)
    assert raised.value.code == "bad_message"


def test_every_error_code_has_a_clear_french_message_and_a_recoverable_flag() -> None:
    assert {
        "bad_message",
        "unsupported_schema",
        "bad_audio_format",
        "bad_audio_block",
        "stream_too_long",
        "silence_too_long",
        "idle_timeout",
        "start_timeout",
        "session_expired",
        "replay_unavailable",
        "token_invalid",
        "token_expired",
        "token_replayed",
        "too_many_streams",
        "server_busy",
        "internal",
    } <= set(ERROR_CODES)
    for code, spec in ERROR_CODES.items():
        assert spec.message.endswith("."), code
        assert len(spec.message) > 40, code
        for forbidden in ("Traceback", "Exception", "None", "null", "WARN", "0x"):
            assert forbidden not in spec.message, (code, forbidden)


def test_an_error_message_follows_the_envelope() -> None:
    message = error_message("token_expired")
    assert message["schema"] == SCHEMA
    assert message["type"] == "ERROR"
    assert message["seq"] == 0
    assert message["code"] == "token_expired"
    assert message["recoverable"] is True
    assert "retry_after_s" not in message


def test_a_busy_error_gives_a_retry_delay() -> None:
    message = error_message("server_busy", retry_after_s=5)
    assert message["retry_after_s"] == 5
    assert message["recoverable"] is True


def test_an_unknown_error_code_is_a_programming_error() -> None:
    with pytest.raises(KeyError):
        error_message("inconnu")
