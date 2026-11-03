"""Essai v0 (script ad hoc des essais du 2026-10-06, versionné TEL QUEL à ces deux lignes près :
racine du dépôt et en-tête). Remplacé par la commande `aqr recognize` (PR pipeline) ;
gardé pour rejouer les essais initiaux.

Essai ad hoc : chaîne réelle sur un audio du lot 1, CPU.

B1 ffmpeg -> B2 Silero VAD (+ découpe dure à 25 s, ad hoc) -> B4 Whisper-Tarteel (épinglé)
-> B6 FlowVerseMatcher -> B7 Viterbi. Aucune vérité terrain : ce script ne calcule pas de taux,
il écrit tout ce qu'il observe dans un JSON.
usage: trial.py <audio> <out.json> <models_dir> <start_s> <dur_s|0>
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

from aqr.adapters.ffmpeg_extractor import FfmpegAudioExtractor
from aqr.adapters.segmenters import (
    RecitationSegmenterConfig,
    RecitationSegmenterV2,
    SileroVadSegmenter,
)
from aqr.adapters.whisper_tarteel import WhisperTarteelASR, WhisperTarteelConfig
from aqr.corpus.imlai_corrections import build_word_corrections, load_simple_clean_words
from aqr.corpus.normalize import normalize_arabic
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.decoding.viterbi_decoder import DecoderConfig, ViterbiSequenceDecoder
from aqr.domain.models import TimeSpan
from aqr.matching.flow_matcher import FlowVerseMatcher

audio, out, models_dir, start_s, dur_s = sys.argv[1:6]
start_s, dur_s = float(start_s), float(dur_s)
root = Path(__file__).resolve().parents[2]  # racine du dépôt (v0 : lancé depuis un worktree)
corpus_dir = root / "data" / "corpus"
MAX_SEG = 25.0

t = {}
t0 = time.perf_counter()
clip = FfmpegAudioExtractor().extract(Path(audio))
t["extract_s"] = time.perf_counter() - t0
total = len(clip.samples) / clip.sample_rate
end_s = total if dur_s <= 0 else min(total, start_s + dur_s)

t0 = time.perf_counter()
SEG = os.environ.get("SEG", "silero")
if SEG == "v2":
    segmenter = RecitationSegmenterV2(
        RecitationSegmenterConfig(
            models_dir=Path(models_dir), lock_path=root / "models" / "LOCK.json", device="cpu"
        )
    )
else:
    segmenter = SileroVadSegmenter()
spans = [s for s in segmenter.segment(clip) if s.end_s > start_s and s.start_s < end_s]
t["vad_s"] = time.perf_counter() - t0
pieces: list[TimeSpan] = []
cut = 0
for s in spans:
    a, b = max(s.start_s, start_s), min(s.end_s, end_s)
    if b - a <= 0.08:
        continue
    n = max(1, int(-(-(b - a) // MAX_SEG)))
    if n > 1:
        cut += 1
    step = (b - a) / n
    pieces.extend(TimeSpan(a + i * step, a + (i + 1) * step) for i in range(n))

t0 = time.perf_counter()
asr = WhisperTarteelASR(
    WhisperTarteelConfig(
        models_dir=Path(models_dir),
        lock_path=root / "models" / "LOCK.json",
        device="cpu",
        batch_size=4,
    )
)
transcripts = []
B = 16
for i in range(0, len(pieces), B):
    transcripts.extend(asr.transcribe_batch(clip, pieces[i : i + B]))
t["asr_s"] = time.perf_counter() - t0

corpus = TanzilCorpusRepository(corpus_dir)
corr = build_word_corrections(corpus, load_simple_clean_words(corpus_dir))
matcher = FlowVerseMatcher(corpus, word_corrections=corr)
cfg = DecoderConfig()
t0 = time.perf_counter()
observations = []
rows = []
for span, tr in zip(pieces, transcripts, strict=True):
    text = normalize_arabic(" ".join(w.text for w in tr.words))
    cands = matcher.match(text) if text else []
    observations.append((span, cands))
    best = cands[0] if cands else None
    rows.append(
        {
            "t": [round(span.start_s, 2), round(span.end_s, 2)],
            "text": " ".join(w.text for w in tr.words),
            "n_words": len(text.split()),
            "top": None
            if best is None
            else {
                "refs": [str(r) for r in best.refs],
                "spans": [[s.first_word, s.last_word] for s in best.spans],
                "score": round(best.score, 3),
            },
            "rival": None
            if len(cands) < 2
            else {"refs": [str(r) for r in cands[1].refs], "score": round(cands[1].score, 3)},
        }
    )
t["match_s"] = time.perf_counter() - t0
timeline = ViterbiSequenceDecoder(cfg, corpus=corpus).decode(observations)
dets = [
    {
        "ref": str(d.span.ref),
        "words": [d.span.first_word, d.span.last_word],
        "t": None if d.time is None else [round(d.time.start_s, 2), round(d.time.end_s, 2)],
        "status": d.status.value,
        "conf": round(d.confidence, 3),
        "candidates": [str(c) for c in d.candidates],
        "interp": d.time_interpolated,
    }
    for d in timeline.detections()
]
Path(out).write_text(
    json.dumps(
        {
            "audio": Path(audio).name,
            "window_s": [start_s, end_s],
            "audio_s": round(total, 1),
            "engine": asr.engine,
            "segmenter": (
                "recitation-segmenter-v2@5ee90364e709" if SEG == "v2" else "silero-vad 6.2.3"
            )
            + " (+ découpe dure 25 s ad hoc)",
            "n_vad_spans": len(spans),
            "n_hard_cut": cut,
            "n_pieces": len(pieces),
            "timing": {k: round(v, 1) for k, v in t.items()},
            "decoder": {
                "min_recognized_score": cfg.min_recognized_score,
                "uncertainty_ratio": cfg.uncertainty_ratio,
            },
            "segments": rows,
            "detections": dets,
        },
        ensure_ascii=False,
        indent=1,
    ),
    encoding="utf-8",
)
print(json.dumps({"timing": t, "pieces": len(pieces), "detections": len(dets)}))
