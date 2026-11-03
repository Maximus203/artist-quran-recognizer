"""Adaptateur Muno incrémental (ADR-0011, étape 2) : sans modèle ni torch, par doublures."""

from __future__ import annotations

from typing import Any, ClassVar

import numpy as np
import pytest

from aqr.adapters.muno_incremental import (
    CHUNK_S,
    LOOKAHEAD_SAMPLES,
    MelStream,
    MunoIncrementalASR,
    MunoIncrementalConfig,
    preemphasis,
)
from aqr.adapters.muno_streaming import (
    BLANK_ID,
    CHUNK_MEL_FRAMES,
    HOP_LENGTH,
    MIN_CHUNK_MEL_FRAMES,
    VOCAB_SIZE,
)

RATE = 16000
N_FFT = 512
CHUNK_SAMPLES = CHUNK_MEL_FRAMES * HOP_LENGTH  # 17 920


def stub_mel(padded: np.ndarray) -> np.ndarray:
    """Mel factice (80, trames) d'une tranche déjà complétée : la moyenne de chaque fenêtre de 512
    échantillons, sans complétion (`center=False`), comme le vrai frontal."""
    frames = (len(padded) - N_FFT) // HOP_LENGTH + 1
    row = np.array(
        [padded[k * HOP_LENGTH : k * HOP_LENGTH + N_FFT].mean() for k in range(frames)],
        dtype=np.float32,
    )
    return np.tile(row, (80, 1))


def offline_features(raw: np.ndarray) -> np.ndarray:
    """Ce que fait l'adaptateur hors ligne : complétion par réflexion, puis toutes les trames."""
    emphasized = preemphasis(raw)
    padded = np.pad(emphasized, (N_FFT // 2, N_FFT // 2), mode="reflect")
    return stub_mel(padded)


def ramp(seconds: float, seed: int = 1) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.uniform(-0.5, 0.5, round(seconds * RATE)).astype(np.float32)


def collect(stream: MelStream, raw: np.ndarray, block: int) -> list[np.ndarray]:
    chunks: list[np.ndarray] = []
    for offset in range(0, len(raw), block):
        stream.push(raw[offset : offset + block])
        chunks.extend(stream.ready())
    chunks.extend(stream.flush())
    return chunks


# --------------------------------------------------------------------------- frontal mel
def test_preemphasis_matches_the_offline_filter() -> None:
    x = np.array([1.0, 2.0, 4.0], dtype=np.float32)
    assert preemphasis(x).tolist() == pytest.approx([1.0, 2.0 - 0.97, 4.0 - 1.94])


def test_the_chunks_equal_the_offline_features_whatever_the_block_size() -> None:
    raw = ramp(5.0)
    expected = offline_features(raw)
    for block in (RATE // 50, 1000, RATE, 3 * RATE):
        chunks = collect(MelStream(stub_mel), raw, block)
        got = np.concatenate([c[0] for c in chunks], axis=1)
        assert got.shape[1] >= expected.shape[1], block
        assert np.allclose(got[:, : expected.shape[1]], expected, atol=1e-6), block
        # les chunks complets font 112 trames ; seul le dernier peut être plus court
        assert [c.shape[2] for c in chunks[:-1]] == [CHUNK_MEL_FRAMES] * (len(chunks) - 1)


def test_a_shorter_chunk_gives_the_same_features_cut_differently() -> None:
    raw = ramp(3.0)
    expected = offline_features(raw)
    chunks = collect(MelStream(stub_mel, chunk_frames=56), raw, RATE // 10)
    assert [c.shape[2] for c in chunks[:-1]] == [56] * (len(chunks) - 1)
    got = np.concatenate([c[0] for c in chunks], axis=1)
    assert np.allclose(got[:, : expected.shape[1]], expected, atol=1e-6)


@pytest.mark.parametrize("frames", [9, 113, 0])
def test_a_chunk_size_the_model_cannot_take_is_refused(frames: int) -> None:
    with pytest.raises(ValueError):
        MunoIncrementalConfig(chunk_frames=frames)


def test_a_chunk_is_ready_only_when_its_last_window_is_complete() -> None:
    stream = MelStream(stub_mel)
    raw = ramp(3.0)
    stream.push(raw[: CHUNK_SAMPLES + LOOKAHEAD_SAMPLES - 1])
    assert list(stream.ready()) == []
    stream.push(raw[CHUNK_SAMPLES + LOOKAHEAD_SAMPLES - 1 : CHUNK_SAMPLES + LOOKAHEAD_SAMPLES])
    ready = list(stream.ready())
    assert len(ready) == 1 and ready[0].shape == (1, 80, CHUNK_MEL_FRAMES)


def test_the_buffer_does_not_grow_with_the_stream() -> None:
    stream = MelStream(stub_mel)
    raw = ramp(1.0)
    for _ in range(40):  # 40 s
        stream.push(raw)
        list(stream.ready())
    assert stream.buffered_samples < 4 * CHUNK_SAMPLES


def test_the_last_short_chunk_is_padded_to_what_the_model_accepts() -> None:
    raw = ramp(1.12 + 0.05)  # un chunk plein, puis 5 trames
    chunks = collect(MelStream(stub_mel), raw, RATE // 10)
    assert chunks[-1].shape[2] == MIN_CHUNK_MEL_FRAMES
    assert not chunks[-1][0, :, 6:].any()


def test_a_stream_too_short_for_the_model_gives_no_chunk() -> None:
    assert collect(MelStream(stub_mel), ramp(0.02), 100) == []


# --------------------------------------------------------------------------- session du modèle
class Tokenizer:
    pieces: ClassVar[dict[int, str]] = {1: "▁al", 2: "lah", 3: "▁rabb", 4: "▁nas"}

    def id_to_piece(self, token: int) -> str:
        return self.pieces[token]

    def decode(self, tokens: list[int]) -> str:
        return "".join(self.pieces[t].replace("▁", " ") for t in tokens).strip()


class FakeOnnx:
    """Rend, pour chaque morceau, 13 trames de sortie : `script[n]` = {trame: jeton} du n-ième
    morceau ; le reste est du blanc. Enregistre ce qu'on lui donne (caches compris)."""

    def __init__(self, script: dict[int, dict[int, int]], confidence: float = 0.9) -> None:
        self.script = script
        self.confidence = confidence
        self.calls: list[dict[str, Any]] = []

    def run(self, _outputs: Any, inputs: dict[str, Any]) -> tuple[Any, ...]:
        n = len(self.calls)
        self.calls.append({k: v for k, v in inputs.items()})
        rows = np.full((1, 13, VOCAB_SIZE), np.log(1e-6), dtype=np.float32)
        rows[0, :, BLANK_ID] = np.log(0.99)
        for frame, token in self.script.get(n, {}).items():
            rows[0, frame, BLANK_ID] = np.log(1e-6)
            rows[0, frame, token] = np.log(self.confidence)
        marker = np.full((1,), n + 1, dtype=np.int64)
        caches = (
            np.full((1, 17, 70, 512), n + 1, dtype=np.float32),
            np.full((1, 17, 512, 8), n + 1, dtype=np.float32),
            marker,
        )
        return (rows, np.asarray([13], dtype=np.int64), *caches)


def make_asr(
    script: dict[int, dict[int, int]], **config: Any
) -> tuple[MunoIncrementalASR, FakeOnnx]:
    onnx = FakeOnnx(script)
    cfg = MunoIncrementalConfig(**config)
    asr = MunoIncrementalASR(cfg, session=onnx, tokenizer=Tokenizer(), mel_fn=stub_mel)
    return asr, onnx


def feed_all(asr: MunoIncrementalASR, seconds: float, block: int = RATE // 10) -> Any:
    session = asr.open()
    raw = ramp(seconds)
    updates = [session.feed(raw[i : i + block]) for i in range(0, len(raw), block)]
    updates.append(session.finish())
    return session, updates


def test_the_model_caches_are_carried_from_one_chunk_to_the_next() -> None:
    asr, onnx = make_asr({})
    feed_all(asr, 4.0)
    assert len(onnx.calls) >= 3
    first = onnx.calls[0]
    assert not first["cache_last_channel"].any() and int(first["cache_last_channel_len"][0]) == 0
    for n in range(1, len(onnx.calls)):
        assert onnx.calls[n]["cache_last_channel"].flat[0] == n  # ce que le morceau n-1 a rendu
        assert onnx.calls[n]["cache_last_time"].flat[0] == n
        assert int(onnx.calls[n]["cache_last_channel_len"][0]) == n


def test_two_streams_do_not_share_their_caches() -> None:
    asr, onnx = make_asr({})
    first = asr.open()
    first.feed(ramp(2.0))
    calls_before = len(onnx.calls)
    second = asr.open()
    second.feed(ramp(2.0))
    assert not onnx.calls[calls_before]["cache_last_channel"].any()


def test_words_get_their_stream_time_from_the_chunk_and_the_frame() -> None:
    # chunk 0, trames 1 et 2 : « al lah » ; chunk 1, trame 4 : « rabb »
    asr, _ = make_asr({0: {1: 1, 2: 2}, 1: {4: 3}})
    _, updates = feed_all(asr, 4.0)
    words = [w for u in updates for w in u.stable]
    assert [w.word.text for w in words] == ["allah", "rabb"]
    first, second = words[0].word, words[1].word
    assert first.time.start_s == pytest.approx(0.08)  # chunk 0, trame 1
    assert first.time.end_s == pytest.approx(0.24)  # fin de la pièce de la trame 2
    assert second.time.start_s == pytest.approx(CHUNK_S + 4 * 0.08)
    assert first.confidence == pytest.approx(0.9, abs=1e-3)


def test_a_word_is_stable_only_once_the_next_one_starts_or_a_frame_has_passed() -> None:
    # « al » + « lah » en fin de chunk 0 (trames 11, 12) : sa fin touche la fin du chunk ; il
    # n'est livré qu'avec le chunk suivant, quand on sait qu'aucune pièce ne le prolonge
    asr, _ = make_asr({0: {11: 1, 12: 2}})
    session = asr.open()
    raw = ramp(4.0)
    early = session.feed(raw[: CHUNK_SAMPLES + LOOKAHEAD_SAMPLES])
    assert early.stable == ()
    assert early.partial is not None and early.partial.text == "allah"
    assert early.partial.start_s == pytest.approx(11 * 0.08)
    later = session.feed(raw[CHUNK_SAMPLES + LOOKAHEAD_SAMPLES :])
    assert [w.word.text for w in later.stable] == ["allah"]
    assert later.stable[0].arrival_s >= later.stable[0].word.time.end_s


def test_a_word_followed_by_another_is_stable_at_once() -> None:
    asr, _ = make_asr({0: {1: 1, 12: 3}})
    session = asr.open()
    update = session.feed(ramp(1.2))
    assert [w.word.text for w in update.stable] == ["al"]
    assert update.partial is not None and update.partial.text == "rabb"


def test_finish_makes_every_word_stable_and_drops_the_provisional_text() -> None:
    asr, _ = make_asr({0: {11: 1, 12: 2}})
    session = asr.open()
    session.feed(ramp(1.2))
    end = session.finish()
    assert [w.word.text for w in end.stable] == ["allah"]
    assert end.partial is None


def test_a_piece_that_continues_a_word_already_delivered_starts_a_new_one() -> None:
    # une pièce sans « ▁ » 3 trames après la fin du mot : le mot est déjà parti, la pièce ne peut
    # plus le prolonger ; elle ne doit ni être perdue en silence ni recoller un mot livré
    asr, _ = make_asr({0: {1: 1}, 1: {0: 2}}, settle_s=0.8)  # le défaut (1,5 s) recolle ces pièces
    _, updates = feed_all(asr, 4.0)
    assert [w.word.text for u in updates for w in u.stable] == ["al", "lah"]


def test_the_confidence_of_a_word_is_the_mean_of_its_pieces() -> None:
    onnx = FakeOnnx({0: {1: 1, 2: 2}}, confidence=0.8)
    asr = MunoIncrementalASR(
        MunoIncrementalConfig(), session=onnx, tokenizer=Tokenizer(), mel_fn=stub_mel
    )
    _, updates = feed_all(asr, 2.5)
    words = [w for u in updates for w in u.stable]
    assert words[0].word.confidence == pytest.approx(0.8, abs=1e-3)


def test_the_model_is_not_called_before_a_whole_chunk_is_computable() -> None:
    asr, onnx = make_asr({})
    session = asr.open()
    session.feed(ramp(0.3))
    assert onnx.calls == []
    assert session.finish().stable == ()


def test_the_update_reports_the_audio_received_and_the_audio_processed() -> None:
    asr, _ = make_asr({})
    session = asr.open()
    update = session.feed(ramp(1.0))
    assert update.received_s == pytest.approx(1.0)
    assert update.processed_s == 0.0  # aucun morceau complet encore
    update = session.feed(ramp(0.5))
    assert update.processed_s == pytest.approx(CHUNK_S)


def test_feeding_after_the_end_is_refused() -> None:
    asr, _ = make_asr({})
    session = asr.open()
    session.finish()
    with pytest.raises(ValueError):
        session.feed(ramp(0.1))


def test_the_engine_name_carries_the_model_and_the_provider() -> None:
    asr, _ = make_asr({})
    assert asr.engine.startswith("muno-fastconformer-quran-streaming@")
    assert "incremental" in asr.engine
