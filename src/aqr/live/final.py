"""Document de fin de flux : le même contrat qu'`aqr recognize` (`aqr.recognition/1`), ADR-0011 §6.

Le direct est une vue anticipée, le lot reste la référence. Ce document garde ce que le direct a
décidé : les versets clos (`Continue`) et les passages restés ambigus (`Unresolved`), avec le texte
du corpus (I1) et la traduction QuranEnc (I2) rendus par le même code que le lot. Un passage resté
ambigu avec plusieurs candidats devient `uncertain` (jamais nommé) ; avec un seul, une abstention.

L'empreinte `source.sha256` est celle du flux PCM reçu, calculée au fil de l'eau : l'audio lui-même
n'est jamais gardé.
"""

from __future__ import annotations

from typing import Any

from aqr.domain.models import Detection, Status, TimeSpan, WordSpan
from aqr.live.content import LiveContent
from aqr.live.events import Continue, LiveEvent, Locked, Revision, Unresolved
from aqr.live.journal import journal
from aqr.pipeline.output import build_json
from aqr.pipeline.result import (
    AbstentionReason,
    AbstentionSpan,
    EngineInfo,
    Interval,
    RecognitionResult,
)
from aqr.rendering.home_renderer import HomeRenderer

LIVE_NOTE = (
    "Document de fin de flux en direct (aqr.live/1) : versets clos et passages ambigus "
    "seulement, sans vérification acoustique ni réécoute ; l'audio du flux n'est pas conservé."
)
TRANSLATION_NOTE = "traduction indisponible au moment du document final"
_MIN_SPAN_S = 1e-3


class FinalDocumentBuilder:
    def __init__(
        self,
        content: LiveContent,
        renderer: HomeRenderer,
        engine: EngineInfo,
        *,
        corpus_version: str,
        translation_id: str | None,
    ) -> None:
        self._content = content
        self._renderer = renderer
        self._engine = EngineInfo(
            asr=engine.asr,
            segmenter=engine.segmenter,
            matcher=engine.matcher,
            decoder=engine.decoder,
            constrained=False,
            corpus=f"tanzil.net hafs ({corpus_version})",
            acoustic=engine.acoustic,
        )
        self._translation = translation_id
        self._intervals: list[Interval] = []
        self._locks: dict[str, tuple[float, bool]] = {}

    @property
    def interval_count(self) -> int:
        return len(self._intervals)

    def observe(self, event: LiveEvent) -> None:
        if isinstance(event, Locked):
            self._locks[str(event.ref)] = (event.posterior, event.repetition)
        elif isinstance(event, Revision):
            self._locks.pop(str(event.ref), None)
        elif isinstance(event, Continue):
            self._intervals.append(self._verse(event))
        elif isinstance(event, Unresolved):
            self._intervals.append(self._unresolved(event))

    def _verse(self, event: Continue) -> Detection:
        content = self._content
        confidence, repetition = self._locks.pop(str(event.ref), (0.0, False))
        total = content.word_count(event.ref)
        first = content.corpus_rank(event.ref, event.first_word)
        last = min(max(content.corpus_rank(event.ref, event.last_word), first), total)
        return Detection(
            span=WordSpan(event.ref, min(first, total), last),
            time=TimeSpan(event.start_s, max(event.end_s, event.start_s + _MIN_SPAN_S)),
            status=event.status,
            confidence=min(1.0, max(0.0, confidence)),
            is_repetition=repetition and event.status is Status.RECOGNIZED,
        )

    def _unresolved(self, event: Unresolved) -> Interval:
        time = TimeSpan(event.start_s, max(event.end_s, event.start_s + _MIN_SPAN_S))
        if len(event.candidates) < 2:
            return AbstentionSpan(time, AbstentionReason.BELOW_THRESHOLD)
        head = event.candidates[0]
        return Detection(
            span=WordSpan(head, 1, min(event.words_heard, self._content.word_count(head))),
            time=time,
            status=Status.UNCERTAIN,
            confidence=0.0,
            candidates=event.candidates,
        )

    def build(
        self, *, session_id: str, duration_s: float, sha256: str, timing: dict[str, float]
    ) -> dict[str, Any]:
        result = RecognitionResult(
            source_file=f"live:{session_id}",
            duration_s=round(duration_s, 3),
            intervals=tuple(self._intervals),
            engine=self._engine,
            timing=timing,
            decoder_config={},
            windows=len(self._intervals),
            warnings=(LIVE_NOTE,),
        )
        try:
            return dict(build_json(result, self._renderer, self._translation, sha256))
        except Exception as error:  # une traduction qui échoue ne perd pas le résultat du flux
            if self._translation is None:
                raise
            journal.warning("final.translation_unavailable", error=type(error).__name__)
            degraded = RecognitionResult(
                **{**result.__dict__, "warnings": (LIVE_NOTE, TRANSLATION_NOTE)}
            )
            return dict(build_json(degraded, self._renderer, None, sha256))
