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


def _recited_start(ref: VerseRef) -> int:
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
    return finished and first.first_word <= _recited_start(first.ref) + slack


def promote_chains(
    observations: Sequence[Observation], corpus: _Words, config: ChainConfig
) -> list[Observation]:
    """Observations où les maillons d'une suite assez prouvée ont leur qualité pour score."""
    if not config.enabled:
        return list(observations)
    eligible = [
        [c.quality is not None and c.quality >= config.min_quality for c in candidates]
        for _time, candidates in observations
    ]

    def links(i: int, j: int) -> list[tuple[int, int]]:
        """Paires (k dans i, l dans j) de maillons éligibles où j continue i."""
        return [
            (k, m)
            for k, a in enumerate(observations[i][1])
            for m, b in enumerate(observations[j][1])
            if eligible[i][k] and eligible[j][m] and _continues(a, b, corpus, config.word_slack)
        ]

    n = len(observations)
    # (fenêtres, mots) de la meilleure suite qui FINIT (fwd) / COMMENCE (bwd) à chaque maillon.
    fwd = [[(1, c.explained) for c in cands] for _t, cands in observations]
    bwd = [[(1, c.explained) for c in cands] for _t, cands in observations]
    for i in range(1, n):
        for k, m in links(i - 1, i):
            windows, words = fwd[i - 1][k]
            own = observations[i][1][m].explained
            fwd[i][m] = max(fwd[i][m], (windows + 1, words + own), key=lambda s: s[1])
    for i in range(n - 2, -1, -1):
        for k, m in links(i, i + 1):
            windows, words = bwd[i + 1][m]
            own = observations[i][1][k].explained
            bwd[i][k] = max(bwd[i][k], (windows + 1, words + own), key=lambda s: s[1])

    out: list[Observation] = []
    for i, (time, candidates) in enumerate(observations):
        updated: list[Candidate] = []
        for k, c in enumerate(candidates):
            windows = fwd[i][k][0] + bwd[i][k][0] - 1
            words = fwd[i][k][1] + bwd[i][k][1] - c.explained
            proven = windows >= config.min_windows and words >= config.evidence_words
            if eligible[i][k] and proven and c.quality is not None and c.quality > c.score:
                updated.append(replace(c, score=c.quality))
            else:
                updated.append(c)
        out.append((time, updated))
    return out
