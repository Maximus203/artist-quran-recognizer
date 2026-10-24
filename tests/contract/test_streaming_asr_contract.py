"""Contrat du port `StreamingAsr` (ADR-0011, étape 2) : fake (rapide) ET Muno incrémental (`slow`).

Un ASR incrémental consomme l'audio par blocs, garde son état d'un bloc à l'autre et livre des mots
STABILISÉS (jamais repris) plus, à part, une transcription provisoire.
"""

from __future__ import annotations

from array import array
from collections.abc import Sequence

import pytest
from tests.support.real import everyayah_clip, models_dir, silence, tone_clip
from tests.support.streaming_fakes import FakeStreamingASR

from aqr.domain.models import Riwaya
from aqr.domain.ports import AsrUpdate, AudioClip, StableWord, StreamingAsr

RATE = 16000
SCRIPT = [("alif", 0.3, 0.7), ("ba", 0.9, 1.3), ("jim", 1.6, 2.0), ("dal", 2.4, 2.9)]


def _muno() -> StreamingAsr:
    from tests.support.real import LOCK_PATH

    from aqr.adapters.muno_incremental import MunoIncrementalASR, MunoIncrementalConfig

    return MunoIncrementalASR(MunoIncrementalConfig(models_dir=models_dir(), lock_path=LOCK_PATH))


@pytest.fixture(
    params=[
        pytest.param("fake", id="fake"),
        pytest.param("muno", id="muno-incremental", marks=pytest.mark.slow),
    ],
    scope="module",
)
def setup(request: pytest.FixtureRequest) -> tuple[StreamingAsr, AudioClip]:
    if request.param == "fake":
        return FakeStreamingASR(SCRIPT), tone_clip(3.2)
    return _muno(), everyayah_clip("Alafasy_128kbps", "112001.mp3")


def _blocks(samples: Sequence[float], size: int) -> list[Sequence[float]]:
    return [samples[i : i + size] for i in range(0, len(samples), size)]


def _run(asr: StreamingAsr, samples: Sequence[float], block: int) -> tuple[list[StableWord], int]:
    session = asr.open()
    words: list[StableWord] = []
    partials = 0
    for part in _blocks(samples, block):
        update = session.feed(part)
        words.extend(update.stable)
        partials += update.partial is not None
    words.extend(session.finish().stable)
    return words, partials


def _shape(words: Sequence[StableWord]) -> list[tuple[str, float, float]]:
    return [
        (w.word.text, round(w.word.time.start_s, 6), round(w.word.time.end_s, 6)) for w in words
    ]


def test_declarations(setup: tuple[StreamingAsr, AudioClip]) -> None:
    asr, _clip = setup
    assert asr.riwaya is Riwaya.HAFS
    assert asr.sample_rate == RATE
    assert asr.engine


def test_words_are_well_formed(setup: tuple[StreamingAsr, AudioClip]) -> None:
    asr, clip = setup
    words, _ = _run(asr, clip.samples, RATE // 10)
    assert words, "un clip parlé doit produire des mots"
    duration = len(clip.samples) / RATE
    for item in words:
        word = item.word
        assert word.text.strip()
        assert 0.0 <= word.time.start_s < word.time.end_s <= duration + 1e-6
        assert 0.0 <= word.confidence <= 1.0
        # un mot ne peut pas être livré avant d'avoir été dit
        assert item.arrival_s >= word.time.end_s - 1e-6
    starts = [w.word.time.start_s for w in words]
    assert starts == sorted(starts)
    arrivals = [w.arrival_s for w in words]
    assert arrivals == sorted(arrivals)


def test_the_block_size_does_not_change_the_words(setup: tuple[StreamingAsr, AudioClip]) -> None:
    asr, clip = setup
    reference, _ = _run(asr, clip.samples, RATE)
    for block in (RATE // 50, RATE // 10, 7919, 3 * RATE):
        assert _shape(_run(asr, clip.samples, block)[0]) == _shape(reference), block


def test_a_stable_word_is_never_taken_back(setup: tuple[StreamingAsr, AudioClip]) -> None:
    asr, clip = setup
    half = len(clip.samples) // 2
    session = asr.open()
    early: list[StableWord] = []
    for part in _blocks(clip.samples[:half], RATE // 10):
        early.extend(session.feed(part).stable)
    later = list(early)
    for part in _blocks(clip.samples[half:], RATE // 10):
        later.extend(session.feed(part).stable)
    later.extend(session.finish().stable)
    # ce qui était stable à mi-flux reste, tel quel, le début de ce qui l'est à la fin
    assert _shape(later)[: len(early)] == _shape(early)


def test_a_silence_gives_no_word(setup: tuple[StreamingAsr, AudioClip]) -> None:
    asr, _clip = setup
    quiet = silence(3.0)
    words, partials = _run(asr, quiet.samples, RATE // 10)
    assert words == [] and partials == 0


def test_sessions_are_independent(setup: tuple[StreamingAsr, AudioClip]) -> None:
    asr, clip = setup
    first = asr.open()
    second = asr.open()
    first.feed(clip.samples[:RATE])
    # la seconde session n'a rien reçu : l'état du flux n'est pas partagé
    assert second.received_s == 0.0
    words_second: list[StableWord] = []
    for part in _blocks(clip.samples, RATE // 10):
        words_second.extend(second.feed(part).stable)
    words_second.extend(second.finish().stable)
    assert _shape(words_second) == _shape(_run(asr, clip.samples, RATE // 10)[0])


def test_received_seconds_follow_the_samples(setup: tuple[StreamingAsr, AudioClip]) -> None:
    asr, clip = setup
    session = asr.open()
    update = session.feed(clip.samples[: RATE // 2])
    assert session.received_s == pytest.approx(0.5)
    assert update.received_s == pytest.approx(0.5)
    assert 0.0 <= update.processed_s <= update.received_s + 1e-9
    assert session.feed([]).received_s == pytest.approx(0.5)


def test_finish_is_final(setup: tuple[StreamingAsr, AudioClip]) -> None:
    asr, clip = setup
    session = asr.open()
    session.feed(clip.samples)
    first = session.finish()
    assert isinstance(first, AsrUpdate)
    assert session.finish().stable == ()
    with pytest.raises(ValueError):
        session.feed(clip.samples[:100])


def test_the_provisional_text_is_not_a_stable_word(setup: tuple[StreamingAsr, AudioClip]) -> None:
    asr, clip = setup
    session = asr.open()
    for part in _blocks(clip.samples, RATE // 10):
        update = session.feed(part)
        if update.partial is not None:
            assert update.partial.text.strip()
            assert update.partial.start_s < update.partial.end_s
    assert session.finish().partial is None


def test_a_block_can_be_an_array_of_floats(
    setup: tuple[StreamingAsr, AudioClip],
) -> None:
    asr, clip = setup
    samples = array("f", clip.samples[:RATE])
    assert asr.open().feed(samples).received_s == pytest.approx(1.0)
