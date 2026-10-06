"""Pipeline B1 -> B2 -> fenêtres -> B4 -> B6 -> B7 : un fichier audio/vidéo -> intervalles.

Garde-fous (I3, I4, I5) :
- seul un verset dont le score du matcher passe le seuil du décodeur peut être nommé ; sinon la
  fenêtre est une **abstention** avec sa raison, jamais un verset par défaut ;
- les formules de prière et la basmala (hors 1:1 suivi de 1:2) sont `NON_QURAN` ;
- un verset manquant entre deux versets reconnus reste `INFERRED` (décodeur), jamais « reconnu » ;
- chaque détection porte le temps de ses fenêtres (pas début/fin du fichier) ; les fenêtres sans
  candidat viable font barrière à la fusion de deux moitiés de verset.
Le texte arabe et la traduction ne sont jamais produits ici : le rendu les lit dans les corpus.
"""

from __future__ import annotations

import time as _time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from aqr.corpus.normalize import normalize_arabic
from aqr.decoding.viterbi_decoder import DecoderConfig, ViterbiSequenceDecoder
from aqr.domain.models import (
    Detection,
    NonQuranKind,
    NonQuranSpan,
    TimeSpan,
    VerseRef,
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
        warnings: tuple[str, ...] = (),
        clock: Callable[[], float] = _time.perf_counter,
    ) -> None:
        self._extractor, self._segmenter, self._asr = extractor, segmenter, asr
        self._matcher, self._corpus = matcher, corpus
        self._config = config or PipelineConfig()
        self._engine = engine
        self._verifier = verifier
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
        observations: list[tuple[TimeSpan, list[Candidate]]] = []
        side: list[AbstentionSpan | NonQuranSpan] = []
        for window, transcript in zip(windows, transcripts, strict=True):
            candidates = self._classify(clip, window, transcript, side)
            observations.append((window, candidates))
        timeline = self._decoder.decode(observations)
        timing["match_s"] = self._clock() - mark
        timing["total_s"] = self._clock() - started

        intervals = self._assemble(timeline.detections(), side)
        cfg = self._config.decoder
        return RecognitionResult(
            source_file=Path(path).name,
            duration_s=duration,
            intervals=tuple(intervals),
            engine=self._engine,
            timing=timing,
            decoder_config={
                "min_recognized_score": cfg.min_recognized_score,
                "uncertainty_ratio": cfg.uncertainty_ratio,
                "merge_max_gap_s": cfg.merge_max_gap_s,
                "infer_max_gap_s": cfg.infer_max_gap_s,
            },
            windows=len(windows),
            warnings=self._run_warnings(),
        )

    def _run_warnings(self) -> tuple[str, ...]:
        extra: tuple[str, ...] = ()
        if getattr(self._segmenter, "last_used", "primary") == "fallback":
            error = getattr(self._segmenter, "last_error", "")
            extra = (f"le segmenteur principal a échoué, repli Silero utilisé ({error})",)
        return (*self._warnings, *extra)

    # -- ASR -------------------------------------------------------------------------------
    def _transcribe(self, clip: AudioClip, windows: Sequence[TimeSpan]) -> list[Transcript]:
        batch = getattr(self._asr, "transcribe_batch", None)
        if batch is None:
            return [self._asr.transcribe(clip, w) for w in windows]
        out: list[Transcript] = []
        step = self._config.batch_size
        for i in range(0, len(windows), step):
            out.extend(batch(clip, windows[i : i + step]))
        return out

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
        threshold = self._config.decoder.min_recognized_score
        best = candidates[0].score if candidates else None
        if not candidates or (best is not None and best < threshold):
            reason = (
                AbstentionReason.NO_CANDIDATE
                if not candidates
                else AbstentionReason.BELOW_THRESHOLD
            )
            side.append(AbstentionSpan(window, reason, best))
            return []
        return candidates

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
