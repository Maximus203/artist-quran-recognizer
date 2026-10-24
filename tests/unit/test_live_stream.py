"""Un flux du direct : validation de l'audio, numérotation, rejeu borné, document final."""

from __future__ import annotations

import builtins
import json
import logging
import struct
from pathlib import Path
from typing import Any

import pytest
from tests.support.streaming_fakes import FakeStreamingASR

from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.domain.models import Status, VerseRef
from aqr.domain.ports import Translation
from aqr.eval.recognition import VerseInterval, parse_recognition_text
from aqr.live.clocks import ManualClock
from aqr.live.content import LiveContent
from aqr.live.corpus_flow import load_prefix_index
from aqr.live.final import FinalDocumentBuilder
from aqr.live.pipeline import LivePipeline
from aqr.live.presenter import LivePresenter
from aqr.live.protocol import ProtocolError
from aqr.live.stream import LiveStream, StreamLimits
from aqr.pipeline.result import EngineInfo
from aqr.rendering.home_renderer import HomeRenderer

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"
pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "quran-uthmani.txt").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)
RATE = 16000


class FakeTranslations:
    def get(self, ref: VerseRef, translation_id: str) -> Translation:
        return Translation(ref, f"Traduction de {ref}.", translation_id, "v-test", "QuranEnc test")


@pytest.fixture(scope="module")
def world():  # type: ignore[no-untyped-def]
    corpus = TanzilCorpusRepository(CORPUS_DIR)
    index, skeleton = load_prefix_index(CORPUS_DIR)
    return corpus, index, skeleton


def pcm(seconds: float, level: float = 0.3) -> bytes:
    value = round(level * 32767)
    return struct.pack("<h", value) * round(seconds * RATE)


def words_of(corpus: TanzilCorpusRepository, ref: str, start: float = 0.2, step: float = 0.5):  # type: ignore[no-untyped-def]
    flow = (
        corpus.words(VerseRef.parse(ref))[4:]
        if ref.endswith(":1")
        else corpus.words(VerseRef.parse(ref))
    )
    return [(w, start + i * step, start + (i + 1) * step - 0.05) for i, w in enumerate(flow)]


def make(
    world,
    *,
    script=None,
    technical=False,
    limits=None,
    clock=None,
    translation="french_hameedullah",
):  # type: ignore[no-untyped-def]
    corpus, index, skeleton = world
    clock = clock or ManualClock()
    asr = FakeStreamingASR(script or words_of(corpus, "112:1"), delay_s=0.2)
    pipeline = LivePipeline(asr, index, skeleton, clock=clock)
    renderer = HomeRenderer(corpus, FakeTranslations())
    content = LiveContent(index, corpus, renderer)
    engine = EngineInfo(
        asr=asr.engine, segmenter="aucun (flux)", matcher="suivi d'hypothèses", decoder="direct"
    )
    return LiveStream(
        "sess-0123456789",
        pipeline,
        LivePresenter(content, translation, technical=technical),
        FinalDocumentBuilder(
            content, renderer, engine, corpus_version=corpus.version, translation_id=translation
        ),
        limits or StreamLimits(),
    )


def run(stream: LiveStream, seconds: float, block_s: float = 0.1) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for k in range(round(seconds / block_s)):
        out.extend(stream.push(pcm(block_s), received_at_s=(k + 1) * block_s))
    return out


def types(messages: list[dict[str, Any]]) -> list[str]:
    return [m["type"] for m in messages]


# --------------------------------------------------------------------------- flux nominal
def test_a_recitation_gives_candidates_then_a_lock_then_the_closed_verse(world) -> None:  # type: ignore[no-untyped-def]
    stream = make(world)
    messages = run(stream, 4.0) + stream.end(received_at_s=4.0)
    kinds = types(messages)
    assert "CANDIDATES" in kinds
    assert kinds.index("CANDIDATES") < kinds.index("LOCKED") < kinds.index("CONTINUE")
    assert kinds[-1] == "FINAL"
    locked = next(m for m in messages if m["type"] == "LOCKED")
    assert locked["interval"]["ref"] == "112:1"
    assert locked["interval"]["status"] == "recognized"


def test_every_message_has_the_envelope_and_strictly_increasing_numbers(world) -> None:  # type: ignore[no-untyped-def]
    stream = make(world)
    messages = run(stream, 4.0) + stream.end(received_at_s=4.0)
    assert [m["seq"] for m in messages] == list(range(1, len(messages) + 1))
    assert all(m["schema"] == "aqr.live/1" for m in messages)
    assert all(isinstance(m["t"], int | float) for m in messages)
    json.dumps(messages, ensure_ascii=False)  # tout est sérialisable


def test_partial_text_is_sent_only_in_technical_mode(world) -> None:  # type: ignore[no-untyped-def]
    normal = run(make(world, technical=False), 3.0)
    technical = run(make(world, technical=True), 3.0)
    assert "PARTIAL" not in types(normal)
    assert "PARTIAL" in types(technical)


def test_the_stream_exposes_what_it_received(world) -> None:  # type: ignore[no-untyped-def]
    stream = make(world)
    run(stream, 1.0)
    assert stream.audio_received_s == pytest.approx(1.0)
    assert stream.audio_received_samples == RATE
    assert stream.last_seq == stream.seq


# --------------------------------------------------------------------------- validation
@pytest.mark.parametrize("size", [0, 1, 3, 4001])
def test_an_odd_or_empty_block_is_refused(world, size: int) -> None:  # type: ignore[no-untyped-def]
    stream = make(world)
    with pytest.raises(ProtocolError) as raised:
        stream.push(b"\x01" * size)
    assert raised.value.code == "bad_audio_block"


def test_a_block_over_the_limit_is_refused(world) -> None:  # type: ignore[no-untyped-def]
    stream = make(world, limits=StreamLimits(max_block_bytes=3200))
    with pytest.raises(ProtocolError) as raised:
        stream.push(b"\x00\x01" * 1601)
    assert raised.value.code == "bad_audio_block"
    assert stream.audio_received_samples == 0  # rien n'a été pris en compte


def test_a_stream_over_the_maximum_duration_is_refused_and_still_closable(world) -> None:  # type: ignore[no-untyped-def]
    stream = make(world, limits=StreamLimits(max_stream_s=1.0))
    run(stream, 1.0)
    with pytest.raises(ProtocolError) as raised:
        stream.push(pcm(0.1))
    assert raised.value.code == "stream_too_long"
    assert types(stream.end(received_at_s=1.0))[-1] == "FINAL"


def test_a_long_silence_is_refused(world) -> None:  # type: ignore[no-untyped-def]
    stream = make(world, limits=StreamLimits(max_silence_s=2.0))
    with pytest.raises(ProtocolError) as raised:
        for k in range(30):
            stream.push(pcm(0.1, level=0.0), received_at_s=(k + 1) * 0.1)
    assert raised.value.code == "silence_too_long"


def test_a_pause_shorter_than_the_limit_is_fine_and_speech_resets_the_count(world) -> None:  # type: ignore[no-untyped-def]
    stream = make(world, limits=StreamLimits(max_silence_s=2.0))
    for _ in range(3):
        for _ in range(15):
            stream.push(pcm(0.1, level=0.0))
        stream.push(pcm(0.1, level=0.3))


def test_audio_after_the_end_is_refused(world) -> None:  # type: ignore[no-untyped-def]
    stream = make(world)
    stream.end()
    with pytest.raises(ProtocolError) as raised:
        stream.push(pcm(0.1))
    assert raised.value.code == "bad_message"


def test_ending_twice_gives_nothing_the_second_time(world) -> None:  # type: ignore[no-untyped-def]
    stream = make(world)
    assert types(stream.end())[-1] == "FINAL"
    assert stream.end() == []


# --------------------------------------------------------------------------- reprise
def test_the_messages_after_a_known_number_are_replayed(world) -> None:  # type: ignore[no-untyped-def]
    stream = make(world)
    messages = run(stream, 4.0)
    cut = messages[2]["seq"]
    replay = stream.messages_after(cut)
    assert replay is not None
    assert [m["seq"] for m in replay] == [m["seq"] for m in messages if m["seq"] > cut]
    assert stream.messages_after(stream.seq) == []


def test_a_client_claiming_the_future_cannot_resume(world) -> None:  # type: ignore[no-untyped-def]
    stream = make(world)
    run(stream, 2.0)
    with pytest.raises(ProtocolError) as raised:
        stream.messages_after(stream.seq + 5)
    assert raised.value.code == "bad_message"  # un numéro jamais émis : le client se trompe


def test_the_replay_ring_is_bounded_and_a_gap_is_reported(world) -> None:  # type: ignore[no-untyped-def]
    stream = make(world, limits=StreamLimits(ring_messages=3))
    messages = run(stream, 4.0) + stream.end(received_at_s=4.0)
    assert len(messages) > 3
    assert stream.messages_after(0) is None
    assert stream.messages_after(messages[-4]["seq"]) is not None
    assert len(stream.messages_after(messages[-4]["seq"]) or []) == 3


# --------------------------------------------------------------------------- budget et jitter
def test_a_block_received_long_ago_is_a_visible_lag_not_a_silent_one(world) -> None:  # type: ignore[no-untyped-def]
    clock = ManualClock()
    stream = make(world, clock=clock)
    clock.begin(100.0)  # le serveur traite avec 100 s de retard (réseau, file d'attente)
    messages = stream.push(pcm(0.1), received_at_s=0.0)
    degraded = [m for m in messages if m["type"] == "DEGRADED"]
    assert degraded
    assert degraded[0]["overloaded"] is True
    assert degraded[0]["lag_s"] == pytest.approx(100.0, abs=1.0)


# --------------------------------------------------------------------------- document final
def test_the_final_document_has_the_batch_contract_and_reads_back(world) -> None:  # type: ignore[no-untyped-def]
    stream = make(world)
    messages = run(stream, 4.0) + stream.end(received_at_s=4.0)
    final = messages[-1]
    assert final["type"] == "FINAL"
    document = final["document"]
    assert document["schema"] == "aqr.recognition/1"
    assert document["source"]["file"] == "live:sess-0123456789"
    assert document["source"]["duration_s"] == pytest.approx(4.0)
    assert len(document["source"]["sha256"]) == 64
    recognition = parse_recognition_text(json.dumps(document), "live")
    verses = [i for i in recognition.intervals if isinstance(i, VerseInterval)]
    assert [str(v.ref) for v in verses] == ["112:1"]
    assert verses[0].status is Status.RECOGNIZED
    assert "direct" in " ".join(document["warnings"]).lower()


def test_an_empty_stream_still_ends_with_a_valid_empty_document(world) -> None:  # type: ignore[no-untyped-def]
    stream = make(world)
    final = stream.end()[-1]
    parse_recognition_text(json.dumps(final["document"]), "live")
    assert final["document"]["intervals"] == []


# --------------------------------------------------------------------------- audio jamais conservé
def test_no_audio_is_kept_in_memory_on_disk_or_in_the_log(  # type: ignore[no-untyped-def]
    world, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    stream = make(world)

    def no_file(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("le flux ne doit ouvrir aucun fichier")

    monkeypatch.setattr(builtins, "open", no_file)
    run(stream, 3.0)
    stream.end(received_at_s=3.0)
    assert stream.pipeline.retained_audio_s == 0.0
    for value in vars(stream).values():
        assert not isinstance(value, bytes | bytearray)
    assert "\\x" not in caplog.text


def test_the_end_announces_the_finalization_before_the_final_document(world) -> None:  # type: ignore[no-untyped-def]
    stream = make(world)
    run(stream, 3.0)
    messages = stream.end(received_at_s=3.0)
    kinds = types(messages)
    assert kinds[0] == "FINALIZING"
    assert kinds[-1] == "FINAL"
    assert messages[0]["pending_s"] is None


def test_progress_follows_the_lock_word_by_word(world) -> None:  # type: ignore[no-untyped-def]
    messages = run(make(world), 4.0)
    kinds = types(messages)
    assert "PROGRESS" in kinds
    assert kinds.index("LOCKED") < kinds.index("PROGRESS")
    heard = [m["words_heard"] for m in messages if m["type"] == "PROGRESS"]
    assert heard == sorted(heard)


def test_the_current_degradation_is_readable_for_a_resuming_client(world) -> None:  # type: ignore[no-untyped-def]
    clock = ManualClock()
    stream = make(world, clock=clock)
    assert stream.degradation() == ()
    clock.begin(100.0)
    stream.push(pcm(0.1), received_at_s=0.0)
    assert "overload" in stream.degradation()
