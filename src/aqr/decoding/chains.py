"""Preuve cumulée par la suite (étape B, ADR-0007).

Le matcher plafonne le score d'un candidat à `qualité × min(1, mots expliqués / evidence_words)` :
un fragment de 1 ou 2 mots ne doit jamais, seul, nommer un verset (F5, I3). Mais un verset court
(« عَلَّمَ الْقُرْآنَ », 55:2) est rarement seul : récité, il suit et précède ses voisins du Mushaf.
Quand des fenêtres consécutives portent des candidats de bonne qualité qui se CONTINUENT dans le
Mushaf (verset suivant, ou suite du même verset après un waqf) et que cette suite cumule assez de
mots, chacun de ses maillons reçoit sa qualité pour score : la preuve est celle de la suite, pas du
fragment.

Un fragment isolé reste plafonné ; un homonyme hors de la suite aussi (« خَلَقَ الْإِنْسَانَ » :
55:3, 16:4, 21:37 — seul 55:3 continue 55:2). Si deux suites parallèles se valent, toutes deux sont
promues et le décodeur (B7) déclare l'ambiguïté. Pur : testable sans modèle.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Protocol

from aqr.domain.models import TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import Candidate
from aqr.domain.quran_structure import BASMALA_WORD_COUNT, verse_one_includes_basmala

Observation = tuple[TimeSpan, list[Candidate]]


class _Words(Protocol):
    def words(self, ref: VerseRef) -> tuple[str, ...]: ...


@dataclass(frozen=True)
class ChainConfig:
    enabled: bool = True
    min_quality: float = 0.75
    """Qualité minimale de chaque maillon (l'exigence du seuil du décodeur, sans le plafond)."""
    min_windows: int = 2
    """Une suite, c'est au moins deux fenêtres : une seule fenêtre a déjà sa propre preuve."""
    evidence_words: float = 5.0
    """Mots expliqués cumulés exigés de la suite (la preuve pleine d'un candidat du matcher).
    Provisoire : à calibrer sur les annotations de l'étape A."""
    word_slack: int = 1
    """Mots tolérés en moins à la fin d'un verset et au début du suivant (l'ASR tronque souvent le
    dernier mot, « النَّاسِ » -> « النَّ », mesuré le 2026-10-05)."""


def recited_start(ref: VerseRef) -> int:
    if ref.ayah == 1 and ref.surah != 1 and verse_one_includes_basmala(ref.surah):
        return BASMALA_WORD_COUNT + 1
    return 1


def _continues(previous: Candidate, following: Candidate, corpus: _Words, slack: int) -> bool:
    last: WordSpan = previous.spans[-1]
    first = following.span
    if first.ref == last.ref:
        return last.last_word < first.first_word <= last.last_word + 1 + slack
    if first.ref != last.ref.next():
        return False
    finished = last.last_word >= len(corpus.words(last.ref)) - slack
    return finished and first.first_word <= recited_start(first.ref) + slack


@dataclass(frozen=True)
class Chain:
    """Suite de candidats sur des fenêtres consécutives, qui se continue dans le Mushaf."""

    links: tuple[tuple[int, int], ...]
    """(indice d'observation, indice de candidat) de chaque maillon, dans l'ordre."""
    words: float
    """Mots expliqués cumulés par ses maillons."""


def find_chains(
    observations: Sequence[Observation], corpus: _Words, config: ChainConfig, min_quality: float
) -> list[Chain]:
    """Suites assez prouvées en mots (`min_windows`, `evidence_words`) dont chaque maillon a une
    qualité ≥ `min_quality` : la meilleure suite (en mots) passant par chaque candidat, sans
    doublon. Au plancher `config.min_quality`, ce sont les suites que la preuve textuelle promeut ;
    plus bas, des suites qu'il faut vérifier sur l'audio (ADR-0008)."""
    eligible = [
        [c.quality is not None and c.quality >= min_quality for c in candidates]
        for _time, candidates in observations
    ]
    own = [[c.explained for c in candidates] for _time, candidates in observations]

    def links(i: int, j: int) -> list[tuple[int, int]]:
        """Paires (k dans i, m dans j) de maillons éligibles où j continue i."""
        return [
            (k, m)
            for k, a in enumerate(observations[i][1])
            for m, b in enumerate(observations[j][1])
            if eligible[i][k] and eligible[j][m] and _continues(a, b, corpus, config.word_slack)
        ]

    n = len(observations)
    # Mots de la meilleure suite qui FINIT (fwd) / COMMENCE (bwd) à chaque maillon, et son voisin.
    fwd = [list(words) for words in own]
    bwd = [list(words) for words in own]
    before: list[list[int | None]] = [[None] * len(words) for words in own]
    after: list[list[int | None]] = [[None] * len(words) for words in own]
    for i in range(1, n):
        for k, m in links(i - 1, i):
            if fwd[i - 1][k] + own[i][m] > fwd[i][m]:
                fwd[i][m], before[i][m] = fwd[i - 1][k] + own[i][m], k
    for i in range(n - 2, -1, -1):
        for k, m in links(i, i + 1):
            if bwd[i + 1][m] + own[i][k] > bwd[i][k]:
                bwd[i][k], after[i][k] = bwd[i + 1][m] + own[i][k], m

    found: dict[tuple[tuple[int, int], ...], Chain] = {}
    for i in range(n):
        for k in range(len(own[i])):
            if not eligible[i][k]:
                continue
            path = [(i, k)]
            while (back := before[path[0][0]][path[0][1]]) is not None:
                path.insert(0, (path[0][0] - 1, back))
            while (ahead := after[path[-1][0]][path[-1][1]]) is not None:
                path.append((path[-1][0] + 1, ahead))
            words = fwd[i][k] + bwd[i][k] - own[i][k]
            if len(path) >= config.min_windows and words >= config.evidence_words:
                found.setdefault(tuple(path), Chain(tuple(path), words))
    return [found[key] for key in sorted(found)]


def chain_spans(
    chain: Chain, observations: Sequence[Observation], corpus: _Words
) -> list[WordSpan]:
    """Texte du CORPUS d'une suite, en plages de mots : du premier mot de son premier maillon au
    dernier mot du dernier, versets intermédiaires entiers. Les mots que l'ASR a perdus aux bords
    d'une fenêtre (`word_slack`) y sont : c'est ce texte que l'audio doit soutenir."""
    spans: list[WordSpan] = []
    for i, k in chain.links:
        for span in observations[i][1][k].spans:
            if not spans:
                spans.append(span)
                continue
            last = spans[-1]
            if span.ref == last.ref:
                spans[-1] = WordSpan(last.ref, last.first_word, max(last.last_word, span.last_word))
            elif span.ref == last.ref.next():
                spans[-1] = WordSpan(last.ref, last.first_word, len(corpus.words(last.ref)))
                first = min(span.first_word, recited_start(span.ref))
                spans.append(WordSpan(span.ref, first, span.last_word))
            else:
                raise ValueError(f"suite discontinue : {last.ref} puis {span.ref}")
    return spans


def promote_chains(
    observations: Sequence[Observation], corpus: _Words, config: ChainConfig
) -> list[Observation]:
    """Observations où les maillons d'une suite assez prouvée ont leur qualité pour score."""
    if not config.enabled:
        return list(observations)
    promoted = {
        link
        for chain in find_chains(observations, corpus, config, config.min_quality)
        for link in chain.links
    }
    out: list[Observation] = []
    for i, (time, candidates) in enumerate(observations):
        updated: list[Candidate] = []
        for k, c in enumerate(candidates):
            if (i, k) in promoted and c.quality is not None and c.quality > c.score:
                updated.append(replace(c, score=c.quality))
            else:
                updated.append(c)
        out.append((time, updated))
    return out
