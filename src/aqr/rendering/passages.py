"""Passages du Mushaf : mots et signes de pause d'une plage, lus dans le corpus (I1).

`HomeRenderer.span_text` rend déjà « le texte exact de la plage » ; ce module en donne la version
mot par mot (karaoké, coupe d'un long verset) et la comparaison de deux candidats (lettres ou
signe de pause), sans jamais fabriquer de texte arabe : tout vient du `CorpusRepository`.
"""

from __future__ import annotations

from typing import Final

from aqr.corpus.normalize import normalize_arabic
from aqr.domain.models import VerseRef
from aqr.domain.ports import CorpusRepository
from aqr.domain.quran_structure import BASMALA_WORD_COUNT, SURAH_WITHOUT_BASMALA

PAUSE_SIGNS: Final = frozenset({chr(c) for c in range(0x06D6, 0x06DD)} | {"۞", "۩"})
"""Signes de pause (waqf U+06D6 à U+06DC), de début de hizb et de sajda : ils ne sont pas des mots
(`TanzilCorpusRepository.words` les exclut) mais font partie du texte du Mushaf."""


class Passages:
    def __init__(self, corpus: CorpusRepository) -> None:
        self._corpus = corpus

    def word_count(self, ref: VerseRef) -> int:
        return len(self._corpus.words(ref))

    def first_content_word(self, ref: VerseRef) -> int:
        """Premier mot du verset hors basmala : la convention Tanzil la concatène au verset 1 de
        chaque sourate (sauf 1 et 9), où elle est une zone à part pour le moteur."""
        if ref.ayah == 1 and ref.surah not in (1, SURAH_WITHOUT_BASMALA):
            return BASMALA_WORD_COUNT + 1
        return 1

    def words_with_signs(self, ref: VerseRef, first: int, last: int) -> list[str]:
        """Les mots `first`..`last` (bornes incluses, à partir de 1), chacun suivi des signes de
        pause qui le suivent dans le Mushaf ; jamais plus de mots que le verset n'en a."""
        out: list[str] = []
        seen = 0
        for token in self._corpus.text(ref).split():
            if normalize_arabic(token):
                seen += 1
                if first <= seen <= last:
                    out.append(token)
            elif out and first <= seen <= last:
                out[-1] = f"{out[-1]} {token}"
        return out

    def text(self, ref: VerseRef, first: int, last: int) -> str:
        return " ".join(self.words_with_signs(ref, first, last))

    @staticmethod
    def without_signs(text: str) -> str:
        """Le texte sans signes de pause : ce qui reste, ce sont les lettres et leurs voyelles."""
        return " ".join("".join(ch for ch in text if ch not in PAUSE_SIGNS).split())

    def compare(self, a: str, b: str) -> str:
        """`same` (octet pour octet), `sign` (seuls les signes de pause diffèrent) ou `letters`."""
        if a == b:
            return "same"
        return "sign" if self.without_signs(a) == self.without_signs(b) else "letters"

    def clip(self, ref: VerseRef, first: int, last: int) -> tuple[int, int] | None:
        """La plage ramenée aux mots que le verset a vraiment ; None si elle n'en laisse aucun."""
        total = self.word_count(ref)
        if first > total:
            return None
        return (first, min(last, total))
