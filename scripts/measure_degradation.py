#!/usr/bin/env python3
"""Courbe de dégradation : le rappel du moteur quand l'enregistrement se dégrade.

Des sourates reconstituées depuis EveryAyah (contenu CONNU par construction : aucune annotation
humaine) subissent des dégradations contrôlées (`aqr.data.degrade_extra`, conditions dans
`aqr.eval.degradation_curve`), le moteur est relancé, et l'on mesure ce qui reste : versets
attendus retrouvés, faux versets, versets seulement inférés ou incertains, abstentions, et le
WER/CER de la transcription ASR contre le texte du corpus (le modèle se trompe-t-il, ou la
décision s'abstient-elle ?). Le rapport applique la règle de décision écrite d'avance.

Trois étapes, chacune reprenable (rien n'est refait si le résultat existe) :

    python scripts/measure_degradation.py prepare --audio-dir $AQR_AUDIO_DIR \\
        --derived-dir $AQR_AUDIO_DIR/_derived/degradation --out-dir $OUT/degradation
    python scripts/measure_degradation.py run --mode solo    --derived-dir ... --out-dir ...
    python scripts/measure_degradation.py run --mode cascade --derived-dir ... --out-dir ...
    python scripts/measure_degradation.py report --out-dir ...

`solo` = `--asr fastconformer` (le moteur principal seul) ; `cascade` = la cascade par défaut,
mesurée sur les conditions marquées `cascade` (propre, bruit 10 dB, vitesse ×0,6). Modèles
chargés une seule fois ; variables : `AQR_MODELS_DIR`. Aucun audio ni sortie lourde dans le dépôt.
Dans un worktree, lancer avec `PYTHONPATH=<worktree>/src`.

Sorties par condition : `<out>/<condition>/<mode>/<fichier>.recognition.json` (aqr.recognition/1)
et `.score.json` (comptes, WER/CER, temps). Ce script n'utilise pas `scripts/recognize_batch.py` :
il écrit ses propres sorties par condition.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from array import array
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, TypeVar

from aqr.data.degrade_extra import apply_condition, format_command
from aqr.domain.models import TimeSpan, VerseRef
from aqr.domain.ports import AudioClip, Transcript
from aqr.domain.quran_structure import ayah_count
from aqr.eval.degradation_curve import (
    CLEAN_ID,
    SEED_STRIDE,
    SELECTION,
    Condition,
    ScoreRecord,
    TruthVerse,
    build_conditions,
    build_exploratory_conditions,
    conditions_by_id,
    file_id,
    load_scores,
    parse_for_scoring,
    reference_words_for_file,
    scale_truth,
    score_file,
    summarize,
    truth_from_durations,
)
from aqr.eval.degradation_report import (
    compute_verdicts,
    render_cascade,
    render_curves,
    render_decision,
    render_table,
)
from aqr.eval.transcription import TOLERANTE, score_transcript

ROOT = Path(__file__).resolve().parents[1]
SAMPLE_RATE = 16000
T = TypeVar("T")


# --- utilitaires -------------------------------------------------------------------------------


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f"{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _git_sha() -> str | None:
    done = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=False
    )
    return done.stdout.strip() or None


def _ffmpeg_version() -> str:
    done = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, check=False)
    return done.stdout.splitlines()[0] if done.stdout else "ffmpeg introuvable"


def _select_conditions(
    ids: Sequence[str] | None, only_cascade: bool = False, exploratory: bool = False
) -> list[Condition]:
    """Les conditions du cahier par défaut ; `--exploratory` : celles ajoutées après coup."""
    if ids:  # des identifiants explicites sont toujours respectés (cascade comprise)
        return conditions_by_id(ids)
    chosen = list(build_exploratory_conditions() if exploratory else build_conditions())
    return [c for c in chosen if c.cascade or not only_cascade]


def _log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


# --- prepare : sourates propres, vérité, conditions ---------------------------------------------


def cmd_prepare(args: argparse.Namespace) -> int:
    from aqr.data.mixer import DiskClipProvider, write_wav

    provider = DiskClipProvider(args.audio_dir, sample_rate=SAMPLE_RATE)
    clean_dir = args.derived_dir / CLEAN_ID
    truth_doc: dict[str, Any] = {}
    for reciter, surah in SELECTION:
        name = file_id(reciter, surah)
        clips = [
            provider.verse(reciter, VerseRef(surah, a)) for a in range(1, ayah_count(surah) + 1)
        ]
        samples: array[int] = array("h")
        for clip in clips:
            samples.extend(clip)
        write_wav(clean_dir / f"{name}.wav", samples, SAMPLE_RATE)
        verses = truth_from_durations(surah, [len(c) / SAMPLE_RATE for c in clips])
        truth_doc[name] = {
            "reciter": reciter,
            "surah": surah,
            "duration_s": round(len(samples) / SAMPLE_RATE, 3),
            "verses": [
                {"ref": str(v.ref), "start_s": round(v.start_s, 3), "end_s": round(v.end_s, 3)}
                for v in verses
            ],
        }
        _log(f"propre {name}: {len(clips)} versets, {truth_doc[name]['duration_s']} s")
    _write_atomic(
        args.derived_dir / "truth.json", json.dumps(truth_doc, ensure_ascii=False, indent=1) + "\n"
    )

    method: dict[str, Any] = {}
    digests: dict[str, dict[str, str]] = {}
    for cond in _select_conditions(args.conditions, exploratory=args.exploratory):
        digests[cond.id] = {}
        commands: list[str] = []
        for index, (reciter, surah) in enumerate(SELECTION):
            name = file_id(reciter, surah)
            src, dest = clean_dir / f"{name}.wav", args.derived_dir / cond.id / f"{name}.wav"
            if cond.id == CLEAN_ID:
                digests[cond.id][name] = _sha256(src)
                continue
            log = apply_condition(cond, src, dest, seed_offset=SEED_STRIDE * index)
            digests[cond.id][name] = _sha256(dest)
            if not commands:
                commands = [format_command(cmd, src, dest) for cmd in log]
        _log(f"{cond.id}: {len(SELECTION)} fichiers")
        method[cond.id] = {
            "label": cond.label,
            "family": cond.family,
            "kind": cond.kind,
            "params": dict(cond.params),
            "tempo": cond.tempo,
            "seed_per_file": f"graine + {SEED_STRIDE} x indice du fichier"
            if "seed" in cond.params
            else None,
            "commands": commands,
        }
    path = args.out_dir / "methode.json"
    previous = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    document = {
        "git": _git_sha(),
        "ffmpeg": _ffmpeg_version(),
        "files": [file_id(r, s) for r, s in SELECTION],
        "conditions": {**previous.get("conditions", {}), **method},
        "audio_sha256": {**previous.get("audio_sha256", {}), **digests},
    }
    _write_atomic(path, json.dumps(document, ensure_ascii=False, indent=1) + "\n")
    _log(f"méthode écrite : {args.out_dir / 'methode.json'}")
    return 0


# --- run : le moteur, une condition après l'autre --------------------------------------------


class RecordingASR:
    """Enveloppe l'ASR principal et garde les transcriptions des fenêtres (WER/CER), sans rien
    changer à ce que le pipeline reçoit. `transcribe_batch` n'existe que si l'ASR l'a."""

    def __init__(self, inner: Any) -> None:
        self._inner = inner
        self.heard: list[Transcript] = []

    def __getattr__(self, name: str) -> Any:
        attribute = getattr(self._inner, name)
        if name == "transcribe_batch":

            def batch(clip: AudioClip, spans: Sequence[TimeSpan]) -> list[Transcript]:
                out: list[Transcript] = attribute(clip, spans)
                self.heard.extend(out)
                return out

            return batch
        return attribute

    def transcribe(self, clip: AudioClip, span: TimeSpan) -> Transcript:
        transcript: Transcript = self._inner.transcribe(clip, span)
        self.heard.append(transcript)
        return transcript


def with_gpu_retry(call: Callable[[], T], *, attempts: int = 8, wait_s: float = 45.0) -> T:
    """Une autre session peut saturer la GPU : on attend et on réessaie (mémoire seulement)."""
    for attempt in range(1, attempts + 1):
        try:
            return call()
        except RuntimeError as exc:
            if "out of memory" not in str(exc).lower() or attempt == attempts:
                raise
            _log(f"GPU saturée (essai {attempt}/{attempts}), attente {wait_s:g} s")
            try:
                import torch

                torch.cuda.empty_cache()
            except Exception:
                pass
            time.sleep(wait_s)
    raise AssertionError("inatteignable")


def cmd_run(args: argparse.Namespace) -> int:
    from aqr.corpus.imlai_corrections import build_word_corrections, load_simple_clean_words
    from aqr.corpus.tanzil_repository import TanzilCorpusRepository
    from aqr.pipeline.factory import RecognizeOptions, build_recognizer
    from aqr.pipeline.output import build_json

    truth_doc = json.loads((args.derived_dir / "truth.json").read_text(encoding="utf-8"))
    conditions = _select_conditions(
        args.conditions, only_cascade=args.mode == "cascade", exploratory=args.exploratory
    )
    files = [f for f in (file_id(r, s) for r, s in SELECTION) if not args.files or f in args.files]
    todo = [
        (c, f)
        for c in conditions
        for f in files
        if not (args.out_dir / c.id / args.mode / f"{f}.score.json").exists()
    ]
    _log(f"mode {args.mode}: {len(conditions)} conditions, {len(todo)} fichiers à traiter")
    if not todo:
        return 0

    corpus = TanzilCorpusRepository(args.corpus_dir)
    corrections = build_word_corrections(corpus, load_simple_clean_words(args.corpus_dir))
    started = time.perf_counter()
    recognizer = build_recognizer(
        RecognizeOptions(
            asr="cascade" if args.mode == "cascade" else "fastconformer",
            corpus_dir=args.corpus_dir,
            translation_id=None,
            device=args.device,
        ),
        os.environ,
    )
    recorder = RecordingASR(recognizer.pipeline._asr)
    recognizer.pipeline._asr = recorder
    _log(f"modèles chargés en {time.perf_counter() - started:.1f} s")

    for cond, name in todo:
        audio = args.derived_dir / cond.id / f"{name}.wav"
        verses = [
            TruthVerse(VerseRef.parse(v["ref"]), v["start_s"], v["end_s"])
            for v in truth_doc[name]["verses"]
        ]
        recorder.heard.clear()
        begun = time.perf_counter()
        result = with_gpu_retry(lambda audio=audio: recognizer.pipeline.run(audio))
        wall = time.perf_counter() - begun
        digest = _sha256(audio)
        document = build_json(result, recognizer.renderer, None, digest)
        recognition, note = parse_for_scoring(document)
        score = score_file(scale_truth(verses, cond.tempo), recognition)
        hypothesis = " ".join(w.text for t in recorder.heard for w in t.words)
        reference = reference_words_for_file(verses, corpus)
        asr = score_transcript(reference, hypothesis, corrections, TOLERANTE)
        record = ScoreRecord(
            condition=cond.id,
            mode=args.mode,
            file=name,
            audio_sha256=digest,
            audio_s=round(result.duration_s, 3),
            wall_s=round(wall, 3),
            score=score,
            word_errors=asr.word_errors,
            word_total=asr.word_total,
            letter_errors=asr.letter_errors,
            letter_total=asr.letter_total,
            engine=result.engine.asr,
            windows=result.windows,
            note=note,
        )
        folder = args.out_dir / cond.id / args.mode
        _write_atomic(
            folder / f"{name}.recognition.json",
            json.dumps(document, ensure_ascii=False, indent=1) + "\n",
        )
        _write_atomic(folder / f"{name}.score.json", record.to_json())
        _log(
            f"{cond.id}/{args.mode} {name}: {score.recognized}/{score.expected} reconnus, "
            f"{score.false_recognized} faux, WER {_pct(asr.wer)}, {wall:.1f} s "
            f"pour {result.duration_s:.1f} s" + (f" [{note}]" if note else "")
        )
    return 0


def _pct(value: float | None) -> str:
    return "n/d" if value is None else f"{value:.1%}"


# --- report -----------------------------------------------------------------------------------


def _summary_json(solo: Any, cascade: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for mode, campaign in (("solo", solo), ("cascade", cascade)):
        for cond_id, records in campaign.items():
            s = summarize(records.values())
            out.setdefault(cond_id, {})[mode] = {
                **s.score.to_dict(),
                "files": s.files,
                "outputs_refused_by_reader": sum(1 for r in records.values() if r.note),
                "recall_ci95": s.recall_ci,
                "wer": s.wer,
                "cer": s.cer,
                "audio_s": round(s.audio_s, 1),
                "wall_s": round(s.wall_s, 1),
                "rtf": s.rtf,
                "per_file_recall": dict(s.per_file_recall),
            }
    return out


def cmd_report(args: argparse.Namespace) -> int:
    solo, cascade = load_scores(args.out_dir, "solo"), load_scores(args.out_dir, "cascade")
    verdicts, decision = compute_verdicts(solo)
    parts = [
        "## Tableau final\n\n" + render_table(solo, cascade),
        "## Courbes\n\n" + render_curves(solo, cascade),
        "## Verdict par famille et décision\n\n" + render_decision(verdicts, decision),
    ]
    if cascade:
        parts.append("## La cascade rattrape-t-elle ?\n\n" + render_cascade(solo, cascade))
    text = "\n\n".join(parts) + "\n"
    _write_atomic(args.out_dir / "summary.md", text)
    _write_atomic(
        args.out_dir / "summary.json",
        json.dumps(_summary_json(solo, cascade), ensure_ascii=False, indent=1) + "\n",
    )
    print(text)
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)

    def common(p: argparse.ArgumentParser, *, derived: bool = True) -> None:
        p.add_argument("--out-dir", type=Path, required=True)
        if derived:
            p.add_argument("--derived-dir", type=Path, required=True)
        p.add_argument("--conditions", nargs="*", help="identifiants (défaut : celles du cahier)")
        p.add_argument(
            "--exploratory",
            action="store_true",
            help="les conditions ajoutées après le résultat principal (au-delà du cahier)",
        )

    prepare = sub.add_parser("prepare", help="sourates propres, vérité, audio dégradé")
    common(prepare)
    prepare.add_argument("--audio-dir", type=Path, default=os.environ.get("AQR_AUDIO_DIR"))
    prepare.set_defaults(func=cmd_prepare)

    run = sub.add_parser("run", help="relance le moteur sur chaque condition")
    common(run)
    run.add_argument("--mode", choices=("solo", "cascade"), required=True)
    run.add_argument("--files", nargs="*", help="identifiants de fichiers (défaut : tous)")
    run.add_argument("--corpus-dir", type=Path, default=ROOT / "data" / "corpus")
    run.add_argument("--device", default="auto", choices=("auto", "cpu", "cuda"))
    run.set_defaults(func=cmd_run)

    report = sub.add_parser("report", help="tableaux, courbes, verdicts")
    report.add_argument("--out-dir", type=Path, required=True)
    report.set_defaults(func=cmd_report)

    args = parser.parse_args(argv)
    if args.command == "prepare" and args.audio_dir is None:
        parser.error("--audio-dir ou AQR_AUDIO_DIR requis")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
