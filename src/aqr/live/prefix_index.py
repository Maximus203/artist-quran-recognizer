"""PrefixIndex : le Coran comme un flux de mots, indexé pour le suivi en direct (ADR-0011).

Même flux que le matcher (ADR-0004) : mots normalisés, basmala du verset 1 retirée. L'index répond
aux questions du suivi d'hypothèses : où commence et finit un verset, quels endroits du flux
ressemblent à un mot entendu (début de verset comme milieu de verset), quels versets sont des sosies
exacts, combien de mots départagent un début de verset. Domaine pur : aucune dépendance externe,
aucun texte produit (le texte affiché vient toujours du corpus, I1).
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Hashable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache

from aqr.domain.models import VerseRef
from aqr.domain.quran_structure import SURAH_WITHOUT_BASMALA
from aqr.matching.similarity import word_similarity

BASMALA_VERSE = VerseRef(1, 1)
"""1:1 est la basmala elle-même : le suivi la traite par son événement, jamais comme départ."""


@dataclass(frozen=True)
class Discrimination:
    """`needed` = plus petit préfixe unique (None si aucun) ; `blocker` dit pourquoi."""

    needed: int | None
    blocker: str | None = None  # "twin" (séquence identique) | "prefix_of_longer"


def common_prefix_length(a: Sequence[object], b: Sequence[object]) -> int:
    limit = min(len(a), len(b))
    i = 0
    while i < limit and a[i] == b[i]:
        i += 1
    return i


def discriminating_lengths(
    items: Iterable[tuple[Hashable, Sequence[object]]],
) -> dict[Hashable, Discrimination]:
    """Pour chaque élément, plus petit k tel qu'aucun AUTRE élément ne commence par ses k premiers
    symboles. Tri lexicographique : le plus long préfixe commun avec n'importe quel autre élément
    est atteint chez un voisin immédiat.

    Un élément dont un autre est identique (« twin ») ou dont il est le début strict
    (« prefix_of_longer ») n'a aucun préfixe unique : le début seul ne suffit jamais.
    """
    ordered = sorted(items, key=lambda item: item[1])  # type: ignore[arg-type, return-value]
    result: dict[Hashable, Discrimination] = {}
    for index, (key, sequence) in enumerate(ordered):
        best = 0
        twin = False
        for other in (index - 1, index + 1):
            if not 0 <= other < len(ordered):
                continue
            neighbour = ordered[other][1]
            best = max(best, common_prefix_length(sequence, neighbour))
            twin = twin or list(neighbour) == list(sequence)
        if best >= len(sequence):
            result[key] = Discrimination(None, "twin" if twin else "prefix_of_longer")
        else:
            result[key] = Discrimination(best + 1)
    return result


class PrefixIndex:
    """Flux de mots du Coran, positions globales 0..size-1, avec leur verset et leur rang de mot."""

    def __init__(
        self,
        flow: Mapping[VerseRef, Sequence[str]],
        *,
        basmala: Sequence[str] = (),
        word_threshold: float = 0.7,
    ) -> None:
        self._threshold = word_threshold
        self.basmala: tuple[str, ...] = tuple(basmala)
        self._tokens: list[str] = []
        self._where: list[tuple[VerseRef, int]] = []
        self._start: dict[VerseRef, int] = {}
        self._end: dict[VerseRef, int] = {}
        for verse in sorted(flow):
            words = tuple(flow[verse])
            if not words:
                raise ValueError(f"verset sans mot : {verse}")
            self._start[verse] = len(self._tokens)
            for rank, word in enumerate(words, start=1):
                self._tokens.append(word)
                self._where.append((verse, rank))
            self._end[verse] = len(self._tokens) - 1
        self._refs: tuple[VerseRef, ...] = tuple(self._start)
        by_token: dict[str, list[int]] = defaultdict(list)
        for position, token in enumerate(self._tokens):
            by_token[token].append(position)
        self._positions_of: dict[str, tuple[int, ...]] = {k: tuple(v) for k, v in by_token.items()}
        self._vocabulary_by_length: dict[int, list[str]] = defaultdict(list)
        for token in self._positions_of:
            self._vocabulary_by_length[len(token)].append(token)
        twins: dict[tuple[str, ...], list[VerseRef]] = defaultdict(list)
        for verse in self._refs:
            twins[tuple(self._tokens[self._start[verse] : self._end[verse] + 1])].append(verse)
        self._twins = {
            verse: tuple(other for other in group if other != verse)
            for group in twins.values()
            for verse in group
        }
        self._starts_by_surah: dict[int, list[int]] = defaultdict(list)
        for verse in self.refs:
            if verse != BASMALA_VERSE:
                self._starts_by_surah[verse.surah].append(self._start[verse])
        self._unique_prefix: dict[VerseRef, Discrimination] | None = None
        self._letter_bit: dict[str, int] = {}
        self._letters: dict[str, int] = {}
        self._similar = lru_cache(maxsize=1 << 16)(self._similar_positions)

    def restricted_to_surah(self, surah: int) -> PrefixIndex:
        """Le même flux de mots limité à UNE sourate (récitation guidée, ADR-0015) : le suivi ne
        peut plus nommer un verset d'ailleurs. Les mots, leur rang et leur verset sont ceux du
        flux entier ; seuls les positions globales sont renumérotées depuis 0."""
        verses = [verse for verse in self._refs if verse.surah == surah]
        if not verses:
            raise ValueError(f"sourate inconnue : {surah}")
        flow = {
            verse: tuple(self._tokens[self._start[verse] : self._end[verse] + 1])
            for verse in verses
        }
        return PrefixIndex(flow, basmala=self.basmala, word_threshold=self._threshold)

    # -- Forme du flux --------------------------------------------------------------------
    @property
    def size(self) -> int:
        return len(self._tokens)

    @property
    def vocabulary_size(self) -> int:
        return len(self._positions_of)

    @property
    def refs(self) -> tuple[VerseRef, ...]:
        return self._refs

    def token(self, position: int) -> str:
        return self._tokens[position]

    def verse_at(self, position: int) -> tuple[VerseRef, int]:
        """(verset, rang du mot à partir de 1) de la position `position` du flux."""
        return self._where[position]

    def start_of(self, verse: VerseRef) -> int:
        return self._start[verse]

    def end_of(self, verse: VerseRef) -> int:
        """Position du dernier mot du verset (incluse)."""
        return self._end[verse]

    def length(self, verse: VerseRef) -> int:
        return self._end[verse] - self._start[verse] + 1

    def next_start(self, verse: VerseRef) -> int | None:
        """Position du premier mot du verset suivant dans le Mushaf, None s'il n'existe pas ici."""
        following = verse.next()
        return self._start.get(following) if following is not None else None

    # -- Départs possibles ----------------------------------------------------------------
    def is_basmala_position(self, position: int) -> bool:
        """Mot de 1:1, la basmala : jamais un départ de passage."""
        return self._where[position][0] == BASMALA_VERSE

    def is_verse_start(self, position: int) -> bool:
        return self._where[position][1] == 1

    @property
    def mid_verse_count(self) -> int:
        """Positions d'où un passage peut démarrer en milieu de verset."""
        basmala = self.length(BASMALA_VERSE) if BASMALA_VERSE in self._start else 0
        return self.size - len(self.verse_starts) - basmala

    @property
    def verse_starts(self) -> tuple[int, ...]:
        """Débuts de verset d'où un suivi peut démarrer (tous sauf 1:1, la basmala)."""
        return tuple(self._start[v] for v in self._refs if v != BASMALA_VERSE)

    def starts_of_surah(self, surah: int) -> tuple[int, ...]:
        return tuple(self._starts_by_surah.get(surah, ()))

    @property
    def after_basmala_starts(self) -> tuple[int, ...]:
        """Après une basmala : premier verset de chaque sourate (hors 1 et 9) et 1:2."""
        first_verses = [
            self._start[v]
            for v in self._refs
            if v.ayah == 1 and v.surah not in (BASMALA_VERSE.surah, SURAH_WITHOUT_BASMALA)
        ]
        fatiha = VerseRef(1, 2)
        if fatiha in self._start:
            first_verses.append(self._start[fatiha])
        return tuple(sorted(first_verses))

    # -- Ressemblance ------------------------------------------------------------------------
    def similar_positions(self, word: str) -> Mapping[int, float]:
        """{position du flux: similarité} pour chaque mot du flux assez proche de `word`."""
        return self._similar(word)

    def _mask(self, word: str) -> int:
        mask = 0
        for letter in word:
            bit = self._letter_bit.get(letter)
            if bit is None:
                bit = self._letter_bit[letter] = 1 << len(self._letter_bit)
            mask |= bit
        return mask

    def _similar_positions(self, word: str) -> dict[int, float]:
        found: dict[int, float] = {}
        # un mot de longueur m n'est jamais proche si |m - L| > (1 - seuil) x max(m, L)
        shortest = max(1, math.ceil(self._threshold * len(word) - 1e-9))
        longest = math.floor(len(word) / self._threshold + 1e-9)
        word_mask = self._mask(word)

        def allowed_for(a: str, b: str) -> int:
            return int((1 - self._threshold) * max(len(a), len(b)) + 1e-9)

        for length in range(shortest, longest + 1):
            for token in self._vocabulary_by_length.get(length, ()):
                # filtre exact : chaque lettre de `word` absente de `token` (et inversement) coûte
                # au moins une modification
                mask = self._letters.get(token)
                if mask is None:
                    mask = self._letters[token] = self._mask(token)
                if (word_mask & ~mask).bit_count() > allowed_for(word, token):
                    continue
                if (mask & ~word_mask).bit_count() > allowed_for(word, token):
                    continue
                similarity = word_similarity(word, token, self._threshold)
                if similarity > 0:
                    for position in self._positions_of[token]:
                        found[position] = similarity
        return found

    # -- Sosies et préfixes uniques ----------------------------------------------------------
    def twins(self, verse: VerseRef) -> tuple[VerseRef, ...]:
        """Autres versets au texte normalisé strictement identique."""
        return self._twins.get(verse, ())

    def unique_prefix_words(self, verse: VerseRef) -> int | None:
        """Plus petit nombre de mots de début qui distingue ce verset de tous les autres, sinon None
        (sosie exact, ou verset qui n'est que le début d'un plus long)."""
        if self._unique_prefix is None:
            computed = discriminating_lengths(
                (v, self._tokens[self._start[v] : self._end[v] + 1]) for v in self._refs
            )
            self._unique_prefix = {v: computed[v] for v in self._refs}
        return self._unique_prefix[verse].needed
