"""Promotion d'un verset `uncertain` membre d'une suite acceptée par l'audio (ADR-0013).

Le décodeur juge l'ambiguïté d'une étape avec ce qu'il a vu JUSQU'À elle : le début de la
Fatiha (1:1 [2-4], 1:2 [1-4]) est à égalité avec des homonymes (la fin de chaque basmala, le
début de 6:45…) tant qu'il n'a pas vu la suite, et reste `uncertain` même quand la suite le
désambiguïse. Or la suite 1:1-1:5 a été vérifiée sur l'audio (ADR-0008, `llr_per_frame` −0,25) :
son texte du corpus, avec ces plages exactes, explique la parole du passage. Un membre
`uncertain` de cette suite est donc reconnu, sauf si une AUTRE suite (autres plages) a aussi été
acceptée sur le même temps : deux homonymes qui se valent restent l'affaire du décodeur (limite
connue d'ADR-0008). Pur : testable sans modèle.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace

from aqr.domain.models import Detection, Status, TimeSpan, WordSpan

PROMOTED_BY = "chain"


@dataclass(frozen=True)
class ChainProof:
    """Verdict de l'audio sur une suite de versets : son passage, son texte (plages du corpus)."""

    passage: TimeSpan
    spans: tuple[WordSpan, ...]
    accepted: bool


def promote_chain_members(
    detections: Sequence[Detection], proofs: Sequence[ChainProof], *, tolerance_s: float = 0.1
) -> list[Detection]:
    """Les mêmes détections, où chaque `uncertain` couvert par une suite acceptée devient
    `recognized` (`promoted_by="chain"`, plus de candidats concurrents)."""
    accepted = [p for p in proofs if p.accepted]
    return [_promote(d, accepted, tolerance_s) for d in detections]


def _promote(det: Detection, accepted: Sequence[ChainProof], tolerance_s: float) -> Detection:
    if det.status is not Status.UNCERTAIN or det.time is None:
        return det
    overlapping = [p for p in accepted if _overlap(p.passage, det.time) > det.time.duration_s / 2]
    supporting = [
        p for p in overlapping if _contains(p.passage, det.time, tolerance_s) and _covers(p, det)
    ]
    rivals = [p for p in overlapping if not _covers(p, det)]
    if not supporting or rivals:
        return det
    return replace(det, status=Status.RECOGNIZED, candidates=(), promoted_by=PROMOTED_BY)


def _overlap(passage: TimeSpan, time: TimeSpan) -> float:
    return min(passage.end_s, time.end_s) - max(passage.start_s, time.start_s)


def _contains(passage: TimeSpan, time: TimeSpan, tolerance_s: float) -> bool:
    return (
        passage.start_s - tolerance_s <= time.start_s and time.end_s <= passage.end_s + tolerance_s
    )


def _covers(proof: ChainProof, det: Detection) -> bool:
    return any(
        s.ref == det.span.ref
        and s.first_word <= det.span.first_word
        and det.span.last_word <= s.last_word
        for s in proof.spans
    )
