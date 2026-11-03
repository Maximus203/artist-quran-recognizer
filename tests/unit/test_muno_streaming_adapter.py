from __future__ import annotations

from typing import ClassVar

import pytest

from aqr.domain.models import TimeSpan


class _Tokenizer:
    pieces: ClassVar[dict[int, str]] = {1: "▁al", 2: "lah", 3: "▁rabb"}

    def id_to_piece(self, token: int) -> str:
        return self.pieces[token]

    def decode(self, tokens: list[int]) -> str:
        return "".join(self.pieces[token].replace("▁", " ") for token in tokens).strip()


def test_ctc_tokens_form_word_timestamps_relative_to_window() -> None:
    from aqr.adapters.muno_streaming import words_from_tokens

    words = words_from_tokens(
        [(1, 0, 0.9), (2, 2, 0.8), (3, 5, 0.7)],
        _Tokenizer(),
        TimeSpan(4.0, 8.0),
        frame_duration_s=0.08,
    )

    assert [word.text for word in words] == ["allah", "rabb"]
    assert words[0].time.start_s == 4.0
    assert words[0].time.end_s == 4.24
    assert words[1].time.start_s == 4.4
    assert words[1].time.end_s == 4.48
    assert [word.confidence for word in words] == pytest.approx([0.85, 0.7])


def test_empty_ctc_output_stays_empty() -> None:
    from aqr.adapters.muno_streaming import words_from_tokens

    assert words_from_tokens([], _Tokenizer(), TimeSpan(0.0, 1.0), 0.08) == ()


def test_a_short_last_chunk_is_padded_to_what_the_model_accepts() -> None:
    """Le modèle ONNX refuse un morceau de moins de 10 trames mel (sous-échantillonnage x8 → 0
    trame) : vu sur lot1-01, la cascade s'arrêtait net sur une fenêtre dont le dernier morceau
    faisait quelques trames. Le dernier morceau est complété par des trames neutres."""
    import numpy as np

    from aqr.adapters.muno_streaming import CHUNK_MEL_FRAMES, MIN_CHUNK_MEL_FRAMES, mel_chunks

    features = np.ones((80, CHUNK_MEL_FRAMES + 3), dtype=np.float32)
    chunks = list(mel_chunks(features))

    assert [c.shape for c in chunks] == [(1, 80, CHUNK_MEL_FRAMES), (1, 80, MIN_CHUNK_MEL_FRAMES)]
    assert chunks[1][0, :, :3].tolist() == features[:, -3:].tolist()
    assert not chunks[1][0, :, 3:].any()


def test_full_chunks_are_left_untouched() -> None:
    import numpy as np

    from aqr.adapters.muno_streaming import CHUNK_MEL_FRAMES, mel_chunks

    features = np.ones((80, 2 * CHUNK_MEL_FRAMES + 20), dtype=np.float32)
    assert [c.shape[2] for c in mel_chunks(features)] == [CHUNK_MEL_FRAMES, CHUNK_MEL_FRAMES, 20]
