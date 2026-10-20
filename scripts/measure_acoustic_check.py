#!/usr/bin/env python3
"""Mesure de la vérification acoustique des suites (ADR-0008) : avec / sans, MÊMES transcriptions.

Chaque fichier passe une fois par le segmenteur et l'ASR (mis en cache), puis deux décisions :
- `texte` : preuve par la suite sur le texte seul (ADR-0007), temps = bords des fenêtres ;
- `audio` : suites vérifiées sur le treillis du FastConformer, temps de l'alignement (ADR-0008).

Corpus mesurés :
- `--everyayah DIR` : sourates reconstituées (clips EveryAyah mis bout à bout) ; versets attendus
  connus -> rappel `recognized`, faux versets, erreur des limites contre l'étendue d'énergie de
  chaque clip (référence approchée, cf. scripts/measure_alignment.py) ; preuve `llr_per_frame` des
  suites vraies / fausses (calibrage du seuil) ;
- `--micro SESSION...` : enregistrements micro (dossiers de session de l'atelier), passés par
  chaque ASR de `--asrs` ; versets attendus `--micro-expected` ;
- `--lot FICHIER...` : audio réel sans vérité terrain ; versets nouveaux et perdus, avec la
  transcription des fenêtres derrière chacun (à relire : ni juste ni faux par principe).

Usage :
    python scripts/measure_acoustic_check.py --models-dir $AQR_MODELS_DIR \\
        --everyayah $AQR_AUDIO_DIR/everyayah --out mesure.json
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

from aqr.adapters.ffmpeg_extractor import FfmpegAudioExtractor
from aqr.corpus.alignment_text import recited_span
from aqr.domain.models import Detection, Status, TimeSpan, VerseRef
from aqr.domain.ports import AudioClip, Transcript
from aqr.pipeline.factory import RecognizeOptions, build_recognizer
from aqr.pipeline.pipeline import RecognitionPipeline
from aqr.pipeline.result import RecognitionResult

sys.path.insert(0, str(Path(__file__).resolve().parent))
from measure_alignment import passages, summary

MODES = ("texte", "audio")


@dataclass
class _Memory:
    """Extraction, segmentation et transcription faites une fois, rejouées pour chaque décision."""

    clips: dict[str, AudioClip] = field(default_factory=dict)
    spans: dict[str, list[TimeSpan]] = field(default_factory=dict)
    transcripts: dict[tuple[str, TimeSpan], Transcript] = field(default_factory=dict)


class _Extractor:
    def __init__(self, memory: _Memory) -> None:
        self._memory, self._ffmpeg = memory, FfmpegAudioExtractor()

    def extract(self, path: Path) -> AudioClip:
        key = str(path)
        if key not in self._memory.clips:
            self._memory.clips[key] = self._ffmpeg.extract(path)
        return self._memory.clips[key]


class _Segmenter:
    def __init__(self, inner: Any, memory: _Memory) -> None:
        self._inner, self._memory = inner, memory

    def segment(self, clip: AudioClip) -> list[TimeSpan]:
        if clip.source not in self._memory.spans:
            self._memory.spans[clip.source] = self._inner.segment(clip)
        return self._memory.spans[clip.source]


class _ASR:
    def __init__(self, inner: Any, memory: _Memory) -> None:
        self._inner, self._memory = inner, memory
        self.riwaya = inner.riwaya

    def transcribe(self, clip: AudioClip, span: TimeSpan) -> Transcript:
        return self.transcribe_batch(clip, [span])[0]

    def transcribe_batch(self, clip: AudioClip, spans: Sequence[TimeSpan]) -> list[Transcript]:
        missing = [s for s in spans if (clip.source, s) not in self._memory.transcripts]
        if missing:
            batch = getattr(self._inner, "transcribe_batch", None)
            done = (
                batch(clip, missing)
                if batch
                else [self._inner.transcribe(clip, s) for s in missing]
            )
            for span, transcript in zip(missing, done, strict=True):
                self._memory.transcripts[(clip.source, span)] = transcript
        return [self._memory.transcripts[(clip.source, s)] for s in spans]


class Bench:
    """Deux pipelines (texte / audio) sur les mêmes composants mis en cache, pour un ASR."""

    def __init__(self, asr: str, args: argparse.Namespace) -> None:
        options = RecognizeOptions(
            asr=asr,
            models_dir=args.models_dir,
            lock_path=args.lock,
            corpus_dir=args.corpus_dir,
            translation_id=None,
            device=args.device,
        )
        real = build_recognizer(options, {}).pipeline
        if real._acoustic is None:
            raise SystemExit(f"vérification acoustique indisponible : {real._warnings}")
        self.memory = _Memory()
        parts = (
            _Extractor(self.memory),
            _Segmenter(real._segmenter, self.memory),
            _ASR(real._asr, self.memory),
            real._matcher,
            real._corpus,
            real._engine,
        )
        self.corpus = real._corpus
        self.pipelines = {
            "texte": RecognitionPipeline(*parts, config=real._config),
            "audio": RecognitionPipeline(*parts, config=real._config, acoustic=real._acoustic),
        }

    def run(self, path: Path, clip: AudioClip | None = None) -> dict[str, RecognitionResult]:
        if clip is not None:
            self.memory.clips[str(path)] = clip
        return {mode: pipe.run(path) for mode, pipe in self.pipelines.items()}

    def heard(self, clip_source: str, time: TimeSpan | None) -> str:
        """Transcriptions de l'ASR des fenêtres qui recouvrent `time` (pour relire un verset)."""
        if time is None:
            return ""
        return " | ".join(
            " ".join(w.text for w in t.words)
            for (source, span), t in sorted(
                self.memory.transcripts.items(), key=lambda i: i[0][1].start_s
            )
            if source == clip_source and span.start_s < time.end_s and time.start_s < span.end_s
        )


def recognized(result: RecognitionResult) -> list[Detection]:
    return [d for d in result.detections() if d.status is Status.RECOGNIZED]


def label(det: Detection) -> str:
    span = det.span
    t = "" if det.time is None else f" {det.time.start_s:.2f}-{det.time.end_s:.2f}"
    return f"{span.ref}[{span.first_word}-{span.last_word}]{t}"


def checks(result: RecognitionResult) -> list[dict[str, Any]]:
    return [
        {
            "t": [round(c.time.start_s, 2), round(c.time.end_s, 2)],
            "verses": ",".join(f"{s.ref}[{s.first_word}-{s.last_word}]" for s in c.spans),
            "refs": sorted({str(s.ref) for s in c.spans}),
            "llr_per_frame": None if c.llr_per_frame is None else round(c.llr_per_frame, 3),
            "accepted": c.accepted,
        }
        for c in result.acoustic_checks
    ]


def everyayah(bench: Bench, root: Path) -> dict[str, Any]:
    extractor = FfmpegAudioExtractor()
    corpus = bench.corpus
    totals: dict[str, dict[str, Any]] = {m: {"expected": 0, "found": 0, "false": []} for m in MODES}
    errors: dict[str, dict[str, list[float]]] = {m: {"start": [], "end": []} for m in MODES}
    llr: dict[str, list[float]] = {"true": [], "false": []}
    false_checks: list[dict[str, Any]] = []
    per_verse: dict[str, list[tuple[float, float, str]]] = {m: [] for m in MODES}
    acoustic_s = 0.0
    for reciter in sorted(p for p in root.iterdir() if p.is_dir()):
        for clip, placed in passages(reciter, extractor, 1e9, 0.05):
            path = Path(f"{reciter.name}-{placed[0].ref.surah:03d}.wav")
            clip = replace(clip, source=str(path))
            expected = {p.ref: p.speech for p in placed}
            results = bench.run(path, clip)
            acoustic_s += results["audio"].timing.get("acoustic_s", 0.0)
            line = [f"{reciter.name[:10]} {placed[0].ref.surah:3d} ({len(expected)} v.)"]
            timed: dict[str, dict[VerseRef, Detection]] = {}
            for mode, result in results.items():
                dets = recognized(result)
                refs = {d.span.ref for d in dets}
                false = sorted(str(r) for r in refs - set(expected))
                totals[mode]["expected"] += len(expected)
                totals[mode]["found"] += len(refs & set(expected))
                totals[mode]["false"] += [f"{path.stem}:{r}" for r in false]
                timed[mode] = {
                    d.span.ref: d
                    for d in dets
                    if d.span.ref in expected
                    and d.time is not None
                    and [x.span.ref for x in dets].count(d.span.ref) == 1
                    and d.span == recited_span(d.span.ref, len(corpus.words(d.span.ref)))
                }
                line.append(
                    f"{mode}: {len(refs & set(expected))}/{len(expected)} faux {false or 0}"
                )
            # Limites : versets reconnus ENTIERS (une détection, toute la plage récitée) dans les
            # deux modes, comparés sur le même ensemble (une détection partielle mesure la
            # reconnaissance, pas la limite).
            for ref in sorted(set(timed["texte"]) & set(timed["audio"])):
                for mode in MODES:
                    time, truth_time = timed[mode][ref].time, expected[ref]
                    assert time is not None
                    start_ms = 1000 * (time.start_s - truth_time.start_s)
                    end_ms = 1000 * (time.end_s - truth_time.end_s)
                    errors[mode]["start"].append(start_ms)
                    errors[mode]["end"].append(end_ms)
                    per_verse[mode].append((start_ms, end_ms, f"{path.stem} {ref}"))
            for check in checks(results["audio"]):
                if check["llr_per_frame"] is not None:
                    truth = all(VerseRef.parse(r) in expected for r in check["refs"])
                    llr["true" if truth else "false"].append(check["llr_per_frame"])
                    if not truth:
                        false_checks.append({"file": path.stem, **check})
            print(" · ".join(line), flush=True)
    out: dict[str, Any] = {
        "acoustic_s": round(acoustic_s, 1),
        "llr": _llr_summary(llr),
        "false_checks": false_checks,
    }
    for check in false_checks:
        print(f"   suite hors sourate : {check}")
    for mode in MODES:
        n, found = totals[mode]["expected"], totals[mode]["found"]
        out[mode] = {
            "recall": f"{found}/{n} = {found / n:.1%}",
            "false_verses": totals[mode]["false"],
            "start": summary(errors[mode]["start"]),
            "end": summary(errors[mode]["end"]),
            "worst_end": sorted(per_verse[mode], key=lambda e: -abs(e[1]))[:15],
        }
        print(f"TOTAL {mode} : rappel {out[mode]['recall']} · faux {len(totals[mode]['false'])}")
        print(f"   limites début {out[mode]['start']} · fin {out[mode]['end']}")
        for start_ms, end_ms, where in out[mode]["worst_end"]:
            print(f"      fin {end_ms:+.0f} ms (début {start_ms:+.0f}) {where}")
    print(f"   preuve des suites : {out['llr']} · vérification {out['acoustic_s']} s")
    return out


def _llr_summary(llr: dict[str, list[float]]) -> dict[str, Any]:
    return {
        kind: {
            "n": len(values),
            "min": min(values, default=None),
            "median": statistics.median(values) if values else None,
            "max": max(values, default=None),
        }
        for kind, values in llr.items()
    }


def micro(bench: Bench, sessions: list[Path], expected: set[VerseRef]) -> list[dict[str, Any]]:
    out = []
    for session in sessions:
        source = next(p for p in session.glob("source.*") if p.suffix != ".json")
        results = bench.run(source)
        entry: dict[str, Any] = {"session": session.name[:8], "checks": checks(results["audio"])}
        for mode, result in results.items():
            dets = recognized(result)
            entry[mode] = [label(d) for d in dets]
            entry[f"{mode}_ok"] = {d.span.ref for d in dets} >= expected and all(
                d.span.ref in expected for d in dets
            )
        print(f"  {entry['session']} texte {entry['texte']} · audio {entry['audio']}", flush=True)
        out.append(entry)
    return out


def lot(bench: Bench, files: list[Path]) -> list[dict[str, Any]]:
    out = []
    for path in files:
        results = bench.run(path)
        keys = {m: [d.span.ref for d in recognized(r)] for m, r in results.items()}
        source = str(path)
        new = [d for d in recognized(results["audio"]) if d.span.ref not in keys["texte"]]
        lost = [d for d in recognized(results["texte"]) if d.span.ref not in keys["audio"]]
        refused = [c for c in checks(results["audio"]) if not c["accepted"]]
        for check in refused:
            span = TimeSpan(*check["t"])
            for mode in MODES:
                check[mode] = [
                    label(d)
                    for d in results[mode].detections()
                    if d.time and d.time.start_s < span.end_s and span.start_s < d.time.end_s
                ]
            check["heard"] = bench.heard(source, span)
        entry: dict[str, Any] = {
            "file": path.name,
            "recognized": {m: len(k) for m, k in keys.items()},
            "new": [{"verse": label(d), "heard": bench.heard(source, d.time)} for d in new],
            "lost": [{"verse": label(d), "heard": bench.heard(source, d.time)} for d in lost],
            "checks": len(results["audio"].acoustic_checks),
            "refused": refused,
            "acoustic_s": round(results["audio"].timing.get("acoustic_s", 0.0), 1),
            "duration_s": round(results["audio"].duration_s, 1),
        }
        print(
            f"{path.name} : reconnus {entry['recognized']} · nouveaux {len(new)}"
            f" · perdus {len(lost)} · suites refusées {len(refused)}/{entry['checks']}"
            f" · {entry['acoustic_s']} s",
            flush=True,
        )
        for kind in ("new", "lost"):
            for item in entry[kind]:
                print(f"   {kind} {item['verse']} « {item['heard']} »")
        for check in refused:
            print(f"   refusée {check['verses']} llr {check['llr_per_frame']} t {check['t']}")
            print(f"      texte {check['texte']} -> audio {check['audio']}")
            print(f"      « {check['heard']} »")
        out.append(entry)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--models-dir", type=Path, required=True)
    parser.add_argument("--lock", type=Path, default=Path("models/LOCK.json"))
    parser.add_argument("--corpus-dir", type=Path, default=Path("data/corpus"))
    parser.add_argument("--device", default="auto")
    parser.add_argument("--asrs", default="fastconformer", help="pour --micro : liste d'ASR")
    parser.add_argument("--everyayah", type=Path)
    parser.add_argument("--micro", type=Path, nargs="*", default=[])
    parser.add_argument("--micro-expected", default="55:1,55:2,55:3,55:4")
    parser.add_argument("--lot", type=Path, nargs="*", default=[])
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

    report: dict[str, Any] = {}
    benches: dict[str, Bench] = {}

    def bench(asr: str) -> Bench:
        if asr not in benches:
            benches[asr] = Bench(asr, args)
        return benches[asr]

    if args.everyayah:
        report["everyayah"] = everyayah(bench("fastconformer"), args.everyayah)
    if args.micro:
        expected = {VerseRef.parse(r) for r in args.micro_expected.split(",")}
        report["micro"] = {}
        for asr in args.asrs.split(","):
            print(f"== micro, {asr}")
            report["micro"][asr] = micro(bench(asr), args.micro, expected)
    if args.lot:
        report["lot"] = lot(bench("fastconformer"), args.lot)
    if args.out:
        args.out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
