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
