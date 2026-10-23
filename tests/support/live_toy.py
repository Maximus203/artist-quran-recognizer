"""Corpus jouet pour tester le suivi en direct (ADR-0011) sans le vrai corpus.

Un verset de remplissage de 5 000 mots distincts élargit le vocabulaire : « mot sans rapport »
doit être réellement improbable, comme dans le Coran (environ 14 000 mots distincts).
"""

from __future__ import annotations

import random

from aqr.domain.models import VerseRef
from aqr.domain.ports import HeardWord
from aqr.live.prefix_index import PrefixIndex

BASMALA = ("bs1", "bs2", "bs3", "bs4")


def ref(text: str) -> VerseRef:
    return VerseRef.parse(text)


def _filler() -> tuple[str, ...]:
    rng = random.Random(3)
    letters = "klmnpqrstvwxyz"
    return tuple("".join(rng.choice(letters) for _ in range(7)) for _ in range(5000))


def toy_flow() -> dict[VerseRef, tuple[str, ...]]:
    return {
        ref("1:2"): ("1a", "1b", "1c", "1d"),
        ref("2:1"): ("pa", "qa", "ra"),
        ref("2:2"): ("sa", "ta", "ua", "va"),
        ref("2:3"): ("sa", "ta", "ua", "wa"),  # partage 3 mots avec 2:2
        ref("112:1"): ("aa", "bb", "cc", "dd"),
        ref("112:2"): ("ee", "ff"),
        ref("112:3"): ("gg", "hh", "ii"),
        ref("112:4"): ("jj", "kk", "ll", "mm"),
        ref("113:1"): ("aa", "bb", "xx", "yy", "zz"),
        ref("113:2"): ("nn", "oo", "pp", "qq"),
        ref("113:3"): ("rr", "ss", "tt"),
        ref("113:4"): ("uu", "vv", "ww"),
        ref("113:5"): ("aa", "bb", "cc", "dd"),  # sosie exact de 112:1
        ref("114:1"): ("wx", "bs1", "bs2", "bs3", "bs4"),  # finit par la phrase de la basmala
        ref("114:2"): ("m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"),
        ref("114:6"): _filler(),
        # la sourate 2 est longue : la masse « même sourate » se répartit sur beaucoup de versets
        **{ref(f"2:{k}"): (f"v{k:02d}x",) for k in range(4, 41)},
    }


def toy_index() -> PrefixIndex:
    return PrefixIndex(toy_flow(), basmala=BASMALA)


class Clock:
    """Fabrique des mots entendus à cadence régulière ; le temps du flux avance seul."""

    def __init__(self, step: float = 0.5) -> None:
        self.now = 0.0
        self.step = step

    def say(self, text: str) -> list[HeardWord]:
        words = []
        for token in text.split():
            words.append(
                HeardWord(
                    text=token,
                    start_s=self.now,
                    end_s=self.now + self.step,
                    arrival_s=self.now + self.step,
                )
            )
            self.now += self.step
        return words
