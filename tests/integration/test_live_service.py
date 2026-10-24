"""Le service du direct, démarré pour de vrai (WebSocket, jetons, quotas), avec un faux ASR.

Un vrai client WebSocket parle au vrai serveur sur 127.0.0.1 : poignée de main, jetons, origines,
quotas, reprise, contre-pression, arrêt. Le modèle réel est éprouvé séparément
(`tests/integration/test_live_service_real.py`, `scripts/measure_live_service.py`).
"""

from __future__ import annotations

import contextlib
import json
import logging
import socket
import time
from pathlib import Path

import pytest

pytest.importorskip("websockets")

from tests.support.live_service import ServiceHarness, pcm_loud, script_of
from websockets.exceptions import ConnectionClosed, InvalidStatus

from aqr.adapters.ws.client import LiveClient
from aqr.eval.recognition import parse_recognition_text
from aqr.live.budget import BudgetConfig

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"
pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "quran-uthmani.txt").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)
AUDIO = pcm_loud(4.0)


def connect(harness: ServiceHarness, *, origin: str | None = None) -> LiveClient:
    return LiveClient(harness.url, origin=origin).open()


def run_stream(
    harness: ServiceHarness, *, subject: str = "7", audio: bytes = AUDIO, technical: bool = False
) -> LiveClient:
    client = connect(harness)
    client.start(harness.token(subject, technical=technical), technical=technical)
    ready = client.recv()
    assert ready is not None and ready["type"] == "READY"
    client.stream(audio)
    client.end()
    client.recv_until(lambda m: m["type"] == "FINAL")
    return client


def types(client: LiveClient) -> list[str]:
    return [r.message["type"] for r in client.received]


# --------------------------------------------------------------------------- parcours nominal
def test_a_full_stream_gives_ready_events_and_the_final_document() -> None:
    with ServiceHarness() as harness:
        client = run_stream(harness)
        kinds = types(client)
        assert kinds[0] == "READY"
        assert kinds.index("CANDIDATES") < kinds.index("LOCKED") < kinds.index("CONTINUE")
        assert kinds[-1] == "FINAL"
        ready = client.received[0].message
        assert ready["seq"] == 0
        assert ready["resumed"] is False
        assert len(ready["session_id"]) >= 22
        assert ready["limits"]["max_block_bytes"] == harness.config.max_block_bytes
        seqs = [r.message["seq"] for r in client.received[1:]]
        assert seqs == list(range(1, len(seqs) + 1))
        document = client.of_type("FINAL")[0]["document"]
        recognition = parse_recognition_text(json.dumps(document), "live")
        assert document["intervals"][0]["ref"] == "112:1"
        assert recognition.intervals
        assert client.drain(2) == []
        assert client.close_code == 1000


def test_several_streams_at_once_do_not_mix() -> None:
    with ServiceHarness() as harness:
        clients = []
        for subject in ("1", "2", "3"):
            client = connect(harness)
            client.start(harness.token(subject))
            assert client.recv()["type"] == "READY"  # type: ignore[index]
            clients.append(client)
        for client in clients:
            client.stream(AUDIO)
            client.end()
        for client in clients:
            client.recv_until(lambda m: m["type"] == "FINAL")
        ids = {c.received[0].message["session_id"] for c in clients}
        assert len(ids) == 3
        for client in clients:
            assert [m["interval"]["ref"] for m in client.of_type("LOCKED")] == ["112:1"]


def test_the_partial_transcript_needs_both_the_account_right_and_the_request() -> None:
    with ServiceHarness() as harness:
        plain = run_stream(harness, subject="1", technical=False)
        technical = run_stream(harness, subject="2", technical=True)
        refused = connect(harness)
        refused.start(harness.token("3", technical=False), technical=True)  # demande sans droit
        refused.recv()
        refused.stream(AUDIO)
        refused.end()
        refused.recv_until(lambda m: m["type"] == "FINAL")
        assert "PARTIAL" not in types(plain)
        assert "PARTIAL" in types(technical)
        assert "PARTIAL" not in types(refused)


def test_health_answers_for_an_allowed_host_without_opening_a_stream() -> None:
    with ServiceHarness() as harness:
        import urllib.request

        with urllib.request.urlopen(harness.http + "/health", timeout=5) as response:
            body = json.loads(response.read())
        assert body == {"status": "ok", "streams": 0, "capacity": 4}


# --------------------------------------------------------------------------- origine et hôte
def test_the_atelier_origin_and_a_client_without_origin_are_accepted() -> None:
    with ServiceHarness() as harness:
        for number, origin in enumerate(("http://127.0.0.1:3000", "http://localhost:3000", None)):
            client = connect(harness, origin=origin)
            client.start(harness.token(str(number)))
            assert client.recv()["type"] == "READY"  # type: ignore[index]
            client.close()


def test_a_foreign_origin_is_refused_before_the_websocket_opens() -> None:
    with ServiceHarness() as harness:
        client = LiveClient(harness.url, origin="https://evil.example")
        with pytest.raises(InvalidStatus) as raised:
            client.open()
        assert raised.value.response.status_code == 403


def test_a_rebound_host_header_is_refused() -> None:
    """DNS rebinding : la requête arrive sur 127.0.0.1 mais annonce un autre nom d'hôte."""
    with ServiceHarness() as harness, socket.create_connection(("127.0.0.1", harness.port)) as raw:
        raw.sendall(
            b"GET /live HTTP/1.1\r\nHost: evil.example\r\nUpgrade: websocket\r\n"
            b"Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
            b"Sec-WebSocket-Version: 13\r\n\r\n"
        )
        assert raw.recv(200).startswith(b"HTTP/1.1 403")


def test_an_unknown_path_is_a_404_and_health_also_checks_the_host() -> None:
    with ServiceHarness() as harness:
        with pytest.raises(InvalidStatus) as raised:
            LiveClient(harness.url.replace("/live", "/autre")).open()
        assert raised.value.response.status_code == 404
        with socket.create_connection(("127.0.0.1", harness.port)) as raw:
            raw.sendall(b"GET /health HTTP/1.1\r\nHost: evil.example\r\n\r\n")
            assert raw.recv(200).startswith(b"HTTP/1.1 403")


# --------------------------------------------------------------------------- jetons
def error_code(client: LiveClient) -> str:
    message = client.recv()
    assert message is not None and message["type"] == "ERROR", message
    assert message["seq"] == 0
    assert message["message"].endswith(".")
    return str(message["code"])


def test_a_token_works_once_only() -> None:
    with ServiceHarness() as harness:
        token = harness.token()
        first = connect(harness)
        first.start(token)
        assert first.recv()["type"] == "READY"  # type: ignore[index]
        second = connect(harness)
        second.start(token)
        assert error_code(second) == "token_replayed"


def test_an_expired_token_is_refused() -> None:
    with ServiceHarness() as harness:
        client = connect(harness)
        client.start(harness.token(now=time.time() - 600))
        assert error_code(client) == "token_expired"


def test_a_forged_or_missing_token_is_refused() -> None:
    with ServiceHarness() as harness:
        client = connect(harness)
        client.start("v1.AAAA.BBBB")
        assert error_code(client) == "token_invalid"
        other = connect(harness)
        other.send_text(json.dumps({"type": "START", "schema": "aqr.live/1"}))
        assert error_code(other) in ("token_invalid", "bad_audio_format")


# --------------------------------------------------------------------------- quotas
def test_an_account_cannot_open_more_streams_than_allowed() -> None:
    with ServiceHarness(max_streams_per_account=1) as harness:
        first = connect(harness)
        first.start(harness.token("7"))
        assert first.recv()["type"] == "READY"  # type: ignore[index]
        second = connect(harness)
        second.start(harness.token("7"))
        assert error_code(second) == "too_many_streams"
        other = connect(harness)
        other.start(harness.token("8"))
        assert other.recv()["type"] == "READY"  # type: ignore[index]


def test_the_whole_service_has_a_stream_limit_and_a_freed_place_is_reusable() -> None:
    with ServiceHarness(max_streams=2, max_streams_per_account=2) as harness:
        a = connect(harness)
        a.start(harness.token("1"))
        a.recv()
        b = connect(harness)
        b.start(harness.token("2"))
        b.recv()
        c = connect(harness)
        c.start(harness.token("3"))
        message = c.recv()
        assert message is not None and message["code"] == "server_busy"
        assert message["retry_after_s"] > 0
        a.stream(AUDIO)
        a.end()
        a.recv_until(lambda m: m["type"] == "FINAL")
        time.sleep(0.2)
        d = connect(harness)
        d.start(harness.token("4"))
        assert d.recv()["type"] == "READY"  # type: ignore[index]


def test_a_clean_close_without_end_frees_the_place_but_a_cut_keeps_it() -> None:
    with ServiceHarness(max_streams_per_account=1) as harness:
        polite = started(harness, "1")
        polite.close()  # fermeture propre (1000) : le flux est fini
        deadline = time.time() + 3
        while harness.hub.active_count and time.time() < deadline:
            time.sleep(0.05)
        assert harness.hub.active_count == 0
        cut = started(harness, "1")
        cut.drop()  # coupure brutale : la session attend une reprise et garde sa place
        time.sleep(0.3)
        assert harness.hub.active_count == 1


def test_too_many_unauthenticated_connections_are_turned_away() -> None:
    with ServiceHarness(max_unauthenticated=2, start_timeout_s=3.0) as harness:
        silent = [connect(harness), connect(harness)]
        time.sleep(0.2)
        third = connect(harness)
        with pytest.raises(ConnectionClosed):
            third.recv_until(lambda m: False, timeout=2.0)
        assert third.close_code == 1013
        for client in silent:
            client.close()


# --------------------------------------------------------------------------- messages mal formés
@pytest.mark.parametrize(
    ("payload", "code"),
    [
        ("pas du json", "bad_message"),
        ("{}", "bad_message"),
        ('{"type":"END"}', "bad_message"),
        ('{"type":"START","schema":"aqr.live/9","token":"x","audio":{}}', "unsupported_schema"),
        (
            '{"type":"START","schema":"aqr.live/1","token":"x",'
            '"audio":{"encoding":"pcm_f32le","sample_rate":16000,"channels":1}}',
            "bad_audio_format",
        ),
        (b"\x00\x01\x02\x03", "bad_message"),
        ("x" * 5000, "bad_message"),
    ],
)
def test_a_bad_first_message_gets_a_clear_error_and_never_crashes_the_service(
    payload: str | bytes, code: str
) -> None:
    with ServiceHarness() as harness:
        client = connect(harness)
        if isinstance(payload, bytes):
            client.send_audio(payload)
        else:
            client.send_text(payload)
        assert error_code(client) == code
        healthy = connect(harness)  # le service tient toujours
        healthy.start(harness.token())
        assert healthy.recv()["type"] == "READY"  # type: ignore[index]


def test_a_connection_that_never_starts_is_closed() -> None:
    with ServiceHarness(start_timeout_s=0.4) as harness:
        client = connect(harness)
        assert error_code(client) == "start_timeout"


def test_a_second_start_in_a_running_stream_ends_it_cleanly() -> None:
    with ServiceHarness() as harness:
        client = connect(harness)
        client.start(harness.token())
        client.recv()
        client.start(harness.token())
        messages = client.recv_until(lambda m: m["type"] == "FINAL")
        assert any(m["type"] == "ERROR" and m["code"] == "bad_message" for m in messages)


# --------------------------------------------------------------------------- audio invalide
def started(harness: ServiceHarness, subject: str = "7") -> LiveClient:
    client = connect(harness)
    client.start(harness.token(subject))
    assert client.recv()["type"] == "READY"  # type: ignore[index]
    return client


@pytest.mark.parametrize("block", [b"", b"\x01", b"\x01\x02\x03"])
def test_an_empty_or_odd_block_ends_the_stream_with_its_result(block: bytes) -> None:
    with ServiceHarness() as harness:
        client = started(harness)
        client.send_audio(pcm_loud(1.0))
        client.send_audio(block)
        messages = client.recv_until(lambda m: m["type"] == "FINAL")
        errors = [m for m in messages if m["type"] == "ERROR"]
        assert [e["code"] for e in errors] == ["bad_audio_block"]
        assert messages[-1]["document"]["schema"] == "aqr.recognition/1"


def test_a_block_over_the_limit_is_refused_and_the_service_survives() -> None:
    with ServiceHarness(max_block_bytes=3200) as harness:
        client = started(harness)
        client.send_audio(b"\x00\x01" * 2000)  # 4 000 octets : plus que 3 200
        messages = client.recv_until(lambda m: m["type"] == "FINAL")
        assert [m["code"] for m in messages if m["type"] == "ERROR"] == ["bad_audio_block"]
        started(harness, "8")


def test_a_huge_frame_closes_the_connection_without_hurting_the_service() -> None:
    with ServiceHarness(max_block_bytes=3200) as harness:
        client = started(harness)
        client.send_audio(b"\x00\x00" * 200_000)
        with pytest.raises(ConnectionClosed):
            client.recv_until(lambda m: False, timeout=3.0)
        assert client.close_code == 1009
        started(harness, "8")


def test_a_stream_over_the_maximum_duration_is_stopped_with_its_result() -> None:
    with ServiceHarness(max_stream_s=1.0) as harness:
        client = started(harness)
        client.stream(pcm_loud(1.5))
        messages = client.recv_until(lambda m: m["type"] == "FINAL")
        assert [m["code"] for m in messages if m["type"] == "ERROR"] == ["stream_too_long"]


def test_a_long_silence_is_stopped() -> None:
    with ServiceHarness(max_silence_s=1.0) as harness:
        client = started(harness)
        client.stream(pcm_loud(2.0, level=0.0))
        messages = client.recv_until(lambda m: m["type"] == "FINAL")
        assert [m["code"] for m in messages if m["type"] == "ERROR"] == ["silence_too_long"]


def test_a_client_that_goes_quiet_gets_an_idle_error_and_can_resume() -> None:
    with ServiceHarness(idle_timeout_s=0.5) as harness:
        client = started(harness)
        client.stream(pcm_loud(1.0))
        messages = client.recv_until(lambda m: m["type"] == "ERROR", timeout=5)
        assert messages[-1]["code"] == "idle_timeout"
        assert messages[-1]["recoverable"] is True
        session_id = client.received[0].message["session_id"]
        again = connect(harness)
        again.start(harness.token(), resume=(session_id, client.last_seq))
        ready = again.recv()
        assert ready is not None and ready["resumed"] is True


# --------------------------------------------------------------------------- reprise après coupure
def test_a_cut_connection_resumes_without_losing_or_repeating_an_event() -> None:
    with ServiceHarness() as harness:
        reference = run_stream(harness, subject="1")
        client = started(harness, "2")
        session_id = client.received[0].message["session_id"]
        client.stream(AUDIO[: 16000 * 2 * 3])  # 3 s d'audio
        client.recv_until(lambda m: m["type"] == "LOCKED")
        seen = client.last_seq
        client.drop()
        time.sleep(0.3)  # le service continue de traiter ce qu'il a reçu
        resumed = connect(harness)
        resumed.start(harness.token("2"), resume=(session_id, seen))
        ready = resumed.recv()
        assert ready is not None and ready["resumed"] is True
        assert ready["last_seq"] >= seen
        received_samples = ready["audio_received_samples"]
        assert received_samples == 16000 * 3
        resumed.stream(AUDIO, offset_samples=received_samples)
        resumed.end()
        resumed.recv_until(lambda m: m["type"] == "FINAL")
        merged = [r.message for r in client.received if r.message["seq"] > 0]
        merged += [r.message for r in resumed.received if r.message["seq"] > 0]
        sequence = sorted({m["seq"] for m in merged})
        assert sequence == list(range(1, sequence[-1] + 1))  # aucun trou
        replayed = [r.message["seq"] for r in resumed.received if r.message["seq"] > 0]
        assert replayed == sorted(set(replayed))  # aucun doublon sur la nouvelle connexion
        assert all(s > seen for s in replayed)
        assert [m["type"] for m in merged if m["type"] in ("LOCKED", "CONTINUE")] == [
            r.message["type"]
            for r in reference.received
            if r.message["type"] in ("LOCKED", "CONTINUE")
        ]
        final = resumed.of_type("FINAL")[0]["document"]["intervals"]
        assert final == reference.of_type("FINAL")[0]["document"]["intervals"]


def test_another_account_cannot_take_a_session_over() -> None:
    with ServiceHarness() as harness:
        client = started(harness, "1")
        session_id = client.received[0].message["session_id"]
        client.drop()
        time.sleep(0.2)
        thief = connect(harness)
        thief.start(harness.token("2"), resume=(session_id, 0))
        assert error_code(thief) == "session_expired"


def test_an_unknown_session_cannot_be_resumed() -> None:
    with ServiceHarness() as harness:
        client = connect(harness)
        client.start(harness.token(), resume=("inconnue-0123456789", 0))
        assert error_code(client) == "session_expired"


def test_a_session_left_too_long_expires_but_its_result_is_handed_back_once() -> None:
    with ServiceHarness(resume_ttl_s=0.5) as harness:
        client = started(harness, "1")
        session_id = client.received[0].message["session_id"]
        client.stream(AUDIO)
        client.drop()
        time.sleep(2.2)  # TTL dépassé et passage du ramasse-miettes
        assert harness.hub.active_count == 0
        late = connect(harness)
        late.start(harness.token("1"), resume=(session_id, 0))
        messages = late.drain(3)
        assert messages[0]["type"] == "ERROR" and messages[0]["code"] == "session_expired"
        assert messages[-1]["type"] == "FINAL"
        again = connect(harness)
        again.start(harness.token("1"), resume=(session_id, 0))
        assert error_code(again) == "session_expired"


def test_a_new_connection_takes_over_and_the_old_one_is_closed() -> None:
    with ServiceHarness() as harness:
        old = started(harness)
        session_id = old.received[0].message["session_id"]
        new = connect(harness)
        new.start(harness.token(), resume=(session_id, 0))
        assert new.recv()["resumed"] is True  # type: ignore[index]
        with pytest.raises(ConnectionClosed):
            old.recv_until(lambda m: False, timeout=3.0)
        new.stream(AUDIO)
        new.end()
        new.recv_until(lambda m: m["type"] == "FINAL")


def test_a_replay_the_ring_cannot_serve_is_an_error_not_a_silent_gap() -> None:
    with ServiceHarness(ring_messages=2) as harness:
        client = started(harness)
        session_id = client.received[0].message["session_id"]
        client.stream(AUDIO)
        client.recv_until(lambda m: m["type"] == "CONTINUE" or m["seq"] > 8)
        client.drop()
        time.sleep(0.3)
        again = connect(harness)
        again.start(harness.token(), resume=(session_id, 0))
        assert error_code(again) == "replay_unavailable"


# ------------------------------------------------------------ charge et contre-pression
def test_a_flood_faster_than_the_engine_is_throttled_not_lost() -> None:
    with ServiceHarness(cost_s=0.04, max_backlog_s=1.0, stall_timeout_s=30.0) as harness:
        client = started(harness)
        client.stream(pcm_loud(6.0), block_ms=100)  # 60 blocs d'un coup, traitement 40 ms chacun
        client.end()
        client.recv_until(lambda m: m["type"] == "FINAL", timeout=30)
        assert harness.server.metrics.paused_reads > 0
        assert harness.server.metrics.max_backlog_s <= 1.0 + 0.11
        assert client.of_type("FINAL")[0]["document"]["source"]["duration_s"] == pytest.approx(6.0)


def test_a_service_that_stays_overwhelmed_refuses_the_stream_instead_of_lagging_forever() -> None:
    with ServiceHarness(cost_s=0.6, max_backlog_s=0.3, stall_timeout_s=0.5) as harness:
        client = started(harness)
        with contextlib.suppress(ConnectionClosed):
            client.stream(pcm_loud(3.0), block_ms=100)
        messages = client.drain(6)
        assert any(m["type"] == "ERROR" and m["code"] == "server_busy" for m in messages)
        assert any(m["type"] == "FINAL" for m in messages)


def test_a_late_arrival_is_a_visible_degradation() -> None:
    budget = BudgetConfig(lag_relisten_s=0.1, lag_acoustic_s=0.3, lag_overload_s=0.6)
    with ServiceHarness(cost_s=0.15, budget=budget, max_backlog_s=60.0) as harness:
        client = started(harness)
        client.stream(pcm_loud(4.0), block_ms=100)  # instantané : la file d'attente se creuse
        client.end()
        client.recv_until(lambda m: m["type"] == "FINAL", timeout=40)
        degraded = client.of_type("DEGRADED")
        assert degraded and degraded[0]["overloaded"] is True


# --------------------------------------------------------------------------- arrêt et vie privée
def test_stopping_the_service_closes_streams_with_a_going_away_code() -> None:
    harness = ServiceHarness().__enter__()
    try:
        client = started(harness)
        harness.stop()
        with pytest.raises(ConnectionClosed):
            client.recv_until(lambda m: False, timeout=5.0)
        assert client.close_code == 1001
    finally:
        harness.stop()


def test_the_log_never_contains_a_token_audio_or_quranic_text(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    with ServiceHarness() as harness:
        token = harness.token()
        client = connect(harness)
        client.start(token)
        client.recv()
        client.stream(AUDIO)
        client.end()
        client.recv_until(lambda m: m["type"] == "FINAL")
        bad = connect(harness)
        bad.start(token)  # rejoué : une ligne de journal, sans le jeton
        bad.recv()
    text = caplog.text
    assert token not in text
    assert token.split(".")[1] not in text
    assert not any("؀" <= ch <= "ۿ" for ch in text)
    assert "\\x00" not in text
    assert "session.open" in text and "token.replayed" in text
    assert "session.stats" in text and "max_lag_s=" in text
    assert script_of("112:1")[0][0] not in text
