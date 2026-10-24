"""Le service du direct avec le VRAI modèle et de l'audio EveryAyah, par un vrai socket.

Marqué `slow` (modèle ONNX réel, 40 s d'audio rejoué en temps réel). Il saute sans `AQR_MODELS_DIR` ni
`AQR_AUDIO_DIR`. Preuve : ce que le service envoie est EXACTEMENT ce que le moteur rend hors réseau,
quelle que soit l'allure du client (aussi vite que possible, ou à la vitesse de la voix).
"""

from __future__ import annotations

import json
import time
from typing import Any

import pytest

pytest.importorskip("websockets")
pytest.importorskip("onnxruntime")

from tests.support.live_service import ServiceHarness, real_engine  # noqa: E402
from tests.support.real import concat, everyayah_clip  # noqa: E402

from aqr.adapters.ws.client import LiveClient, pcm_from_floats  # noqa: E402
from aqr.eval.recognition import parse_recognition_text  # noqa: E402

pytestmark = pytest.mark.slow
RECITER = "Alafasy_128kbps"
BLOCK = 3200  # 100 ms de PCM 16 kHz s16le


@pytest.fixture(scope="module")
def pcm() -> bytes:
    clips = [everyayah_clip(RECITER, f"067{n:03d}.mp3") for n in (1, 2, 3)]
    return pcm_from_floats(concat(*clips).samples)


@pytest.fixture(scope="module")
def harness():  # type: ignore[no-untyped-def]
    with ServiceHarness(engine=real_engine(), max_streams=4) as running:
        yield running


def in_process(harness: ServiceHarness, pcm: bytes) -> list[dict[str, Any]]:
    """Le même flux, sans réseau : la référence."""
    stream = harness.factory("reference-0001", "french_hameedullah", False)
    messages: list[dict[str, Any]] = []
    for i in range(0, len(pcm), BLOCK):
        messages.extend(stream.push(pcm[i : i + BLOCK]))
    messages.extend(stream.end())
    return messages


def over_the_socket(
    harness: ServiceHarness, pcm: bytes, *, realtime: bool
) -> tuple[list[dict[str, Any]], LiveClient]:
    client = LiveClient(harness.url).open()
    client.start(harness.token("9"))
    ready = client.recv(10)
    assert ready is not None and ready["type"] == "READY"
    client.stream(pcm, block_ms=100, realtime=realtime)
    client.end()
    client.recv_until(lambda m: m["type"] == "FINAL", timeout=120)
    return [r.message for r in client.received if r.message["seq"] > 0], client


def comparable(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = json.loads(json.dumps(messages))
    for message in out:
        if message["type"] == "FINAL":
            message["document"]["source"]["file"] = "live:x"
            message["document"]["timing"] = {}
    return out


def test_the_service_sends_exactly_what_the_engine_decides_as_fast_as_possible(
    harness: ServiceHarness, pcm: bytes
) -> None:
    reference = in_process(harness, pcm)
    served, client = over_the_socket(harness, pcm, realtime=False)
    assert comparable(served) == comparable(reference)
    kinds = [m["type"] for m in served]
    assert "LOCKED" in kinds and "CONTINUE" in kinds
    locked = [m["interval"]["ref"] for m in served if m["type"] == "LOCKED"]
    assert locked[0] == "67:1"
    document = served[-1]["document"]
    parse_recognition_text(json.dumps(document), "live")
    assert client.close_code == 1000 or client.drain(2) == []


def test_at_the_speed_of_the_voice_the_service_keeps_up_and_says_the_same(
    harness: ServiceHarness, pcm: bytes
) -> None:
    reference = in_process(harness, pcm)
    started = time.perf_counter()
    served, _client = over_the_socket(harness, pcm, realtime=True)
    elapsed = time.perf_counter() - started
    duration = len(pcm) / 2 / 16000
    assert duration * 0.98 < elapsed < duration + 6.0  # ni plus vite que la voix, ni très en retard
    assert comparable(served) == comparable(reference)
    assert not [m for m in served if m["type"] == "DEGRADED"]
