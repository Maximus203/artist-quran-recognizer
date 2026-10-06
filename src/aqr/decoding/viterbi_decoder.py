"""SequenceDecoder (port B7) : Viterbi sur le graphe des versets.

États = candidats (VerseRef) proposés par le VerseMatcher pour chaque segment
observé. Transitions pondérées (continuité, répétition, trou d'un verset, saut
arbitraire) — cf. docs/ARCHITECTURE.md §4 piège n°2. Les poids sont un objet de
configuration (`DecoderWeights`), jamais des constantes éparpillées dans la logique
(cf. CLAUDE.md : "seuils et probabilités = configuration calibrée par benchmark").
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field, replace

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
    merge_max_gap_s: float = 5.0
    """Deux moitiés contiguës d'un même verset ne fusionnent que si moins de ce nombre de secondes
    les sépare : au-delà, l'union couvrirait des passages non reconnus. Provisoire (phase 6 : à
    calibrer sur des annotations humaines)."""
    infer_max_gap_s: float = 180.0
    """Un verset manquant entre deux versets reconnus n'est supposé (INFERRED) que si l'écart
    temporel est plausible pour un verset ; au-delà (autre chose a été dit), aucune hypothèse.
    Provisoire (phase 6)."""
    engine_version: str = "viterbi-decoder-v2"


# Un état = les versets d'un candidat (un seul, ou plusieurs si le segment les traverse).
_Key = tuple[VerseRef, ...]


@dataclass
class _Node:
    score: float
    back_ref: _Key | None
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
        path_keys = self._backtrack(layers)
        detections = self._build_detections(steps, layers, path_keys)
        detections = self._merge_repetitions(detections)
        detections = self._fill_single_gaps(detections)
        return Timeline(
            items=tuple(detections), riwaya=self._riwaya, engine_version=self._config.engine_version
        )

    # -- Viterbi forward pass -------------------------------------------------
    def _forward(self, steps: list[tuple[TimeSpan, list[Candidate]]]) -> list[dict[_Key, _Node]]:
        layers: list[dict[_Key, _Node]] = []
        _time0, first_viable = steps[0]
        first_layer: dict[_Key, _Node] = {}
        for c in first_viable:
            if c.refs not in first_layer or c.score > first_layer[c.refs].score:
                first_layer[c.refs] = _Node(score=c.score, back_ref=None, candidate=c)
        layers.append(first_layer)

        for _time, viable in steps[1:]:
            prev_layer = layers[-1]
            layer: dict[_Key, _Node] = {}
            for c in viable:
                best_score = -1.0
                best_back: _Key | None = None
                for prev_key, prev_node in prev_layer.items():
                    weight = self._transition_weight(prev_key[-1], c.span.ref)
                    total = prev_node.score * weight * c.score
                    if total > best_score:
                        best_score, best_back = total, prev_key
                if c.refs not in layer or best_score > layer[c.refs].score:
                    layer[c.refs] = _Node(score=best_score, back_ref=best_back, candidate=c)
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

    def _backtrack(self, layers: list[dict[_Key, _Node]]) -> list[_Key]:
        last_layer = layers[-1]
        best_key = max(last_layer, key=lambda k: last_layer[k].score)
        path: list[_Key] = []
        key: _Key | None = best_key
        for layer in reversed(layers):
            assert key is not None
            path.append(key)
            key = layer[key].back_ref
        path.reverse()
        return path

    # -- Construction des détections ------------------------------------------
    def _build_detections(
        self,
        steps: list[tuple[TimeSpan, list[Candidate]]],
        layers: list[dict[_Key, _Node]],
        path_keys: list[_Key],
    ) -> list[Detection]:
        detections: list[Detection] = []
        for (time, _viable), layer, key in zip(steps, layers, path_keys, strict=True):
            node = layer[key]
            best_score = node.score
            rival_scores = sorted((n.score for k, n in layer.items() if k != key), reverse=True)
            status = Status.RECOGNIZED
            candidates: tuple[VerseRef, ...] = ()
            if rival_scores and rival_scores[0] >= best_score * self._config.uncertainty_ratio:
                status = Status.UNCERTAIN
                tied = [
                    k
                    for k, n in layer.items()
                    if n.score >= best_score * self._config.uncertainty_ratio
                ]
                candidates = tuple(sorted({ref for k in (key, *tied) for ref in k}))
            detections.extend(self._detections_of(node.candidate, time, status, candidates))
        return detections

    def _detections_of(
        self,
        candidate: Candidate,
        time: TimeSpan,
        status: Status,
        candidates: tuple[VerseRef, ...],
    ) -> list[Detection]:
        """Une détection par verset touché. Le temps du segment est réparti au prorata
        des mots expliqués dans chaque verset ; la coupure interne est estimée
        (`time_interpolated`), le segment lui-même est mesuré."""
        spans = candidate.spans
        if len(spans) == 1:
            return [
                Detection(
                    span=spans[0],
                    time=time,
                    status=status,
                    confidence=candidate.score,
                    candidates=candidates,
                )
            ]
        weights = (
            candidate.query_counts
            if len(candidate.query_counts) == len(spans)
            else tuple(s.last_word - s.first_word + 1 for s in spans)
        )
        total = sum(weights)
        detections: list[Detection] = []
        cursor = time.start_s
        for index, (span, weight) in enumerate(zip(spans, weights, strict=True)):
            end = (
                time.end_s if index == len(spans) - 1 else cursor + time.duration_s * weight / total
            )
            detections.append(
                Detection(
                    span=span,
                    time=TimeSpan(start_s=cursor, end_s=end),
                    status=status,
                    confidence=candidate.score,
                    time_interpolated=True,
                    candidates=candidates,
                )
            )
            cursor = end
        return detections

    # -- Post-traitement --------------------------------------------------------
    def _merge_repetitions(self, detections: list[Detection]) -> list[Detection]:
        """Moitiés contiguës proches dans le temps -> une détection ; mots redits -> deux
        détections, la seconde marquée répétition (chacune garde son temps)."""
        merged: list[Detection] = []
        for det in detections:
            prev = merged[-1] if merged else None
            if (
                prev is None
                or prev.status is not Status.RECOGNIZED
                or det.status is not Status.RECOGNIZED
                or prev.span.ref != det.span.ref
            ):
                merged.append(det)
                continue
            # Les deux détections sont RECOGNIZED : leur `time` est garanti non nul (domaine).
            assert prev.time is not None
            assert det.time is not None
            if det.span.first_word <= prev.span.last_word:
                merged.append(replace(det, is_repetition=True))
            elif det.time.start_s - prev.time.end_s <= self._config.merge_max_gap_s:
                merged[-1] = Detection(
                    span=WordSpan(
                        ref=prev.span.ref,
                        first_word=prev.span.first_word,
                        last_word=det.span.last_word,
                    ),
                    time=TimeSpan(start_s=prev.time.start_s, end_s=det.time.end_s),
                    status=Status.RECOGNIZED,
                    confidence=min(prev.confidence, det.confidence),
                    is_repetition=prev.is_repetition,
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
                if (
                    gap_ref is not None
                    and gap_ref.next() == det.span.ref
                    and self._gap_is_plausible(prev, det)
                ):
                    result.append(self._inferred_gap(gap_ref, prev, det))
            result.append(det)
        return result

    def _gap_is_plausible(self, prev: Detection, nxt: Detection) -> bool:
        if prev.time is None or nxt.time is None:
            return True
        return nxt.time.start_s - prev.time.end_s <= self._config.infer_max_gap_s

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
