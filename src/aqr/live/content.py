"""Ce que le direct affiche d'un verset : tout vient du corpus et de QuranEnc (I1, I2).

Le suivi compte les mots du FLUX du Coran (basmala du verset 1 retirée) ; le contrat
`aqr.recognition/1` compte les mots du CORPUS (basmala comprise). `LiveContent` fait la
conversion et fabrique les intervalles avec le même code que `aqr recognize`
(`verse_interval_json`) : un seul contrat, aucune copie.

Une traduction qui échoue (réseau, cache corrompu) ne bloque jamais un verrou : l'intervalle part
sans traduction et le dit (`translation_unavailable`).
"""

from __future__ import annotations

from collections.abc import Sequence
from functools import lru_cache
from typing import Any

from aqr.domain.models import Detection, Status, TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import CorpusRepository
from aqr.live.journal import journal
from aqr.live.prefix_index import PrefixIndex
from aqr.pipeline.output import verse_interval_json
from aqr.rendering.home_renderer import HomeRenderer

_OPEN_MIN_S = 1e-3
"""Un intervalle ouvert (verset en cours) reste un `TimeSpan` valide pour le rendu."""
_WORD_TIMES = ("word_times", "word_times_source")


class LiveContent:
    def __init__(
        self, index: PrefixIndex, corpus: CorpusRepository, renderer: HomeRenderer
    ) -> None:
        self._index = index
        self._corpus = corpus
        self._renderer = renderer
        self._offset = lru_cache(maxsize=None)(self._compute_offset)

    # ------------------------------------------------------------------ rangs
    def _compute_offset(self, ref: VerseRef) -> int:
        """Mots du corpus absents du flux pour ce verset (la basmala du verset 1 : 4, sinon 0)."""
        return max(0, len(self._corpus.words(ref)) - self._index.length(ref))

    def corpus_rank(self, ref: VerseRef, flow_rank: int) -> int:
        """Rang (à partir de 1) dans le corpus d'un mot dont le rang dans le flux est connu."""
        return flow_rank + self._offset(ref)

    def word_count(self, ref: VerseRef) -> int:
        return len(self._corpus.words(ref))

    def word(self, ref: VerseRef, corpus_rank: int) -> str | None:
        """Le mot du corpus à ce rang (graphie du Mushaf), ou None s'il n'existe pas."""
        words = self._corpus.words(ref)
        return words[corpus_rank - 1] if 1 <= corpus_rank <= len(words) else None

    # ------------------------------------------------------------------ passage entendu
    def common_text(self, sources: Sequence[tuple[VerseRef, int]], shared_words: int) -> str | None:
        """Texte des `shared_words` mots communs, lu dans le corpus, seulement si la graphie est
        identique dans TOUS les candidats ; sinon None (on n'affiche pas un texte non vérifié)."""
        if shared_words < 1 or not sources:
            return None
        spellings: set[tuple[str, ...]] = set()
        for ref, flow_first in sources:
            first = self.corpus_rank(ref, flow_first)
            words = self._corpus.words(ref)[first - 1 : first - 1 + shared_words]
            if len(words) < shared_words:
                return None
            spellings.add(tuple(words))
            if len(spellings) > 1:
                return None
        ref, flow_first = sources[0]
        first = self.corpus_rank(ref, flow_first)
        return self._renderer.passage_text(ref, first, first + shared_words - 1)

    # ------------------------------------------------------------------ intervalles
    def verse(
        self,
        *,
        ref: VerseRef,
        status: Status,
        first_flow_word: int,
        last_flow_word: int | None,
        start_s: float,
        end_s: float | None,
        confidence: float,
        repetition: bool,
        translation_id: str | None,
    ) -> dict[str, Any]:
        """Intervalle `kind: "verse"`. `last_flow_word` et `end_s` à None : verset en cours, que
        l'on s'attend à entendre jusqu'à son dernier mot ; `t` se termine alors par `null`."""
        first = self.corpus_rank(ref, first_flow_word)
        total = self.word_count(ref)
        last = total if last_flow_word is None else self.corpus_rank(ref, last_flow_word)
        last = min(max(last, first), total)
        opened = end_s is None
        detection = Detection(
            span=WordSpan(ref, first, last),
            time=TimeSpan(start_s, max(start_s + _OPEN_MIN_S, end_s or 0.0)),
            status=status,
            confidence=min(1.0, max(0.0, confidence)),
            is_repetition=repetition and status is Status.RECOGNIZED,
        )
        interval = self._render(detection, translation_id)
        interval["repetition"] = repetition
        if opened:
            interval["t"] = [round(start_s, 3), None]
            for key in _WORD_TIMES:
                interval.pop(key, None)
        return interval

    def _render(self, detection: Detection, translation_id: str | None) -> dict[str, Any]:
        try:
            return dict(verse_interval_json(detection, self._renderer, translation_id))
        except Exception as error:
            if translation_id is None:
                raise
            journal.warning(
                "translation.unavailable", ref=str(detection.span.ref), error=type(error).__name__
            )
            interval = dict(verse_interval_json(detection, self._renderer, None))
            interval["translation_unavailable"] = True
            return interval

    def basmala(self, translation_id: str | None) -> dict[str, Any]:
        try:
            return dict(self._renderer.render_basmala(translation_id))
        except Exception as error:
            if translation_id is None:
                raise
            journal.warning("translation.unavailable", ref="1:1", error=type(error).__name__)
            return {**self._renderer.render_basmala(None), "translation_unavailable": True}
