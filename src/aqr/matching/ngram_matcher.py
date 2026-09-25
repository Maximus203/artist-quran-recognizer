"""VerseMatcher (port B6) : recherche lexicale à deux niveaux (ADR-0003).

Niveau 1 — n-grammes de *caractères* sur le texte squeletté sans espaces :
tolérant au bruit lettre par lettre, et insensible aux frontières de mot (absorbe
le « يا » vocatif fusionné au mot suivant en Uthmani mais séparé en imla'i, cf.
.artist/decision-log.md du 2026-09-25).
Niveau 2 — n-grammes de *mots* corrigés (dictionnaire appris depuis le corpus,
`aqr.corpus.imlai_corrections`) : plus précis, complète le niveau 1.
Les deux niveaux alimentent le même réalignement fin (`difflib`) pour le score
final et le `WordSpan`.

Indexe les mots tels que retournés par `CorpusRepository.words()` (tokenisation
Uthmani) — jamais une source de mots séparée, pour garder les `WordSpan` cohérents
avec le rendu (invariant I1).

Pas de seuil de rejet codé en dur ici (cf. CLAUDE.md) : l'absence de recouvrement
suffit à ne renvoyer aucun candidat pour un texte sans lien avec le Coran (F3/F4).
Le seuil de confiance final (I3, « porte de confiance ») est une décision de la
brique appelante (B5/B7), configurée, pas de ce matcher.
"""

from __future__ import annotations

import difflib
from collections import Counter

from aqr.corpus.normalize import normalize_arabic
from aqr.domain.models import VerseRef, WordSpan
from aqr.domain.ports import Candidate, CorpusRepository

_WORD_NGRAM_SIZE = 3
_CHAR_NGRAM_SIZE = 5
_MAX_CANDIDATES_REFINED = 50


class NgramVerseMatcher:
    def __init__(
        self,
        corpus: CorpusRepository,
        word_corrections: dict[str, str] | None = None,
    ) -> None:
        self._corrections = word_corrections or {}
        self._verse_tokens: dict[VerseRef, tuple[str, ...]] = {}
        self._word_index: dict[tuple[str, ...], list[tuple[VerseRef, int]]] = {}
        self._char_index: dict[str, set[VerseRef]] = {}
        for ref in corpus.all_refs():
            tokens = tuple(self._skeleton(w) for w in corpus.words(ref))
            self._verse_tokens[ref] = tokens
            self._index_words(ref, tokens)
            self._index_chars(ref, "".join(tokens))

    def _skeleton(self, word: str) -> str:
        normalized = normalize_arabic(word)
        return self._corrections.get(normalized, normalized)

    def _index_words(self, ref: VerseRef, tokens: tuple[str, ...]) -> None:
        n = len(tokens)
        if n >= _WORD_NGRAM_SIZE:
            for start in range(n - _WORD_NGRAM_SIZE + 1):
                key = tokens[start : start + _WORD_NGRAM_SIZE]
                self._word_index.setdefault(key, []).append((ref, start))
        elif n > 0:
            # Verset plus court que _WORD_NGRAM_SIZE (ex. 55:64, un seul mot) : indexé
            # tel quel pour rester trouvable — clés très peu nombreuses, très sélectives.
            self._word_index.setdefault(tokens, []).append((ref, 0))

    def _index_chars(self, ref: VerseRef, compact_text: str) -> None:
        n = len(compact_text)
        if n < _CHAR_NGRAM_SIZE:
            if n > 0:
                self._char_index.setdefault(compact_text, set()).add(ref)
            return
        for start in range(n - _CHAR_NGRAM_SIZE + 1):
            key = compact_text[start : start + _CHAR_NGRAM_SIZE]
            self._char_index.setdefault(key, set()).add(ref)

    def match(self, normalized_text: str, top_k: int = 5) -> list[Candidate]:
        raw_tokens = tuple(t for t in normalized_text.split(" ") if t)
        query_tokens = tuple(self._corrections.get(t, t) for t in raw_tokens)
        if not query_tokens:
            return []

        hits: Counter[VerseRef] = Counter()
        for key in self._query_word_keys(query_tokens):
            for ref, _start in self._word_index.get(key, ()):
                hits[ref] += 1
        for ref in self._query_char_refs(query_tokens):
            hits[ref] += 1

        candidates: list[Candidate] = []
        for ref, _count in hits.most_common(_MAX_CANDIDATES_REFINED):
            candidate = self._refine(ref, query_tokens)
            if candidate is not None:
                candidates.append(candidate)

        candidates.sort(key=lambda c: c.score, reverse=True)
        return candidates[:top_k]

    def _query_word_keys(self, query_tokens: tuple[str, ...]) -> list[tuple[str, ...]]:
        n = len(query_tokens)
        keys: list[tuple[str, ...]] = []
        if n >= _WORD_NGRAM_SIZE:
            keys.extend(
                query_tokens[start : start + _WORD_NGRAM_SIZE]
                for start in range(n - _WORD_NGRAM_SIZE + 1)
            )
        # Clés courtes en plus : seules celles des versets < _WORD_NGRAM_SIZE mots
        # existent dans l'index, donc ce sont des lookups bon marché sinon.
        for size in range(1, _WORD_NGRAM_SIZE):
            if n >= size:
                keys.extend(query_tokens[start : start + size] for start in range(n - size + 1))
        return keys

    def _query_char_refs(self, query_tokens: tuple[str, ...]) -> set[VerseRef]:
        compact = "".join(query_tokens)
        n = len(compact)
        if n < _CHAR_NGRAM_SIZE:
            return set(self._char_index.get(compact, ()))

        hits: Counter[VerseRef] = Counter()
        for start in range(n - _CHAR_NGRAM_SIZE + 1):
            key = compact[start : start + _CHAR_NGRAM_SIZE]
            for ref in self._char_index.get(key, ()):
                hits[ref] += 1
        # Exige plusieurs recouvrements : un seul 5-gramme partagé par hasard ne
        # suffit pas (évite les faux positifs sur un texte sans lien, F3/F4).
        min_overlap = min(3, max(1, n - _CHAR_NGRAM_SIZE + 1))
        return {ref for ref, count in hits.items() if count >= min_overlap}

    def _refine(self, ref: VerseRef, query_tokens: tuple[str, ...]) -> Candidate | None:
        verse_tokens = self._verse_tokens[ref]
        matcher = difflib.SequenceMatcher(None, query_tokens, verse_tokens, autojunk=False)
        blocks = [b for b in matcher.get_matching_blocks() if b.size > 0]
        if not blocks:
            return None
        first = min(b.b for b in blocks)
        last = max(b.b + b.size - 1 for b in blocks)
        span = WordSpan(ref=ref, first_word=first + 1, last_word=last + 1)
        return Candidate(span=span, score=matcher.ratio())
