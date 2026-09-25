"""Structure du Mushaf (comptage kufi, Hafs) — nombre de versets par sourate.

Donnée structurelle, pas de texte : le texte vient toujours du CorpusRepository (invariant I1).
"""

from typing import Final

# fmt: off
AYAH_COUNTS: Final[tuple[int, ...]] = (
    7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135,
    112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85,
    54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13,
    14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42,
    29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11,
    11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6,
)
# fmt: on

SURAH_COUNT: Final[int] = 114
TOTAL_AYAHS: Final[int] = 6236


def ayah_count(surah: int) -> int:
    if not 1 <= surah <= SURAH_COUNT:
        raise ValueError(f"sourate hors bornes : {surah}")
    return AYAH_COUNTS[surah - 1]
