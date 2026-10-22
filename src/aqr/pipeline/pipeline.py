"""Pipeline B1 -> B2 -> fenêtres -> B4 -> B6 -> B7 : un fichier audio/vidéo -> intervalles.

Garde-fous (I3, I4, I5) :
- seul un verset dont le score du matcher passe le seuil du décodeur peut être nommé ; sinon la
  fenêtre est une **abstention** avec sa raison, jamais un verset par défaut ;
- les formules de prière et la basmala (hors 1:1 suivi de 1:2) sont `NON_QURAN` ;
- un verset manquant entre deux versets reconnus reste `INFERRED` (décodeur), jamais « reconnu » ;
- chaque détection porte le temps de ses fenêtres (pas début/fin du fichier), ou celui de
  l'alignement forcé du texte du corpus quand le modèle CTC est là (ADR-0008) ; les fenêtres sans
  candidat viable font barrière à la fusion de deux moitiés de verset ;
- avec le modèle CTC, une suite de versets n'est nommée que si l'audio soutient le texte du corpus
  de la suite (ADR-0008) ; sans lui, la preuve textuelle d'ADR-0007 décide seule ;
- une détection `uncertain` qui PROLONGE un verset reconnu voisin n'est promue que si, de plus,
  l'audio soutient le texte du corpus de sa plage (ADR-0010) ; sans le modèle CTC, jamais.
Le texte arabe et la traduction ne sont jamais produits ici : le rendu les lit dans les corpus.
"""

from __future__ import annotations

import time as _time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Protocol

from aqr.alignment.verification import AcousticVerifier, ChainCheck
from aqr.corpus.normalize import normalize_arabic
from aqr.decoding.chains import ChainConfig, promote_chains
from aqr.decoding.neighbors import NeighborConfig, Promotion, propose_promotions
from aqr.decoding.viterbi_decoder import DecoderConfig, ViterbiSequenceDecoder
from aqr.domain.models import (
    Detection,
    NonQuranKind,
    NonQuranSpan,
    Status,
    TimeSpan,
    VerseRef,
    WordSpan,
)
from aqr.domain.ports import (
    AudioClip,
    AudioExtractor,
    Candidate,
    CorpusRepository,
    QuranASR,
    SpeechSegmenter,
    Transcript,
    VerseMatcher,
)
from aqr.domain.quran_structure import is_basmala_only_span
from aqr.pipeline.formulae import FormulaConfig, classify_formula
from aqr.pipeline.result import (
    AbstentionReason,
    AbstentionSpan,
    EngineInfo,
    Interval,
    RecognitionResult,
)
from aqr.pipeline.windows import split_long_spans

CandidateVerifier = Callable[[AudioClip, TimeSpan, list[Candidate]], list[Candidate]]


class _BatchASR(Protocol):
    def transcribe_batch(self, clip: AudioClip, spans: Sequence[TimeSpan]) -> list[Transcript]: ...


@dataclass(frozen=True)
class PipelineConfig:
    max_window_s: float = 25.0
    """Fenêtre ASR maximale (Whisper : 30 s). Les segments plus longs sont coupés aux creux."""
    split_search_s: float = 2.0
    batch_size: int = 8
    top_k: int = 5
    silence_rms: float = 1e-4
    """Fenêtre d'énergie RMS inférieure : abstention `silence` plutôt que `empty_transcript`."""
    formula: FormulaConfig = field(default_factory=FormulaConfig)
    decoder: DecoderConfig = field(default_factory=DecoderConfig)
    chain: ChainConfig = field(default_factory=ChainConfig)
    """Preuve cumulée par la suite (étape B) : des versets courts consécutifs se confirment."""
    cascade: CascadeConfig = field(default_factory=lambda: CascadeConfig())
    """Réécoute des fenêtres douteuses par les moteurs secondaires (avec arbitre acoustique)."""
    neighbor: NeighborConfig = field(default_factory=NeighborConfig)
    """Promotion d'un début `uncertain` qui prolonge un verset reconnu voisin (avec l'audio)."""


@dataclass(frozen=True)
class CascadeConfig:
    relisten_min_quality: float = 0.3
    """Un candidat coranique au moins aussi ressemblant justifie une seconde oreille. Provisoire :
    sous ce seuil, la fenêtre est de la parole sans rapport (cours en français, wolof)."""
    relisten_neighbors: bool = True
    """Réécouter aussi les fenêtres voisines d'un verset retenu (la récitation y continue)."""


class RecognitionPipeline:
    def __init__(
        self,
        extractor: AudioExtractor,
        segmenter: SpeechSegmenter,
        asr: QuranASR,
        matcher: VerseMatcher,
        corpus: CorpusRepository,
        engine: EngineInfo,
        config: PipelineConfig | None = None,
        verifier: CandidateVerifier | None = None,
        acoustic: AcousticVerifier | None = None,
        secondary: Sequence[tuple[str, QuranASR]] = (),
        warnings: tuple[str, ...] = (),
        clock: Callable[[], float] = _time.perf_counter,
    ) -> None:
        self._extractor, self._segmenter, self._asr = extractor, segmenter, asr
        self._matcher, self._corpus = matcher, corpus
        self._config = config or PipelineConfig()
        self._engine = engine
        self._verifier = verifier
        self._acoustic = acoustic
        self._secondary = tuple(secondary)
        """Moteurs qui ne réécoutent que les fenêtres douteuses ; sans arbitre acoustique, aucun
        (un verset d'un autre moteur n'est jamais nommé sans que l'audio le soutienne, I3)."""
        self._warnings = warnings
        self._clock = clock
        self._basmala = tuple(normalize_arabic(w) for w in corpus.words(VerseRef(1, 1))[:4])
        self._decoder = ViterbiSequenceDecoder(self._config.decoder, corpus=corpus)

    def run(self, path: Path) -> RecognitionResult:
        timing: dict[str, float] = {}
        started = self._clock()

        mark = self._clock()
        clip = self._extractor.extract(path)
        timing["extract_s"] = self._clock() - mark
        rate = clip.sample_rate
        duration = len(clip.samples) / rate

        mark = self._clock()
        spans = self._segmenter.segment(clip)
        timing["segment_s"] = self._clock() - mark
        windows = split_long_spans(
            spans, clip.samples, rate, self._config.max_window_s, self._config.split_search_s
        )

        mark = self._clock()
        transcripts = self._transcribe(clip, windows)
        timing["asr_s"] = self._clock() - mark

        mark = self._clock()
        side: list[AbstentionSpan | NonQuranSpan] = []
        matched = [
            (window, self._classify(clip, window, transcript, side))
            for window, transcript in zip(windows, transcripts, strict=True)
        ]
        heard = [" ".join(w.text for w in t.words) for t in transcripts]
        timing["match_s"] = self._clock() - mark
        proven, checks = self._resolve(clip, matched, heard, side, timing)

        cascade: dict[str, object] | None = None
        if self._secondary and self._acoustic is not None:
            mark = self._clock()
            doubtful = self._doubtful(proven, side)
            relistens: list[ChainCheck] = []
            if doubtful:
                matched, heard, relistens = self._relisten(clip, matched, heard, doubtful, side)
                proven, checks = self._resolve(clip, matched, heard, side, timing)
                checks = (*checks, *relistens)
            floor = self._config.decoder.min_recognized_score
            rescued = sum(1 for i in doubtful if any(c.score >= floor for c in proven[i][1]))
            cascade = {
                "secondary": [name for name, _asr in self._secondary],
                "relistened_windows": len(doubtful),
                "rescued_windows": rescued,
            }
            timing["relisten_s"] = self._clock() - mark

        mark = self._clock()
        decided = self._decide(proven, side)
        timeline = self._decoder.decode(decided)
        timing["match_s"] += self._clock() - mark

        mark = self._clock()
        detections, promotions = self._promote_neighbors(clip, timeline.detections(), decided)
        if promotions:
            checks = (*checks, *promotions)
        if self._acoustic is not None:
            timing["acoustic_s"] = timing.get("acoustic_s", 0.0) + self._clock() - mark
        timing["total_s"] = self._clock() - started

        intervals = self._assemble(detections, side)
        return RecognitionResult(
            source_file=Path(path).name,
            duration_s=duration,
            intervals=tuple(intervals),
            engine=self._engine_info(),
            timing=timing,
            decoder_config=self._decoder_config(),
            windows=len(windows),
            warnings=self._run_warnings(),
            acoustic_checks=checks,
            riwaya=self._corpus.riwaya,
            cascade=cascade,
        )

    # -- Décision : preuve par la suite, vérifiée sur l'audio quand le modèle CTC est là ---------
    def _resolve(
        self,
        clip: AudioClip,
        matched: list[tuple[TimeSpan, list[Candidate]]],
        heard: Sequence[str],
        side: list[AbstentionSpan | NonQuranSpan],
        timing: dict[str, float],
    ) -> tuple[list[tuple[TimeSpan, list[Candidate]]], tuple[ChainCheck, ...]]:
        if self._acoustic is None:
            return promote_chains(matched, self._corpus, self._config.chain), ()
        mark = self._clock()
        blocked = self._blocked(matched, side)
        proven, checks = self._acoustic.verify(clip, matched, blocked, heard)
        timing["acoustic_s"] = timing.get("acoustic_s", 0.0) + self._clock() - mark
        return proven, checks

    # -- Promotion par le voisin reconnu (ADR-0010) ----------------------------------------------
    def _promote_neighbors(
        self,
        clip: AudioClip,
        detections: Sequence[Detection],
        observations: Sequence[tuple[TimeSpan, list[Candidate]]],
    ) -> tuple[list[Detection], tuple[ChainCheck, ...]]:
        """Un `uncertain` qui prolonge un verset `recognized` voisin devient `recognized` si l'audio
        soutient le texte du corpus de sa plage (même seuil que toute suite) ; sinon il reste ce
        qu'il était (I3). Une promotion peut en permettre une autre, de proche en proche."""
        out = list(detections)
        if self._acoustic is None or not self._config.neighbor.enabled:
            return out, ()
        floor = self._config.decoder.min_recognized_score
        barriers = [w for w, cands in observations if not any(c.score >= floor for c in cands)]
        checks: list[ChainCheck] = []
        tried: set[tuple[int, WordSpan]] = set()
        progress = True
        while progress:
            progress = False
            proposals = propose_promotions(
                out,
                observations,
                self._corpus,
                self._config.neighbor,
                floor=floor,
                max_gap_s=self._config.decoder.merge_max_gap_s,
                barriers=barriers,
            )
            for promotion in proposals:
                key = (promotion.index, promotion.candidate.span)
                if key in tried:
                    continue
                tried.add(key)
                check, confirmed = self._acoustic.verify_alone(
                    clip, promotion.window, promotion.candidate
                )
                checks.append(check)
                if confirmed is not None:
                    out[promotion.index] = self._promoted(promotion, confirmed)
                    progress = True
        return out, tuple(checks)

    @staticmethod
    def _promoted(promotion: Promotion, confirmed: Candidate) -> Detection:
        return Detection(
            span=confirmed.span,
            time=confirmed.times[0] if confirmed.times else promotion.window,
            status=Status.RECOGNIZED,
            confidence=confirmed.score,
            word_times=confirmed.word_times[0] if confirmed.word_times else (),
            promoted_by="neighbor",
        )

    @staticmethod
    def _blocked(
        matched: Sequence[tuple[TimeSpan, list[Candidate]]],
        side: Sequence[AbstentionSpan | NonQuranSpan],
    ) -> set[int]:
        formulae = {s.time for s in side if isinstance(s, NonQuranSpan)}
        return {i for i, (window, _c) in enumerate(matched) if window in formulae}

    # -- Cascade : réécoute des fenêtres douteuses par les moteurs secondaires ---------------------
    def _doubtful(
        self,
        proven: Sequence[tuple[TimeSpan, list[Candidate]]],
        side: Sequence[AbstentionSpan | NonQuranSpan],
    ) -> list[int]:
        """Fenêtres sans verset retenu qui méritent une seconde oreille : un candidat coranique
        de qualité suffisante, ou le voisinage d'un verset retenu (la récitation y continue
        souvent). Silence, formules et parole sans aucun candidat loin de tout verset : non."""
        floor = self._config.decoder.min_recognized_score
        cfg = self._config.cascade
        silent = {
            s.time
            for s in side
            if isinstance(s, AbstentionSpan) and s.reason is AbstentionReason.SILENCE
        }
        blocked = self._blocked(proven, side)
        kept = [any(c.score >= floor for c in cands) for _w, cands in proven]
        out: list[int] = []
        for i, (window, candidates) in enumerate(proven):
            if kept[i] or i in blocked or window in silent:
                continue
            promising = any((c.quality or 0.0) >= cfg.relisten_min_quality for c in candidates)
            beside = cfg.relisten_neighbors and (
                (i > 0 and kept[i - 1]) or (i + 1 < len(kept) and kept[i + 1])
            )
            if promising or beside:
                out.append(i)
        return out

    def _relisten(
        self,
        clip: AudioClip,
        matched: list[tuple[TimeSpan, list[Candidate]]],
        heard: list[str],
        doubtful: Sequence[int],
        side: list[AbstentionSpan | NonQuranSpan],
    ) -> tuple[list[tuple[TimeSpan, list[Candidate]]], list[str], list[ChainCheck]]:
        """Chaque moteur secondaire réécoute les fenêtres douteuses. Leurs candidats rejoignent
        ceux du moteur principal ; un candidat qui se suffit seul (score au seuil) n'est gardé que
        si l'audio soutient le texte du corpus (arbitre, I3) ; les autres ne peuvent devenir un
        verset que par une suite, que la vérification acoustique juge comme toute suite."""
        assert self._acoustic is not None
        floor = self._config.decoder.min_recognized_score
        windows = [matched[i][0] for i in doubtful]
        matched, heard = list(matched), list(heard)
        best = {i: _best_quality(matched[i][1]) for i in doubtful}
        checks: list[ChainCheck] = []
        for _name, asr in self._secondary:
            for i, transcript in zip(
                doubtful, _transcribe_with(asr, clip, windows, self._config.batch_size), strict=True
            ):
                window = matched[i][0]
                scratch: list[AbstentionSpan | NonQuranSpan] = []
                found = self._classify(clip, window, transcript, scratch)
                admitted: list[Candidate] = []
                for candidate in found:
                    if candidate.score >= floor:
                        llr = self._acoustic.supports(clip, window, candidate.spans)
                        threshold = self._acoustic.threshold
                        accepted = llr is not None and llr >= threshold
                        checks.append(
                            ChainCheck(window, candidate.spans, llr, accepted, kind="relisten")
                        )
                        if not accepted:
                            continue
                    admitted.append(candidate)
                if not admitted:
                    continue
                matched[i] = (window, _merge(matched[i][1], admitted))
                if _best_quality(admitted) > best[i]:
                    best[i] = _best_quality(admitted)
                    heard[i] = " ".join(w.text for w in transcript.words)
                side[:] = [
                    s
                    for s in side
                    if not (
                        isinstance(s, AbstentionSpan)
                        and s.time == window
                        and s.reason
                        in (AbstentionReason.NO_CANDIDATE, AbstentionReason.EMPTY_TRANSCRIPT)
                    )
                ]
        return matched, heard, checks

    def _engine_info(self) -> EngineInfo:
        if self._acoustic is None:
            return self._engine
        return replace(self._engine, acoustic=self._acoustic.engine)

    def _decoder_config(self) -> dict[str, float]:
        cfg = self._config.decoder
        out = {
            "min_recognized_score": cfg.min_recognized_score,
            "uncertainty_ratio": cfg.uncertainty_ratio,
            "merge_max_gap_s": cfg.merge_max_gap_s,
            "infer_max_gap_s": cfg.infer_max_gap_s,
            "chain_evidence_words": (
                self._config.chain.evidence_words if self._config.chain.enabled else 0.0
            ),
        }
        if self._acoustic is not None:
            check = self._acoustic.config
            assert check.min_llr_per_frame is not None  # garanti par AcousticVerifier
            out["acoustic_min_llr_per_frame"] = check.min_llr_per_frame
            out["acoustic_rescue_min_quality"] = check.rescue_min_quality
            if self._config.neighbor.enabled:
                out["neighbor_max_overlap_words"] = float(self._config.neighbor.max_overlap_words)
                out["neighbor_max_gap_words"] = float(self._config.neighbor.max_gap_words)
        return out

    def _run_warnings(self) -> tuple[str, ...]:
        extra: tuple[str, ...] = ()
        if getattr(self._segmenter, "last_used", "primary") == "fallback":
            error = getattr(self._segmenter, "last_error", "")
            extra = (f"le segmenteur principal a échoué, repli Silero utilisé ({error})",)
        return (*self._warnings, *extra)

    # -- ASR -------------------------------------------------------------------------------
    def _transcribe(self, clip: AudioClip, windows: Sequence[TimeSpan]) -> list[Transcript]:
        return _transcribe_with(self._asr, clip, windows, self._config.batch_size)

    # -- Une fenêtre : formule, abstention ou candidats --------------------------------------
    def _classify(
        self,
        clip: AudioClip,
        window: TimeSpan,
        transcript: Transcript,
        side: list[AbstentionSpan | NonQuranSpan],
    ) -> list[Candidate]:
        text = normalize_arabic(" ".join(w.text for w in transcript.words))
        if not text:
            reason = (
                AbstentionReason.SILENCE
                if self._rms(clip, window) < self._config.silence_rms
                else AbstentionReason.EMPTY_TRANSCRIPT
            )
            side.append(AbstentionSpan(window, reason))
            return []
        kind = classify_formula(text.split(), self._basmala, self._config.formula)
        if kind is not None and kind is not NonQuranKind.BASMALA:
            side.append(NonQuranSpan(window, kind))
            return []
        candidates = self._matcher.match(text, top_k=self._config.top_k)
        if self._verifier is not None and candidates:
            candidates = self._verifier(clip, window, candidates)
        if not candidates:
            side.append(AbstentionSpan(window, AbstentionReason.NO_CANDIDATE, None))
        return candidates

    def _decide(
        self,
        observations: Sequence[tuple[TimeSpan, list[Candidate]]],
        side: list[AbstentionSpan | NonQuranSpan],
    ) -> list[tuple[TimeSpan, list[Candidate]]]:
        """Abstention `below_threshold` APRÈS la preuve par la suite : une fenêtre dont aucun
        candidat n'atteint le seuil du décodeur n'entre pas dans le décodage (I3)."""
        threshold = self._config.decoder.min_recognized_score
        out: list[tuple[TimeSpan, list[Candidate]]] = []
        for window, candidates in observations:
            best = max((c.score for c in candidates), default=None)
            if best is not None and best < threshold:
                side.append(AbstentionSpan(window, AbstentionReason.BELOW_THRESHOLD, best))
                candidates = []
            out.append((window, candidates))
        return out

    @staticmethod
    def _rms(clip: AudioClip, window: TimeSpan) -> float:
        rate = clip.sample_rate
        chunk = clip.samples[round(window.start_s * rate) : round(window.end_s * rate)]
        if not len(chunk):
            return 0.0
        return float((sum(x * x for x in chunk) / len(chunk)) ** 0.5)

    # -- Assemblage ----------------------------------------------------------------------------
    def _assemble(
        self, detections: Sequence[Detection], side: list[AbstentionSpan | NonQuranSpan]
    ) -> list[Interval]:
        """Ordre chronologique ; un verset INFERRED sans temps suit son prédécesseur."""
        keyed: list[tuple[float, int, Interval]] = []
        previous_end = 0.0
        for item in self._relabel_basmala(detections):
            time = item.time
            if time is None:
                keyed.append((previous_end, 0, item))
            else:
                keyed.append((time.start_s, 0, item))
                previous_end = time.end_s
        keyed.extend((s.time.start_s, 1, s) for s in side)
        return [item for _start, _rank, item in sorted(keyed, key=lambda k: (k[0], k[1]))]

    def _relabel_basmala(self, detections: Sequence[Detection]) -> list[Interval]:
        """1:1 non suivi de 1:2, ou plage de mots ne couvrant que la basmala d'un verset 1 :
        c'est la basmala d'ouverture d'une sourate (NON_QURAN), pas la récitation d'un verset."""
        out: list[Interval] = []
        for index, det in enumerate(detections):
            ref, span = det.span.ref, det.span
            nxt = detections[index + 1] if index + 1 < len(detections) else None
            opening_fatiha = (
                ref == VerseRef(1, 1) and nxt is not None and nxt.span.ref == VerseRef(1, 2)
            )
            only_basmala = det.time is not None and (
                (ref == VerseRef(1, 1) and span.first_word == 1 and span.last_word <= 4)
                or is_basmala_only_span(ref.surah, ref.ayah, span.first_word, span.last_word)
            )
            if only_basmala and not opening_fatiha and det.time is not None:
                out.append(NonQuranSpan(det.time, NonQuranKind.BASMALA))
            else:
                out.append(det)
        return out


def _transcribe_with(
    asr: QuranASR, clip: AudioClip, windows: Sequence[TimeSpan], step: int
) -> list[Transcript]:
    batch = getattr(asr, "transcribe_batch", None)
    if batch is None:
        return [asr.transcribe(clip, w) for w in windows]
    out: list[Transcript] = []
    for i in range(0, len(windows), step):
        out.extend(batch(clip, windows[i : i + step]))
    return out


def _best_quality(candidates: Sequence[Candidate]) -> float:
    return max(((c.quality or 0.0) for c in candidates), default=0.0)


def _merge(first: Sequence[Candidate], second: Sequence[Candidate]) -> list[Candidate]:
    """Candidats de deux oreilles pour une même fenêtre : une position du Coran n'apparaît qu'une
    fois (celle de meilleur score), ordre par score décroissant."""
    kept: dict[tuple[object, ...], Candidate] = {}
    for candidate in (*first, *second):
        key = tuple((s.ref, s.first_word, s.last_word) for s in candidate.spans)
        if key not in kept or candidate.score > kept[key].score:
            kept[key] = candidate
    return sorted(kept.values(), key=lambda c: -c.score)
