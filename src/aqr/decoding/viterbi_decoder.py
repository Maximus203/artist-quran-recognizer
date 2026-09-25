"""SequenceDecoder (port B7) : Viterbi sur le graphe des versets.

États = candidats (VerseRef) proposés par le VerseMatcher pour chaque segment
observé. Transitions pondérées (continuité, répétition, trou d'un verset, saut
arbitraire) — cf. docs/ARCHITECTURE.md §4 piège n°2. Les poids sont un objet de
configuration (`DecoderWeights`), jamais des constantes éparpillées dans la logique
(cf. CLAUDE.md : "seuils et probabilités = configuration calibrée par benchmark").
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from aqr.domain.models import Detection, Riwaya, Status, Timeline, TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import Candidate, CorpusRepository


@dataclass(frozen=True)
class DecoderWeights:
    """Probabilités a priori de transition entre deux positions consécutives."""

    next_verse: float = 1.0  # verset suivant immédiat
    repetition: float = 0.6  # même verset revisité (reprise, i'ada)
    one_verse_gap: float = 0.35  # v -> v+2 : v+1 sera marqué INFERRED
    arbitrary_jump: float = 0.05  # saut arbitraire (autre sourate) : exige un fort score acoustique


@dataclass(frozen=True)
class DecoderConfig:
    weights: DecoderWeights = field(default_factory=DecoderWeights)
    min_recognized_score: float = 0.75
    """Score de candidat minimal pour entrer dans le décodage (porte l'invariant I3 :
    un mot isolé qui ressemble vaguement à un verset (F5) ne doit jamais franchir
    cette porte)."""
    uncertainty_ratio: float = 0.92
    """Si le 2ᵉ meilleur chemin à une étape atteint ce ratio du meilleur, l'étape est
    marquée UNCERTAIN plutôt que RECOGNIZED (I3 : la précision prime sur le rappel)."""
    engine_version: str = "viterbi-decoder-v1"


@dataclass
class _Node:
    score: float
    back_ref: VerseRef | None
    candidate: Candidate


class ViterbiSequenceDecoder:
    def __init__(
        self,
        config: DecoderConfig | None = None,
        corpus: CorpusRepository | None = None,
        riwaya: Riwaya = Riwaya.HAFS,
    ) -> None:
        self._config = config or DecoderConfig()
        self._corpus = corpus
        self._riwaya = riwaya

    def decode(self, observations: Sequence[tuple[TimeSpan, list[Candidate]]]) -> Timeline:
        steps = [
            (time, viable)
            for time, candidates in observations
            if (viable := [c for c in candidates if c.score >= self._config.min_recognized_score])
        ]
        if not steps:
            return Timeline(
                items=(), riwaya=self._riwaya, engine_version=self._config.engine_version
            )

        layers = self._forward(steps)
        path_refs = self._backtrack(layers)
        detections = self._build_detections(steps, layers, path_refs)
        detections = self._merge_repetitions(detections)
        detections = self._fill_single_gaps(detections)
        return Timeline(
            items=tuple(detections), riwaya=self._riwaya, engine_version=self._config.engine_version
        )

    # -- Viterbi forward pass -------------------------------------------------
    def _forward(
        self, steps: list[tuple[TimeSpan, list[Candidate]]]
    ) -> list[dict[VerseRef, _Node]]:
        layers: list[dict[VerseRef, _Node]] = []
        _time0, first_viable = steps[0]
        first_layer: dict[VerseRef, _Node] = {}
        for c in first_viable:
            if c.span.ref not in first_layer or c.score > first_layer[c.span.ref].score:
                first_layer[c.span.ref] = _Node(score=c.score, back_ref=None, candidate=c)
        layers.append(first_layer)

        for _time, viable in steps[1:]:
            prev_layer = layers[-1]
            layer: dict[VerseRef, _Node] = {}
            for c in viable:
                best_score = -1.0
                best_back: VerseRef | None = None
                for prev_ref, prev_node in prev_layer.items():
                    weight = self._transition_weight(prev_ref, c.span.ref)
                    total = prev_node.score * weight * c.score
                    if total > best_score:
                        best_score, best_back = total, prev_ref
                if c.span.ref not in layer or best_score > layer[c.span.ref].score:
                    layer[c.span.ref] = _Node(score=best_score, back_ref=best_back, candidate=c)
            layers.append(layer)
        return layers

    def _transition_weight(self, prev_ref: VerseRef, ref: VerseRef) -> float:
        w = self._config.weights
        if ref == prev_ref:
            return w.repetition
        if prev_ref.next() == ref:
            return w.next_verse
        gap = prev_ref.next()
        if gap is not None and gap.next() == ref:
            return w.one_verse_gap
        return w.arbitrary_jump

    def _backtrack(self, layers: list[dict[VerseRef, _Node]]) -> list[VerseRef]:
        last_layer = layers[-1]
        best_ref = max(last_layer, key=lambda r: last_layer[r].score)
        path: list[VerseRef] = []
        ref: VerseRef | None = best_ref
        for layer in reversed(layers):
            assert ref is not None
            path.append(ref)
            ref = layer[ref].back_ref
        path.reverse()
        return path

    # -- Construction des détections ------------------------------------------
    def _build_detections(
        self,
        steps: list[tuple[TimeSpan, list[Candidate]]],
        layers: list[dict[VerseRef, _Node]],
        path_refs: list[VerseRef],
    ) -> list[Detection]:
        detections: list[Detection] = []
        for (time, _viable), layer, ref in zip(steps, layers, path_refs, strict=True):
            node = layer[ref]
            best_score = node.score
            rival_scores = sorted((n.score for r, n in layer.items() if r != ref), reverse=True)
            status = Status.RECOGNIZED
            candidates: tuple[VerseRef, ...] = ()
            if rival_scores and rival_scores[0] >= best_score * self._config.uncertainty_ratio:
                status = Status.UNCERTAIN
                tied = {
                    r
                    for r, n in layer.items()
                    if n.score >= best_score * self._config.uncertainty_ratio
                }
                candidates = tuple(sorted({ref, *tied}))
            detections.append(
                Detection(
                    span=node.candidate.span,
                    time=time,
                    status=status,
                    confidence=node.candidate.score,
                    candidates=candidates,
                )
            )
        return detections

    # -- Post-traitement --------------------------------------------------------
    def _merge_repetitions(self, detections: list[Detection]) -> list[Detection]:
        merged: list[Detection] = []
        for det in detections:
            if (
                merged
                and merged[-1].status is Status.RECOGNIZED
                and det.status is Status.RECOGNIZED
                and merged[-1].span.ref == det.span.ref
            ):
                prev = merged[-1]
                # Les deux détections sont RECOGNIZED : leur `time` est garanti non nul
                # (invariant du domaine, cf. Detection.__post_init__).
                assert prev.time is not None
                assert det.time is not None
                merged[-1] = Detection(
                    span=WordSpan(
                        ref=prev.span.ref,
                        first_word=min(prev.span.first_word, det.span.first_word),
                        last_word=max(prev.span.last_word, det.span.last_word),
                    ),
                    time=TimeSpan(
                        start_s=min(prev.time.start_s, det.time.start_s),
                        end_s=max(prev.time.end_s, det.time.end_s),
                    ),
                    status=Status.RECOGNIZED,
                    confidence=min(prev.confidence, det.confidence),
                )
            else:
                merged.append(det)
        return merged

    def _fill_single_gaps(self, detections: list[Detection]) -> list[Detection]:
        if not detections:
            return detections
        result: list[Detection] = [detections[0]]
        for det in detections[1:]:
            prev = result[-1]
            if prev.status is Status.RECOGNIZED and det.status is Status.RECOGNIZED:
                gap_ref = prev.span.ref.next()
                if gap_ref is not None and gap_ref.next() == det.span.ref:
                    result.append(self._inferred_gap(gap_ref, prev, det))
            result.append(det)
        return result

    def _inferred_gap(self, gap_ref: VerseRef, prev: Detection, nxt: Detection) -> Detection:
        last_word = 1
        if self._corpus is not None:
            words = self._corpus.words(gap_ref)
            last_word = len(words) if words else 1
        span = WordSpan(ref=gap_ref, first_word=1, last_word=last_word)
        time: TimeSpan | None = None
        interpolated = False
        if prev.time is not None and nxt.time is not None and prev.time.end_s < nxt.time.start_s:
            time = TimeSpan(start_s=prev.time.end_s, end_s=nxt.time.start_s)
            interpolated = True
        return Detection(
            span=span,
            time=time,
            status=Status.INFERRED,
            confidence=0.0,
            time_interpolated=interpolated,
        )
