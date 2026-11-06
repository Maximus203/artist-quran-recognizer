"""Garde-fou : une transcription qui ressemble au Coran n'est jamais affichée ni traduite (I3, I4).

Un verset classé « non coranique » par erreur serait sinon transcrit puis traduit : une
fausse traduction du Coran. Deux détecteurs indépendants, le plus sévère l'emporte :
- le reconnaisseur de versets du moteur (`VerseMatcher`, tolérant à l'orthographe de l'ASR) ;
- une recherche exacte de suites de mots dans le corpus (triplets et suite continue).
Le garde ne renvoie jamais de texte : seulement un verdict.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

from aqr.domain.ports import VerseMatcher
from aqr.freespeech.config import FreeSpeechConfig

_GRAM = 3


@dataclass(frozen=True)
class GuardVerdict:
    quranic: bool
    reason: str | None
    """`matcher`, `ngram` ou `run` ; None si rien de coranique."""
    score: float
    """Plus forte des mesures, dans [0, 1] (journal et banc, jamais affichée)."""


class CorpusGuard:
    def __init__(
        self,
        verses: Iterable[Sequence[str]],
        config: FreeSpeechConfig,
        matcher: VerseMatcher | None = None,
        word_corrections: Mapping[str, str] | None = None,
    ) -> None:
        """`verses` : mots normalisés de chaque verset (`normalize_arabic`)."""
        self._config = config
        self._matcher = matcher
        self._fix = dict(word_corrections or {})
        self._grams: set[tuple[str, ...]] = set()
        self._runs: set[tuple[str, ...]] = set()
        run = config.guard_run_words
        for words in verses:
            words = tuple(words)
            for i in range(len(words) - _GRAM + 1):
                self._grams.add(words[i : i + _GRAM])
            for i in range(len(words) - run + 1):
                self._runs.add(words[i : i + run])

    def _canonical(self, words: Sequence[str]) -> tuple[str, ...]:
        return tuple(self._fix.get(w, w) for w in words)

    def check(self, words: Sequence[str]) -> GuardVerdict:
        words = self._canonical(words)
        cfg = self._config
        if not words:
            return GuardVerdict(False, None, 0.0)
        best = 0.0
        if self._matcher is not None:
            found = self._matcher.match(" ".join(words), top_k=1)
            best = max((c.score for c in found), default=0.0)
            if best >= cfg.guard_match_score:
                return GuardVerdict(True, "matcher", best)
        run = cfg.guard_run_words
        if len(words) >= run and any(
            words[i : i + run] in self._runs for i in range(len(words) - run + 1)
        ):
            return GuardVerdict(True, "run", max(best, 1.0))
        count = len(words) - _GRAM + 1
        share = 0.0
        if count > 0:
            hits = sum(1 for i in range(count) if words[i : i + _GRAM] in self._grams)
            share = hits / count
        if share >= cfg.guard_ngram_overlap:
            return GuardVerdict(True, "ngram", max(best, share))
        return GuardVerdict(False, None, max(best, share))
