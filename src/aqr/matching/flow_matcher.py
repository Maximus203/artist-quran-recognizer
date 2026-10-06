"""VerseMatcher (port B6) : recherche sur le flux continu du Coran (ADR-0004).

Le Coran est indexé comme **un seul flux de mots** (position globale -> (verset, mot)).
Une requête n'est plus comparée à un verset entier mais alignée **localement** sur une
fenêtre du flux : une partie de verset, ou plusieurs versets d'un souffle, sont aussi
bien notés qu'un verset entier — les mots non récités ne coûtent rien.

Étapes :
1. Amorces : n-grammes de caractères (sur le flux sans espaces, donc insensibles aux
   frontières de mot, cf. ADR-0003) votent pour des diagonales (position flux - position
   requête) ; les diagonales voisines forment un groupe, raffiné ensuite.
2. Alignement local (Smith-Waterman par mots, borné autour de la diagonale) : mot égal ou
   proche (similarité de lettres), mot erroné, mot en trop dans la requête, mot avalé.
3. Score = (somme des similarités / (mots de la requête + mots du flux sautés)) x preuve,
   où la preuve croît jusqu'à `evidence_words` mots expliqués : un fragment trop court
   pour être discriminant (F5, I3) ne passe jamais la porte de confiance du décodeur.
4. Ambiguïté : toutes les positions distinctes sont renvoyées avec leur score ; le
   décodeur B7 tranche par le contexte ou déclare UNCERTAIN.

La basmala que Tanzil concatène au verset 1 (toutes sourates sauf 1 et 9) est une unité
à part : retirée du flux, détectée en tête de requête, et réintégrée au span seulement si
elle précède bien le début d'un verset 1.

Aucun seuil de décision ici (CLAUDE.md) : `FlowMatcherConfig` ne règle que la génération
de candidats et la forme du score ; la porte de confiance reste celle du décodeur.
Les mots viennent de `CorpusRepository.words()` (tokenisation Uthmani) : les `WordSpan`
restent cohérents avec le rendu (invariant I1) ; le matcher ne produit aucun texte.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from functools import lru_cache

from aqr.corpus.normalize import normalize_arabic
from aqr.domain.models import VerseRef, WordSpan
from aqr.domain.ports import Candidate, CorpusRepository
from aqr.domain.quran_structure import BASMALA_WORD_COUNT, verse_one_includes_basmala
from aqr.matching.similarity import word_similarity

_CHAR_NGRAM_SIZE = 5


@dataclass(frozen=True)
class FlowMatcherConfig:
    """Réglages de la recherche, calibrés par `scripts/bench_segments.py` (jamais en dur
    dans la logique)."""

    word_match_threshold: float = 0.7
    """Similarité de lettres minimale pour que deux mots comptent comme le même mot
    (erreur d'une lettre sur un mot de 4+ lettres)."""
    mismatch_penalty: float = 0.3
    """Coût d'un mot de la requête face à un mot différent du flux (erreur d'ASR)."""
    query_gap_penalty: float = 0.6
    """Coût d'un mot de la requête sans équivalent dans le flux (mot halluciné)."""
    flow_gap_penalty: float = 0.6
    """Coût d'un mot du flux sauté par la requête (mot avalé)."""
    evidence_words: float = 5.0
    """Nombre de mots expliqués à partir duquel la preuve est pleine."""
    basmala_min_matched: int = 3
    """Mots de basmala (sur 4) à reconnaître en tête de requête pour la traiter à part."""
    seed_min_votes: int = 2
    """Amorces (n-grammes) concordantes minimales pour raffiner un groupe de diagonales."""
    short_query_words: int = 2
    """Jusqu'à ce nombre de mots, les mots entiers complètent les n-grammes comme amorces."""
    max_postings: int = 400
    """Un n-gramme présent à plus de positions est trop banal pour servir d'amorce."""
    diagonal_slack: int = 4
    """Dérive tolérée (en mots) entre le début et la fin d'un alignement."""
    max_groups: int = 40
    """Groupes de diagonales raffinés par requête (les mieux votés d'abord)."""
    group_vote_ratio: float = 0.3
    """Un groupe moins voté que ce ratio du meilleur n'est pas raffiné (vitesse)."""


@dataclass(frozen=True)
class _Alignment:
    first: int  # position flux du premier mot aligné
    last: int
    pairs: tuple[tuple[int, int], ...]  # (mot de requête, position flux), appariés
    similarity: float  # somme des similarités des mots égaux/proches
    flow_skipped: int  # mots du flux sautés à l'intérieur de l'alignement


class FlowVerseMatcher:
    def __init__(
        self,
        corpus: CorpusRepository,
        word_corrections: dict[str, str] | None = None,
        config: FlowMatcherConfig | None = None,
    ) -> None:
        self._config = config or FlowMatcherConfig()
        self._corrections = word_corrections or {}
        self._tokens: list[str] = []
        self._where: list[tuple[VerseRef, int]] = []  # position flux -> (verset, mot 1-indexé)
        self._basmala = self._skeleton_words(corpus, VerseRef(1, 1))[:BASMALA_WORD_COUNT]
        self._verse_length: dict[VerseRef, int] = {}
        self._verse_one_start: dict[VerseRef, int] = {}  # verset 1 -> position flux de son mot 5
        self._build_flow(corpus)
        self._char_postings: dict[str, list[int]] = defaultdict(list)
        self._token_postings: dict[str, list[int]] = defaultdict(list)
        self._build_char_index()
        self._similarity = lru_cache(maxsize=1 << 18)(self._word_similarity)

    # -- Construction -------------------------------------------------------
    def _skeleton(self, word: str) -> str:
        normalized = normalize_arabic(word).replace(" ", "")
        return self._corrections.get(normalized, normalized)

    def _skeleton_words(self, corpus: CorpusRepository, ref: VerseRef) -> list[str]:
        return [self._skeleton(w) for w in corpus.words(ref)]

    def _build_flow(self, corpus: CorpusRepository) -> None:
        for ref in corpus.all_refs():
            words = self._skeleton_words(corpus, ref)
            self._verse_length[ref] = len(words)
            first = 1
            if (
                ref.ayah == 1
                and ref.surah != 1
                and verse_one_includes_basmala(ref.surah)
                and words[:BASMALA_WORD_COUNT] == self._basmala
            ):
                first = BASMALA_WORD_COUNT + 1  # la basmala sort du flux (unité à part)
                self._verse_one_start[ref] = len(self._tokens)
            for index in range(first, len(words) + 1):
                self._tokens.append(words[index - 1])
                self._where.append((ref, index))

    def _build_char_index(self) -> None:
        for position, token in enumerate(self._tokens):
            self._token_postings[token].append(position)
        compact = "".join(self._tokens)
        word_of_char: list[int] = []
        for position, token in enumerate(self._tokens):
            word_of_char.extend([position] * len(token))
        for start in range(len(compact) - _CHAR_NGRAM_SIZE + 1):
            self._char_postings[compact[start : start + _CHAR_NGRAM_SIZE]].append(
                word_of_char[start]
            )

    # -- Similarité de mots ---------------------------------------------------
    def _word_similarity(self, a: str, b: str) -> float:
        return word_similarity(a, b, self._config.word_match_threshold)

    # -- Recherche ---------------------------------------------------------------
    def match(self, normalized_text: str, top_k: int = 5) -> list[Candidate]:
        raw = tuple(t for t in normalized_text.split(" ") if t)
        query = tuple(self._corrections.get(t, t) for t in raw)
        if not query:
            return []

        found = self._search(query, len(query), credit_basmala=False)
        prefix = self._leading_basmala(query)
        if prefix:
            found.extend(self._search(query[prefix:], len(query), credit_basmala=True))
        return self._rank(found, top_k)

    def _leading_basmala(self, query: tuple[str, ...]) -> int:
        """Nombre de mots de tête de la requête qui forment la basmala (0 si absente).

        Les 4 mots sont cherchés dans l'ordre, un mot parasite toléré entre deux : un mot
        avalé ou ajouté par l'ASR ne doit pas faire perdre la basmala."""
        position = matched = 0
        for word in self._basmala:
            for index in range(position, min(position + 2, len(query))):
                if self._similarity(query[index], word) > 0:
                    matched += 1
                    position = index + 1
                    break
        if matched < self._config.basmala_min_matched or position >= len(query):
            return 0
        return position

    def _search(
        self, query: tuple[str, ...], query_words: int, credit_basmala: bool
    ) -> list[tuple[float, float, _Alignment, int]]:
        """(score, couverture, alignement, mots de basmala crédités) par position distincte.

        `query_words` compte tous les mots de la requête d'origine : la basmala retirée
        de `query` reste « à expliquer » tant qu'aucun verset 1 ne la suit.
        """
        results: list[tuple[float, float, _Alignment, int]] = []
        for lo, hi in self._diagonal_groups(query):
            alignment = self._align(query, lo, hi)
            if alignment is None:
                continue
            credited = (
                BASMALA_WORD_COUNT if credit_basmala and self._follows_basmala(alignment) else 0
            )
            score, coverage = self._score(alignment, query_words, credited)
            results.append((score, coverage, alignment, credited))
        return results

    def _follows_basmala(self, alignment: _Alignment) -> bool:
        """L'alignement commence au début d'un verset 1 (à ses premiers mots erronés près) :
        la basmala récitée juste avant en fait partie."""
        ref = self._where[alignment.first][0]
        start = self._verse_one_start.get(ref)
        return start is not None and alignment.first - start == alignment.pairs[0][0]

    def _score(self, alignment: _Alignment, query_words: int, credited: int) -> tuple[float, float]:
        explained = alignment.similarity + credited
        coverage = min(1.0, explained / query_words)
        proof = min(1.0, explained / self._config.evidence_words)
        quality = explained / (query_words + alignment.flow_skipped)
        return min(1.0, quality) * proof, coverage

    def _diagonal_groups(self, query: tuple[str, ...]) -> list[tuple[int, int]]:
        """Groupes de diagonales (position flux - position requête) qui votent ensemble."""
        compact = "".join(query)
        word_of_char = [i for i, token in enumerate(query) for _ in token]
        size = _CHAR_NGRAM_SIZE
        votes: Counter[int] = Counter()
        floor_votes = self._config.seed_min_votes
        if len(query) <= self._config.short_query_words:
            # Requête de 1-2 mots (ex. « الم » après la basmala) : trop peu de n-grammes,
            # les mots entiers servent aussi d'amorces.
            floor_votes = 1
            for query_word, token in enumerate(query):
                postings = self._token_postings.get(token, ())
                if len(postings) <= self._config.max_postings:
                    for position in postings:
                        votes[position - query_word] += 1
        if len(compact) >= size:
            for start in range(len(compact) - size + 1):
                postings = self._char_postings.get(compact[start : start + size], ())
                if len(postings) > self._config.max_postings:
                    continue
                for position in postings:
                    votes[position - word_of_char[start]] += 1
        if not votes:
            return []

        groups: list[list[int]] = []
        for diagonal in sorted(votes):
            if groups and diagonal - groups[-1][-1] <= self._config.diagonal_slack:
                groups[-1].append(diagonal)
            else:
                groups.append([diagonal])
        ranked = sorted(groups, key=lambda g: -sum(votes[d] for d in g))
        top = sum(votes[d] for d in ranked[0])
        floor = max(floor_votes, self._config.group_vote_ratio * top)
        kept = [g for g in ranked if sum(votes[d] for d in g) >= floor]
        return [(g[0], g[-1]) for g in kept[: self._config.max_groups]]

    def _align(self, query: tuple[str, ...], lo: int, hi: int) -> _Alignment | None:
        """Alignement local par mots, borné aux diagonales [lo - slack, hi + slack]."""
        cfg = self._config
        m = len(query)
        base = lo - cfg.diagonal_slack  # diagonale la plus basse de la bande
        width = hi - lo + 2 * cfg.diagonal_slack + 1
        n_flow = len(self._tokens)
        rows: list[list[tuple[float, int]]] = []  # (score, pointeur) par (i, k)
        best = (0.0, -1, -1)
        for i in range(m):
            row: list[tuple[float, int]] = []
            for k in range(width):
                j = i + base + k
                if not 0 <= j < n_flow:
                    row.append((0.0, 0))
                    continue
                similarity = self._similarity(query[i], self._tokens[j])
                gain = similarity if similarity > 0 else -cfg.mismatch_penalty
                diag = (rows[i - 1][k][0] if i else 0.0) + gain
                up = (
                    (rows[i - 1][k + 1][0] - cfg.query_gap_penalty) if i and k + 1 < width else -1.0
                )
                left = (row[k - 1][0] - cfg.flow_gap_penalty) if k else -1.0
                cell = max((0.0, 0), (diag, 1), (up, 2), (left, 3))
                row.append(cell)
                if similarity > 0 and cell[0] > best[0]:
                    best = (cell[0], i, k)
            rows.append(row)
        if best[1] < 0:
            return None
        return self._traceback(query, rows, best[1], best[2], base)

    def _traceback(
        self,
        query: tuple[str, ...],
        rows: list[list[tuple[float, int]]],
        i: int,
        k: int,
        base: int,
    ) -> _Alignment | None:
        pairs: list[tuple[int, int]] = []
        similarity = 0.0
        skipped = 0
        while i >= 0 and 0 <= k < len(rows[i]):
            score, pointer = rows[i][k]
            if pointer == 0 or score <= 0:
                break
            j = i + base + k
            if pointer == 1:
                s = self._similarity(query[i], self._tokens[j])
                if s > 0:
                    pairs.append((i, j))
                    similarity += s
                i -= 1
            elif pointer == 2:
                i -= 1
                k += 1
            else:
                skipped += 1
                k -= 1
        if not pairs:
            return None
        pairs.reverse()
        return _Alignment(
            first=pairs[0][1],
            last=pairs[-1][1],
            pairs=tuple(pairs),
            similarity=similarity,
            flow_skipped=skipped,
        )

    def _boundary_fit(self, alignment: _Alignment, credited: int) -> int:
        """0 à 2 : le premier mot ouvre un verset, le dernier le ferme."""
        first_ref, first_word = self._where[alignment.first]
        last_ref, last_word = self._where[alignment.last]
        opens = (
            first_word == 1
            or credited > 0
            or self._verse_one_start.get(first_ref) == alignment.first
        )
        closes = last_word == self._verse_length[last_ref]
        return int(opens) + int(closes)

    # -- Résultat ------------------------------------------------------------------
    def _rank(
        self, found: list[tuple[float, float, _Alignment, int]], top_k: int
    ) -> list[Candidate]:
        # À score égal, le segment qui épouse les bornes d'un verset passe devant celui qui
        # coupe un verset plus long : les segments sont découpés aux pauses, dont les fins
        # de verset. Simple ordre : l'ambiguïté reste visible dans les scores (B7).
        found.sort(
            key=lambda item: (
                -round(item[0], 6),
                -self._boundary_fit(item[2], item[3]),
                item[2].first,
            )
        )
        taken: list[tuple[int, int]] = []
        candidates: list[Candidate] = []
        for score, coverage, alignment, credited in found:
            if score <= 0 or any(
                alignment.first <= last and first <= alignment.last for first, last in taken
            ):
                continue
            taken.append((alignment.first, alignment.last))
            candidates.append(self._candidate(score, coverage, alignment, credited))
            if len(candidates) == top_k:
                break
        return candidates

    def _candidate(
        self, score: float, coverage: float, alignment: _Alignment, credited: int
    ) -> Candidate:
        spans: list[list[int]] = []  # [index du verset dans `refs`, premier mot, dernier mot]
        refs: list[VerseRef] = []
        for position in range(alignment.first, alignment.last + 1):
            ref, word = self._where[position]
            if not refs or refs[-1] != ref:
                refs.append(ref)
                spans.append([len(refs) - 1, word, word])
            else:
                spans[-1][2] = word
        if credited:
            spans[0][1] = 1  # la basmala récitée fait partie du premier verset (Tanzil)
        counts = Counter(self._where[j][0] for _i, j in alignment.pairs)
        word_spans = [WordSpan(refs[i], first, last) for i, first, last in spans]
        query_counts = [counts[r] for r in refs]
        query_counts[0] += credited
        return Candidate(
            span=word_spans[0],
            score=score,
            continuation=tuple(word_spans[1:]),
            query_counts=tuple(max(1, c) for c in query_counts),
            coverage=coverage,
        )


__all__ = ["FlowMatcherConfig", "FlowVerseMatcher"]
