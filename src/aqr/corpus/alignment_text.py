"""Texte d'ALIGNEMENT acoustique (ADR-0006) : graphie imla'i, rattachée aux mots Uthmani.

L'ASR CTC a appris l'orthographe imla'i (« يا أيها », voyelles présentes dans la plupart de ses
sorties, absentes dans les autres), pas la graphie du Mushaf (« يَـٰٓأَيُّهَا »). Aligner le texte
Uthmani sur son treillis le pénaliserait sur des différences d'écriture qui ne sont pas de la
prononciation. On aligne donc la graphie Tanzil `simple` (avec voyelles) ou `simple-clean` (sans),
mais toute plage reste exprimée en indices de mots **Uthmani** (`WordSpan`,
`CorpusRepository.words`) :
chaque mot imla'i porte l'indice du mot Uthmani qu'il prononce. Ce texte n'est jamais rendu (I1).

Le rattachement est positionnel quand les deux découpages ont le même nombre de mots (5 873 versets
sur 6 236) ; sinon (« يَـٰٓأَيُّهَا » = « يا أيها », « يَبْنَؤُمَّ » = « يا ابن أم ») il suit un
alignement des lettres normalisées, monotone, sans règle d'orthographe écrite à la main.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from difflib import SequenceMatcher
from enum import StrEnum
from pathlib import Path
from typing import Final

from aqr.corpus.checksums import CorpusLock
from aqr.corpus.normalize import normalize_arabic
from aqr.corpus.tanzil_format import parse_tanzil_txt
from aqr.domain.models import VerseRef, WordSpan
from aqr.domain.ports import CorpusRepository
from aqr.domain.quran_structure import BASMALA_WORD_COUNT, verse_one_includes_basmala


class AlignmentVariant(StrEnum):
    VOCALIZED = "simple"
    """Imla'i avec voyelles : la graphie de la plupart des sorties de l'ASR."""
    BARE = "simple_clean"
    """Imla'i sans voyelles : quand l'ASR n'en produit pas (basmala, versets courts)."""


# Clé du fichier dans `data/corpus/LOCK.json` pour chaque variante.
_LOCK_KEYS: Final[dict[AlignmentVariant, str]] = {
    AlignmentVariant.VOCALIZED: "simple",
    AlignmentVariant.BARE: "simple_clean",
}


@dataclass(frozen=True)
class AlignmentWord:
    """Un mot imla'i à aligner, rattaché au mot Uthmani `word` (indice à partir de 1)."""

    word: int
    text: str


def _letters(words: tuple[str, ...]) -> tuple[str, list[int]]:
    """Lettres normalisées, sans espaces, et l'indice (à partir de 0) du mot de chaque lettre."""
    chars: list[str] = []
    owners: list[int] = []
    for index, word in enumerate(words):
        for char in normalize_arabic(word).replace(" ", ""):
            chars.append(char)
            owners.append(index)
    return "".join(chars), owners


def map_to_uthmani(uthmani: tuple[str, ...], imlai: tuple[str, ...]) -> tuple[int, ...]:
    """Indice Uthmani (à partir de 1) de chaque mot imla'i ; monotone, couvre tous les mots."""
    if not uthmani or not imlai:
        raise ValueError("verset sans mot à rattacher")
    if len(uthmani) == len(imlai):
        return tuple(range(1, len(imlai) + 1))
    u_chars, u_owner = _letters(uthmani)
    s_chars, s_owner = _letters(imlai)
    votes: list[Counter[int]] = [Counter() for _ in imlai]
    matcher = SequenceMatcher(None, u_chars, s_chars, autojunk=False)
    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            votes[s_owner[block.b + offset]][u_owner[block.a + offset]] += 1
    mapped: list[int] = []
    previous = 0
    for counter in votes:
        best = min(counter, key=lambda k: (-counter[k], k)) if counter else previous
        previous = max(previous, best)
        mapped.append(previous)
    # Un mot Uthmani laissé sans mot imla'i (graphies trop éloignées) reçoit le mot imla'i suivant
    # resté sur l'indice précédent : la couverture est une propriété exigée, pas une heuristique.
    for target in range(len(uthmani)):
        if target in mapped:
            continue
        for position, value in enumerate(mapped):
            if value > target:
                if position > 0 and mapped[position - 1] < target:
                    mapped[position - 1] = target
                break
    return tuple(index + 1 for index in mapped)


def recited_span(ref: VerseRef, word_count: int) -> WordSpan:
    """Plage récitée d'un verset entier : sans la basmala que Tanzil concatène au verset 1 des
    sourates (sauf Al-Fatiha, où elle EST le verset 1:1, et At-Tawbah, qui n'en a pas)."""
    if ref.ayah == 1 and ref.surah != 1 and verse_one_includes_basmala(ref.surah):
        return WordSpan(ref, BASMALA_WORD_COUNT + 1, word_count)
    return WordSpan(ref, 1, word_count)


class AlignmentTexts:
    """Mots imla'i d'une plage Uthmani, pour chaque variante de graphie."""

    def __init__(
        self,
        uthmani: dict[VerseRef, tuple[str, ...]],
        imlai: dict[AlignmentVariant, dict[VerseRef, tuple[str, ...]]],
    ) -> None:
        self._uthmani = uthmani
        self._imlai = imlai
        self._mapping: dict[VerseRef, tuple[int, ...]] = {}

    @classmethod
    def from_corpus_dir(cls, corpus_dir: Path, corpus: CorpusRepository) -> AlignmentTexts:
        """Lit les fichiers épinglés (`LOCK.json` vérifié par l'appelant via le corpus)."""
        lock = CorpusLock.load(corpus_dir / "LOCK.json")
        imlai: dict[AlignmentVariant, dict[VerseRef, tuple[str, ...]]] = {}
        for variant, key in _LOCK_KEYS.items():
            if key not in lock.files:
                raise KeyError(
                    f"fichier « {key} » absent de {corpus_dir / 'LOCK.json'} : relancer "
                    "`python scripts/fetch_corpus.py`"
                )
            raw = (corpus_dir / lock.files[key].path).read_text(encoding="utf-8")
            imlai[variant] = {
                ref: tuple(w for w in text.split() if normalize_arabic(w))
                for ref, text in parse_tanzil_txt(raw).items()
            }
        uthmani = {ref: corpus.words(ref) for ref in corpus.all_refs()}
        return cls(uthmani, imlai)

    def word_count(self, ref: VerseRef) -> int:
        return len(self._uthmani[ref])

    def words(self, span: WordSpan, variant: AlignmentVariant) -> tuple[AlignmentWord, ...]:
        uthmani = self._uthmani[span.ref]
        if span.last_word > len(uthmani):
            raise ValueError(
                f"{span.ref} n'a que {len(uthmani)} mots "
                f"(plage {span.first_word}..{span.last_word})"
            )
        imlai = self._imlai[variant][span.ref]
        mapping = self._mapping.get(span.ref)
        if mapping is None:
            # Le découpage en mots est le même pour les deux variantes (vérifié sur le corpus) :
            # le rattachement se calcule sur la variante sans voyelles, une fois par verset.
            bare = self._imlai.get(AlignmentVariant.BARE, self._imlai[variant])[span.ref]
            mapping = map_to_uthmani(uthmani, bare)
            self._mapping[span.ref] = mapping
        if len(imlai) != len(mapping):
            raise ValueError(f"{span.ref} : découpages imla'i différents selon la variante")
        return tuple(
            AlignmentWord(word, text)
            for word, text in zip(mapping, imlai, strict=True)
            if span.first_word <= word <= span.last_word
        )
