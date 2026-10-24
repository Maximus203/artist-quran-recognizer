"""L'ASR incrémental rend les mêmes mots que l'adaptateur hors ligne sur le vrai modèle (`slow`).

C'est la preuve que garder les caches d'un bloc à l'autre et calculer les trames mel au fil de
l'eau ne change pas ce que le modèle entend. Les temps hors ligne sont ramenés à l'axe réel de
l'audio (`aqr.live.replay.restore_stream_times`).
"""

from __future__ import annotations

import pytest
from tests.support.real import everyayah_clip, models_dir

from aqr.domain.models import TimeSpan
from aqr.live.replay import restore_stream_times

pytestmark = pytest.mark.slow

CLIPS = (
    ("Alafasy_128kbps", "112001.mp3"),
    ("Husary_128kbps", "067001.mp3"),
    ("Abdul_Basit_Murattal_192kbps", "067010.mp3"),
)


def _offline(clip):  # type: ignore[no-untyped-def]
    from tests.support.real import LOCK_PATH

    from aqr.adapters.muno_streaming import MunoStreamingConfig, MunoStreamingQuranASR

    asr = MunoStreamingQuranASR(MunoStreamingConfig(models_dir=models_dir(), lock_path=LOCK_PATH))
    span = TimeSpan(0.0, len(clip.samples) / clip.sample_rate)
    return restore_stream_times(asr.transcribe(clip, span).words)


def _incremental(clip, block: int):  # type: ignore[no-untyped-def]
    from tests.support.real import LOCK_PATH

    from aqr.adapters.muno_incremental import MunoIncrementalASR, MunoIncrementalConfig

    asr = MunoIncrementalASR(MunoIncrementalConfig(models_dir=models_dir(), lock_path=LOCK_PATH))
    session = asr.open()
    words = []
    for i in range(0, len(clip.samples), block):
        words.extend(session.feed(clip.samples[i : i + block]).stable)
    words.extend(session.finish().stable)
    return [w.word for w in words]


@pytest.mark.parametrize(("reciter", "name"), CLIPS)
def test_same_words_and_times_as_the_offline_adapter(reciter: str, name: str) -> None:
    clip = everyayah_clip(reciter, name)
    offline = _offline(clip)
    incremental = _incremental(clip, 1600)
    assert [w.text for w in incremental] == [w.text for w in offline]
    for got, want in zip(incremental, offline, strict=True):
        assert got.time.start_s == pytest.approx(want.time.start_s, abs=0.01)
        assert got.time.end_s == pytest.approx(want.time.end_s, abs=0.09)
        assert got.confidence == pytest.approx(want.confidence, abs=0.02)
