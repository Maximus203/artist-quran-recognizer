"""Renderer (port B9) : rendu par lots en JSON et sous-titres SRT/VTT.

Le texte arabe rendu vient TOUJOURS du `CorpusRepository` (invariant I1) — jamais
d'un champ de la `Detection` elle-même, qui ne porte que la référence du verset,
pas de texte. La traduction vient du `TranslationRepository`, restituée sans
modification, avec identifiant, version et attribution (invariant I2).
"""

from __future__ import annotations

from aqr.domain.models import Detection, Status, Timeline
from aqr.domain.ports import BatchOptions, CorpusRepository, RenderedBatch, TranslationRepository


class HomeRenderer:
    def __init__(self, corpus: CorpusRepository, translations: TranslationRepository) -> None:
        self._corpus = corpus
        self._translations = translations

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
        items = [self._render_item(det, translation_id) for det in batch]
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

    def _render_item(self, det: Detection, translation_id: str) -> dict[str, object]:
        ref = det.span.ref
        translation = self._translations.get(ref, translation_id)
        return {
            "ref": str(ref),
            "status": det.status.value,
            "text": self._corpus.text(ref),  # I1 : toujours le corpus, jamais l'ASR
            "translation": {
                "text": translation.text,
                "translation_id": translation.translation_id,
                "version": translation.version,
                "attribution": translation.attribution,
            },
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

    def _render_srt(self, batch: tuple[Detection, ...]) -> str:
        blocks = []
        for i, det in enumerate(batch, start=1):
            if det.status is Status.INFERRED and det.time is None:
                continue
            assert det.time is not None
            blocks.append(
                f"{i}\n{_timestamp(det.time.start_s, ',')} --> {_timestamp(det.time.end_s, ',')}\n"
                f"{self._corpus.text(det.span.ref)}\n"
            )
        return "\n".join(blocks)

    def _render_vtt(self, batch: tuple[Detection, ...]) -> str:
        blocks = ["WEBVTT\n"]
        for det in batch:
            if det.status is Status.INFERRED and det.time is None:
                continue
            assert det.time is not None
            blocks.append(
                f"{_timestamp(det.time.start_s, '.')} --> {_timestamp(det.time.end_s, '.')}\n"
                f"{self._corpus.text(det.span.ref)}\n"
            )
        return "\n".join(blocks)


def _timestamp(seconds: float, decimal_sep: str) -> str:
    total_ms = round(seconds * 1000)
    hours, total_ms = divmod(total_ms, 3_600_000)
    minutes, total_ms = divmod(total_ms, 60_000)
    secs, millis = divmod(total_ms, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{decimal_sep}{millis:03d}"
