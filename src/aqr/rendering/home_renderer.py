"""Renderer (port B9) : rendu par lots en JSON et sous-titres SRT/VTT.

Le texte arabe rendu vient TOUJOURS du `CorpusRepository` (invariant I1) — jamais
d'un champ de la `Detection` elle-même, qui ne porte que la référence du verset,
pas de texte. La traduction vient du `TranslationRepository`, restituée sans
modification, avec identifiant, version et attribution (invariant I2).
"""

from __future__ import annotations

from typing import Final

from aqr.corpus.normalize import normalize_arabic
from aqr.domain.models import Detection, Status, Timeline, VerseRef
from aqr.domain.ports import (
    BatchOptions,
    CorpusRepository,
    RenderedBatch,
    Translation,
    TranslationRepository,
)
from aqr.rendering.subtitles import (
    Cue,
    format_interval,
    format_range,
    format_timestamp,
    write_srt,
    write_vtt,
)
from aqr.rendering.translation_segments import (
    FragmentPolicy,
    Segment,
    SegmentLibrary,
    select_fragment,
)

BASMALA_REF: Final = VerseRef(1, 1)
"""La basmala est le verset 1:1 : texte et traduction se lisent là, dans le corpus (I1, I2)."""


class HomeRenderer:
    def __init__(
        self,
        corpus: CorpusRepository,
        translations: TranslationRepository,
        segments: SegmentLibrary | None = None,
        fragment_policy: FragmentPolicy | None = None,
    ) -> None:
        self._corpus = corpus
        self._translations = translations
        self._segments = segments
        self._policy = fragment_policy or FragmentPolicy()

    def render(
        self, timeline: Timeline, translation_id: str, options: BatchOptions
    ) -> list[RenderedBatch]:
        batches = self._split(timeline.detections(), options)
        return [
            self._render_batch(i, batch, timeline, translation_id)
            for i, batch in enumerate(batches)
        ]

    def _split(
        self, detections: tuple[Detection, ...], options: BatchOptions
    ) -> list[tuple[Detection, ...]]:
        if not detections:
            return []
        size = options.batch_size
        if size is None:
            return [detections]
        if size < 1:
            raise ValueError(f"batch_size doit être >= 1, reçu {size}")
        return [detections[i : i + size] for i in range(0, len(detections), size)]

    def _render_batch(
        self, index: int, batch: tuple[Detection, ...], timeline: Timeline, translation_id: str
    ) -> RenderedBatch:
        items = [self.render_item(det, translation_id) for det in batch]
        json_doc: dict[str, object] = {
            "riwaya": timeline.riwaya.value,
            "engine_version": timeline.engine_version,
            "batch_index": index,
            "items": items,
        }
        return RenderedBatch(
            index=index,
            detections=batch,
            json=json_doc,
            srt=self._render_srt(batch),
            vtt=self._render_vtt(batch),
        )

    def span_text(self, det: Detection) -> str:
        """Texte du passage : sous-chaîne exacte du Mushaf (I1), marques de pause comprises ;
        le verset entier si tous ses mots sont couverts. Jamais un texte venu de l'ASR."""
        ref = det.span.ref
        full = self._corpus.text(ref)
        if not self._is_partial(det):
            return full
        first, last = det.span.first_word, det.span.last_word
        kept: list[str] = []
        words_seen = 0
        for token in full.split():
            if normalize_arabic(token):
                words_seen += 1
            if first <= words_seen <= last:
                kept.append(token)
        return " ".join(kept)

    def word_weights(self, det: Detection) -> list[int]:
        """Longueur en lettres de chaque mot affiché du passage, lue dans le corpus (I1) : le poids
        d'une estimation du temps au mot (ADR-0010)."""
        words = self._corpus.words(det.span.ref)
        shown = words[det.span.first_word - 1 : det.span.last_word]
        return [max(1, len(normalize_arabic(word).replace(" ", ""))) for word in shown]

    def _is_partial(self, det: Detection) -> bool:
        total = len(self._corpus.words(det.span.ref))
        return not (det.span.first_word == 1 and det.span.last_word >= total)

    def _segments_of(self, translation: Translation) -> tuple[Segment, ...] | None:
        """Découpage de la traduction du verset, ou None s'il n'est pas disponible ou périmé."""
        if self._segments is None:
            return None
        store = self._segments.store(translation.translation_id)
        if store is None:
            return None
        words = len(self._corpus.words(translation.ref))
        return store.segments(translation.ref, translation.text, words)

    def _translation_json(
        self,
        ref: VerseRef,
        translation_id: str | None,
        words: tuple[int, int] | None = None,
    ) -> dict[str, object] | None:
        """Traduction du verset entier, restituée sans modification, avec sa provenance (I2).

        Quand un découpage fiable existe : `segments` (tranches consécutives du texte d'origine,
        alignées sur des plages de mots) et, pour un passage partiel `words`, le `fragment` qui
        correspond aux mots affichés (`scope: "fragment"`). Sinon `scope: "verse"` : la traduction
        entière, honnêtement étiquetée.
        """
        if not translation_id:
            return None
        translation = self._translations.get(ref, translation_id)
        if translation is None:
            return None
        out: dict[str, object] = {
            "text": translation.text,
            "translation_id": translation.translation_id,
            "version": translation.version,
            "attribution": translation.attribution,
            "scope": "verse",  # la traduction QuranEnc couvre le verset entier
        }
        segments = self._segments_of(translation)
        if segments is None:
            return out
        out["segments"] = [
            {"words": [s.first_word, s.last_word], "text": translation.text[s.start : s.end]}
            for s in segments
        ]
        if words is not None:
            fragment = select_fragment(
                segments, translation.text, words[0], words[1], segments[-1].last_word, self._policy
            )
            if fragment is not None:
                out["scope"] = "fragment"
                out["fragment"] = {
                    "words": [fragment.first_word, fragment.last_word],
                    "text": fragment.text,
                    "approximate": fragment.approximate,
                    "ellipsis_before": fragment.ellipsis_before,
                    "ellipsis_after": fragment.ellipsis_after,
                }
        return out

    def translation_json(
        self, ref: VerseRef, translation_id: str | None, words: tuple[int, int] | None = None
    ) -> dict[str, object] | None:
        """La traduction QuranEnc d'un passage (`scope: fragment` avec `words` si le découpage est
        fiable), sans modification : la même que celle des intervalles de la sortie JSON (I2)."""
        return self._translation_json(ref, translation_id, words)

    def render_basmala(self, translation_id: str | None) -> dict[str, object]:
        """La basmala d'une zone non coranique : le verset 1:1, lu dans le corpus comme n'importe
        quel verset (I1), avec sa traduction QuranEnc (I2). Jamais un texte venu d'un modèle."""
        return {
            "basmala": True,
            "ref": str(BASMALA_REF),
            "text": self._corpus.text(BASMALA_REF),
            "translation": self._translation_json(BASMALA_REF, translation_id),
        }

    def render_item(self, det: Detection, translation_id: str | None) -> dict[str, object]:
        """Item JSON d'une détection. Un verset `UNCERTAIN` n'est jamais nommé par son texte ni sa
        traduction (seulement ses candidats) ; `translation_id=None` : pas de traduction."""
        ref = det.span.ref
        named = det.status is not Status.UNCERTAIN
        partial = self._is_partial(det)
        return {
            "ref": str(ref),
            "status": det.status.value,
            "words": [det.span.first_word, det.span.last_word],
            "partial": partial,
            "repetition": det.is_repetition,
            "text": self.span_text(det) if named else None,
            "translation": (
                self._translation_json(
                    ref,
                    translation_id,
                    (det.span.first_word, det.span.last_word) if partial else None,
                )
                if named
                else None
            ),
            "time": (
                {
                    "start_s": det.time.start_s,
                    "end_s": det.time.end_s,
                    "interpolated": det.time_interpolated,
                }
                if det.time is not None
                else None
            ),
            "confidence": det.confidence,
            "candidates": [str(c) for c in det.candidates],
        }

    def caption(self, det: Detection) -> str:
        """Ligne de sous-titre : un verset incertain n'est jamais nommé par son texte, un verset
        déduit est marqué comme tel — seul RECOGNIZED est présenté sans réserve."""
        if det.status is Status.UNCERTAIN:
            return "[incertain : " + " | ".join(str(c) for c in det.candidates) + "]"
        text = self.span_text(det)
        return f"[déduit] {text}" if det.status is Status.INFERRED else text

    def _cues(self, batch: tuple[Detection, ...]) -> list[Cue]:
        cues: list[Cue] = []
        for det in batch:
            if det.status is Status.INFERRED and det.time is None:
                continue
            assert det.time is not None
            cues.append(Cue(det.time.start_s, det.time.end_s, arabic=self.caption(det)))
        return cues

    def _render_srt(self, batch: tuple[Detection, ...]) -> str:
        return write_srt(self._cues(batch), rtl=False)

    def _render_vtt(self, batch: tuple[Detection, ...]) -> str:
        return write_vtt(self._cues(batch), rtl=False)


__all__ = ["BASMALA_REF", "HomeRenderer", "format_interval", "format_range", "format_timestamp"]
