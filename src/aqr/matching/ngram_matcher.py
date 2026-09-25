"""VerseMatcher (port B6) : index n-grammes de mots + réalignement par similarité.

Indexe les mots tels que retournés par `CorpusRepository.words()` (tokenisation
Uthmani) — jamais une source de mots séparée, pour garder les `WordSpan` cohérents
avec le rendu (invariant I1). Voir .artist/decision-log.md (2026-09-25).

Pas de seuil de rejet codé en dur ici (cf. CLAUDE.md) : l'absence de recouvrement de
n-gramme suffit à ne renvoyer aucun candidat pour un texte sans lien avec le Coran
(F3/F4). Le seuil de confiance final (I3, « porte de confiance ») est une décision de
la brique appelante (B5/B7), configurée, pas de ce matcher.
"""

from __future__ import annotations

import difflib
from collections import Counter

from aqr.corpus.normalize import normalize_arabic
from aqr.domain.models import VerseRef, WordSpan
from aqr.domain.ports import Candidate, CorpusRepository

_NGRAM_SIZE = 3
_MAX_CANDIDATES_REFINED = 50


class NgramVerseMatcher:
    def __init__(self, corpus: CorpusRepository) -> None:
        self._verse_tokens: dict[VerseRef, tuple[str, ...]] = {}
        self._index: dict[tuple[str, ...], list[tuple[VerseRef, int]]] = {}
        for ref in corpus.all_refs():
            tokens = tuple(normalize_arabic(w) for w in corpus.words(ref))
            self._verse_tokens[ref] = tokens
            self._index_verse(ref, tokens)

    def _index_verse(self, ref: VerseRef, tokens: tuple[str, ...]) -> None:
        n = len(tokens)
        if n >= _NGRAM_SIZE:
            for start in range(n - _NGRAM_SIZE + 1):
                key = tokens[start : start + _NGRAM_SIZE]
                self._index.setdefault(key, []).append((ref, start))
        elif n > 0:
            # Verset plus court que _NGRAM_SIZE (ex. 55:64, un seul mot) : indexé tel
            # quel pour rester trouvable — ces clés courtes sont très peu nombreuses
            # et donc très sélectives (pas de coût de performance en pratique).
            self._index.setdefault(tokens, []).append((ref, 0))

    def match(self, normalized_text: str, top_k: int = 5) -> list[Candidate]:
        query_tokens = tuple(t for t in normalized_text.split(" ") if t)
        if not query_tokens:
            return []

        hits: Counter[VerseRef] = Counter()
        for key in self._query_keys(query_tokens):
            for ref, _start in self._index.get(key, ()):
                hits[ref] += 1

        candidates: list[Candidate] = []
        for ref, _count in hits.most_common(_MAX_CANDIDATES_REFINED):
            candidate = self._refine(ref, query_tokens)
            if candidate is not None:
                candidates.append(candidate)

        candidates.sort(key=lambda c: c.score, reverse=True)
        return candidates[:top_k]

    def _query_keys(self, query_tokens: tuple[str, ...]) -> list[tuple[str, ...]]:
        n = len(query_tokens)
        keys: list[tuple[str, ...]] = []
        if n >= _NGRAM_SIZE:
            keys.extend(
                query_tokens[start : start + _NGRAM_SIZE] for start in range(n - _NGRAM_SIZE + 1)
            )
        # Clés courtes en plus : seules celles des versets < _NGRAM_SIZE mots existent
        # dans l'index, donc ce sont des lookups bon marché (échec immédiat sinon).
        for size in range(1, _NGRAM_SIZE):
            if n >= size:
                keys.extend(query_tokens[start : start + size] for start in range(n - size + 1))
        return keys

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
