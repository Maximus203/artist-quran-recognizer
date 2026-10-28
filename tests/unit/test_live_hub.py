"""LiveHub : jetons à usage unique, quotas par compte et global, sessions et reprise."""

from __future__ import annotations

from typing import Any

import pytest

from aqr.adapters.ws.hmac_tokens import HmacTokenCodec
from aqr.live.hub import LiveHub
from aqr.live.protocol import ProtocolError, ResumeRequest, StartMessage
from aqr.live.service_config import LiveServiceConfig

KEY = "k" * 40
NOW = 1_800_000_000.0


class StubStream:
    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.ended = False
        self.replay: list[dict[str, Any]] | None = []

    def messages_after(self, last_seq: int) -> list[dict[str, Any]] | None:
        return self.replay


def make_hub(**changes: Any) -> LiveHub:
    config = LiveServiceConfig(**{"max_streams": 3, "max_streams_per_account": 2, **changes})

    def factory(
        session_id: str, translation: str | None, technical: bool, surah: int | None = None
    ) -> StubStream:
        stream = StubStream(session_id)
        stream.translation = translation  # type: ignore[attr-defined]
        stream.technical = technical  # type: ignore[attr-defined]
        return stream

    return LiveHub(config, HmacTokenCodec(KEY), factory)  # type: ignore[arg-type]


def token(subject: str = "7", *, technical: bool = False, now: float = NOW, ttl: float = 60) -> str:
    return HmacTokenCodec(KEY).issue(subject, ttl, now=now, technical=technical)


def start(tok: str, **changes: Any) -> StartMessage:
    base: dict[str, Any] = {
        "token": tok,
        "translation": "french_hameedullah",
        "technical": False,
        "resume": None,
    }
    return StartMessage(**{**base, **changes})


def open_one(hub: LiveHub, subject: str = "7", **changes: Any):  # type: ignore[no-untyped-def]
    claims = hub.authenticate(token(subject), NOW)
    return hub.open_session(claims, start("x", **changes), NOW)


# --------------------------------------------------------------------------- jetons
def test_a_valid_token_authenticates_once() -> None:
    hub = make_hub()
    tok = token()
    assert hub.authenticate(tok, NOW).subject == "7"
    with pytest.raises(ProtocolError) as raised:
        hub.authenticate(tok, NOW + 1)
    assert raised.value.code == "token_replayed"


def test_an_expired_token_is_refused_and_does_not_burn_a_slot() -> None:
    hub = make_hub()
    with pytest.raises(ProtocolError) as raised:
        hub.authenticate(token(now=NOW - 600), NOW)
    assert raised.value.code == "token_expired"


def test_a_forged_token_is_invalid() -> None:
    hub = make_hub()
    with pytest.raises(ProtocolError) as raised:
        hub.authenticate(HmacTokenCodec("z" * 40).issue("7", 60, now=NOW), NOW)
    assert raised.value.code == "token_invalid"


def test_used_token_ids_are_forgotten_once_they_cannot_replay_anyway() -> None:
    hub = make_hub()
    for _ in range(50):
        hub.authenticate(token(), NOW)
    hub.authenticate(token(now=NOW + 3600), NOW + 3600)
    assert hub.used_token_count == 1


# --------------------------------------------------------------------------- sessions et quotas
def test_opening_a_session_gives_a_random_id_and_the_options() -> None:
    hub = make_hub()
    session = open_one(hub, translation=None)
    assert len(session.id) >= 22
    assert session.stream.translation is None  # type: ignore[attr-defined]
    assert hub.active_count == 1
    assert open_one(hub).id != session.id


def test_technical_mode_needs_both_the_token_and_the_request() -> None:
    hub = make_hub(max_streams=8, max_streams_per_account=4)
    allowed = hub.authenticate(token(technical=True), NOW)
    denied = hub.authenticate(token(), NOW)
    assert hub.open_session(allowed, start("x", technical=True), NOW).stream.technical  # type: ignore[attr-defined]
    assert not hub.open_session(allowed, start("x", technical=False), NOW).stream.technical  # type: ignore[attr-defined]
    assert not hub.open_session(denied, start("x", technical=True), NOW).stream.technical  # type: ignore[attr-defined]


def test_an_account_cannot_exceed_its_streams() -> None:
    hub = make_hub()
    open_one(hub)
    open_one(hub)
    with pytest.raises(ProtocolError) as raised:
        open_one(hub)
    assert raised.value.code == "too_many_streams"
    assert open_one(hub, "8")  # un autre compte a encore de la place


def test_the_whole_service_has_a_global_limit() -> None:
    hub = make_hub()
    open_one(hub, "1")
    open_one(hub, "2")
    open_one(hub, "3")
    with pytest.raises(ProtocolError) as raised:
        open_one(hub, "4")
    assert raised.value.code == "server_busy"


def test_a_finished_stream_frees_its_place() -> None:
    hub = make_hub()
    first = open_one(hub)
    open_one(hub)
    hub.finish(first)
    assert hub.active_count == 1
    assert open_one(hub)


def test_finishing_twice_is_harmless() -> None:
    hub = make_hub()
    session = open_one(hub)
    hub.finish(session)
    hub.finish(session)
    assert hub.active_count == 0


# --------------------------------------------------------------------------- reprise
def test_a_detached_session_resumes_with_a_new_token_for_the_same_account() -> None:
    hub = make_hub(resume_ttl_s=30)
    session = open_one(hub)
    hub.detach(session, NOW + 5)
    claims = hub.authenticate(token("7", now=NOW + 10), NOW + 10)
    resumed, replay = hub.resume_session(claims, ResumeRequest(session.id, 0), NOW + 10)
    assert resumed is session
    assert replay == []
    assert session.generation == 2


def test_another_account_cannot_resume_and_learns_nothing() -> None:
    hub = make_hub()
    session = open_one(hub, "7")
    hub.detach(session, NOW)
    claims = hub.authenticate(token("8"), NOW)
    with pytest.raises(ProtocolError) as raised:
        hub.resume_session(claims, ResumeRequest(session.id, 0), NOW)
    assert raised.value.code == "session_expired"  # même réponse que pour une session inconnue


def test_an_unknown_session_cannot_be_resumed() -> None:
    hub = make_hub()
    claims = hub.authenticate(token(), NOW)
    with pytest.raises(ProtocolError) as raised:
        hub.resume_session(claims, ResumeRequest("inconnue-0123456789", 0), NOW)
    assert raised.value.code == "session_expired"


def test_a_session_detached_for_too_long_expires() -> None:
    hub = make_hub(resume_ttl_s=30)
    session = open_one(hub)
    hub.detach(session, NOW)
    assert hub.expire(NOW + 29) == []
    assert hub.expire(NOW + 31) == [session]
    assert hub.active_count == 0
    claims = hub.authenticate(token(now=NOW + 40), NOW + 40)
    with pytest.raises(ProtocolError) as raised:
        hub.resume_session(claims, ResumeRequest(session.id, 0), NOW + 40)
    assert raised.value.code == "session_expired"


def test_an_attached_session_never_expires() -> None:
    hub = make_hub(resume_ttl_s=30)
    session = open_one(hub)
    assert hub.expire(NOW + 10_000) == []
    assert session in hub.sessions()


def test_resume_takes_over_a_session_still_attached_to_a_dead_connection() -> None:
    hub = make_hub()
    session = open_one(hub)
    before = session.generation
    claims = hub.authenticate(token(now=NOW + 1), NOW + 1)
    resumed, _ = hub.resume_session(claims, ResumeRequest(session.id, 0), NOW + 1)
    assert resumed.generation == before + 1  # l'ancienne connexion saura qu'elle est remplacée


def test_a_replay_that_the_ring_cannot_serve_is_an_error() -> None:
    hub = make_hub()
    session = open_one(hub)
    session.stream.replay = None  # type: ignore[attr-defined]
    hub.detach(session, NOW)
    claims = hub.authenticate(token(now=NOW + 1), NOW + 1)
    with pytest.raises(ProtocolError) as raised:
        hub.resume_session(claims, ResumeRequest(session.id, 0), NOW + 1)
    assert raised.value.code == "replay_unavailable"


def test_the_missed_messages_are_returned_in_order() -> None:
    hub = make_hub()
    session = open_one(hub)
    session.stream.replay = [{"seq": 4}, {"seq": 5}]  # type: ignore[attr-defined]
    hub.detach(session, NOW)
    claims = hub.authenticate(token(now=NOW + 1), NOW + 1)
    _, replay = hub.resume_session(claims, ResumeRequest(session.id, 3), NOW + 1)
    assert [m["seq"] for m in replay] == [4, 5]


def test_an_ended_session_cannot_be_resumed() -> None:
    hub = make_hub()
    session = open_one(hub)
    session.stream.ended = True  # type: ignore[attr-defined]
    hub.detach(session, NOW)
    claims = hub.authenticate(token(now=NOW + 1), NOW + 1)
    with pytest.raises(ProtocolError) as raised:
        hub.resume_session(claims, ResumeRequest(session.id, 0), NOW + 1)
    assert raised.value.code == "session_expired"


# --------------------------------------------------------------------------- configuration
def test_the_configuration_comes_from_the_environment_and_rejects_nonsense() -> None:
    config = LiveServiceConfig.from_env({"AQR_LIVE_PORT": "9000", "AQR_LIVE_MAX_STREAMS": "8"})
    assert (config.host, config.port, config.max_streams) == ("127.0.0.1", 9000, 8)
    for bad in (
        {"AQR_LIVE_PORT": "abc"},
        {"AQR_LIVE_PORT": "70000"},
        {"AQR_LIVE_MAX_STREAMS": "-1"},
    ):
        with pytest.raises(ValueError):
            LiveServiceConfig.from_env(bad)


def test_the_service_listens_on_the_loopback_by_default() -> None:
    assert LiveServiceConfig().host == "127.0.0.1"
    with pytest.raises(ValueError, match="per_account"):
        LiveServiceConfig(max_streams=1, max_streams_per_account=2)
