#!/usr/bin/env python3
"""Courbe de vitesse : réécouter un audio ACCÉLÉRÉ aide-t-il le moteur sur une récitation lente ?

Deux jeux :

- `temoins` : les 9 sourates EveryAyah reconstituées de la campagne de dégradation (vérité exacte),
  étirées à ×1,0 … ×0,3 puis accélérées de ×1,0 … ×4,0 (grille dans `aqr.eval.speed_curve`) ;
- `reel` : de vrais fichiers lents (sans vérité) et des fichiers sans Coran, accélérés de ×1,0
  à ×2,5.

Étapes, chacune reprenable (un résultat existant n'est pas refait) :

    python scripts/measure_speed.py prepare --set temoins|reel ...
    python scripts/measure_speed.py run     --set temoins|reel ...
    python scripts/measure_speed.py support ...   # versets nouveaux arbitrés sur l'audio d'origine
    python scripts/measure_speed.py report  ...

Moteur = `--asr fastconformer` (le moteur principal seul). Les temps rendus sur l'audio accéléré
sont ramenés à l'échelle de l'audio d'origine (`aqr.eval.speed_curve.rescale_document`). Rien
n'est écrit dans le dépôt. Dans un worktree, lancer avec `PYTHONPATH=<worktree>/src`. Ce script
n'utilise pas `scripts/recognize_batch.py` (`fcntl`, absent de Windows).
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from collections.abc import Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import measure_degradation as md

from aqr.data import degrade as base
from aqr.data.degrade_extra import apply_condition
from aqr.domain.models import TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import AudioClip, Transcript
from aqr.eval.degradation_curve import (
    SELECTION,
    Condition,
    FileScore,
    TruthVerse,
    file_id,
    parse_for_scoring,
    scale_truth,
    score_file,
    totals,
    wilson_interval,
)
from aqr.eval.recognition import Recognition
from aqr.eval.speed_curve import (
    REAL_FACTORS,
    SPEED_RULE,
    STRETCHES,
    CtcStats,
    Profile,
    aggregate_rate,
    cell_id,
    choose_estimator,
    ctc_stats,
    decide_speed,
    factor_label,
    interval_rates,
    leave_reciter_out,
    median,
    profile_recognition,
    real_verdict,
    relative_error,
    rescale_document,
    snap_compensation,
    temoin_cells,
    temoin_rows,
    temoin_verdict,
)

ROOT = Path(__file__).resolve().parents[1]
META_SUFFIX = ".meta.json"
RECOGNITION_SUFFIX = ".recognition.json"
REAL_GRID = tuple(c for c in REAL_FACTORS if c > 1.0)
ESTIMATORS = ("mots_par_s", "lettres_par_s", "ctc_non_blanc", "mots_asr_par_s")

# nom -> (chemin relatif à AQR_AUDIO_DIR, rôle). `lent` : candidat de la partie (ii) de la règle ;
# `controle` : fichier sans Coran récité (cascade-2026-10-20.md).
REAL_FILES: dict[str, tuple[str, str]] = {
    "lot3-01": ("lot-3/Nneb8mZ779M.mp3", "lent"),
    "lot3-02": ("lot-3/ONqCLbRbDRY.mp3", "lent"),
    "lot3-03": ("lot-3/Xf6_fM0Ed30.mp3", "lent"),
    "lot3-04": ("lot-3/THd1LeCOVyY.mp3", "lent"),
    "lot3-05": ("lot-3/-_IRBcVweWw.mp3", "lent"),
    "lot3-06": ("lot-3/S_tLfqb3Vr8.mp3", "lent"),
    "lot1-05": ("C01/lot1-05.mp3", "lent"),
    "lot2-07": ("C01/lot2-07.mp3", "lent"),
    "lot1-09": ("C09/lot1-09.mp3", "controle"),
    "lot2-11": ("C09/lot2-11.mp3", "controle"),
    "lot2-12": ("C09/lot2-12.mp3", "controle"),
}


def _log(message: str) -> None:
    md._log(message)


# --- tâches -------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Job:
    kind: str  # temoins | reel
    cell: str
    file: str
    audio: Path
    comp: float
    stretch: float | None = None


def temoin_audio(deg_derived: Path, derived: Path, stretch: float, comp: float, name: str) -> Path:
    """Le témoin étiré (campagne de dégradation) ; accéléré de `comp` si comp > 1."""
    if comp == 1.0:
        folder = "propre" if stretch == 1.0 else f"lent_x{stretch:g}"
        return deg_derived / folder / f"{name}.wav"
    return derived / "temoins" / cell_id(stretch, comp) / f"{name}.wav"


def real_audio(derived: Path, comp: float, name: str) -> Path:
    return derived / "reel" / f"c{comp:g}" / f"{name}.wav"


def temoin_files() -> list[str]:
    return [file_id(r, s) for r, s in SELECTION]


def jobs_for(args: argparse.Namespace) -> list[Job]:
    jobs: list[Job] = []
    if args.set == "temoins":
        for stretch, comp in temoin_cells():
            for name in temoin_files():
                jobs.append(
                    Job(
                        "temoins",
                        cell_id(stretch, comp),
                        name,
                        temoin_audio(args.deg_derived, args.derived_dir, stretch, comp, name),
                        comp,
                        stretch,
                    )
                )
    else:
        for comp in REAL_FACTORS:
            for name in REAL_FILES:
                jobs.append(
                    Job("reel", f"c{comp:g}", name, real_audio(args.derived_dir, comp, name), comp)
                )
    if args.cells:
        jobs = [j for j in jobs if j.cell in args.cells]
    if args.files:
        jobs = [j for j in jobs if j.file in args.files]
    return jobs


def out_paths(out_dir: Path, job: Job) -> tuple[Path, Path]:
    folder = out_dir / job.kind / job.cell
    return folder / f"{job.file}{RECOGNITION_SUFFIX}", folder / f"{job.file}{META_SUFFIX}"


# --- prepare ------------------------------------------------------------------------------------


def _speed_condition(comp: float) -> Condition:
    return Condition(
        id=f"accelerer_x{comp:g}",
        family="levier",
        level=f"×{comp:g}",
        label=f"accélération ×{comp:g}",
        kind="tempo",
        params={"tempo": comp},
        tempo=comp,
    )


def _prepare_one(job: Job, source: Path) -> str:
    if job.audio.exists():
        return f"déjà là {job.cell}/{job.file}"
    if job.comp == 1.0:  # référence des vrais fichiers : décodage à plat, comme l'extracteur
        job.audio.parent.mkdir(parents=True, exist_ok=True)
        base._run(
            ["-i", str(source), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(job.audio)]
        )
    else:
        apply_condition(_speed_condition(job.comp), source, job.audio)
    return f"fait {job.cell}/{job.file}"


def cmd_prepare(args: argparse.Namespace) -> int:
    pairs: list[tuple[Job, Path]] = []
    for job in jobs_for(args):
        if args.set == "temoins":
            assert job.stretch is not None
            if job.comp == 1.0:
                continue  # le témoin étiré existe déjà
            source = temoin_audio(args.deg_derived, args.derived_dir, job.stretch, 1.0, job.file)
        else:
            source = args.audio_dir / REAL_FILES[job.file][0]
        if not source.exists():
            raise SystemExit(f"source absente : {source}")
        pairs.append((job, source))
    _log(f"prepare {args.set}: {len(pairs)} audios à produire")
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for done, line in enumerate(pool.map(lambda p: _prepare_one(*p), pairs), start=1):
            if done % 20 == 0 or done == len(pairs):
                _log(f"  {done}/{len(pairs)} ({line})")
    return 0


# --- run ----------------------------------------------------------------------------------------


class SpeedRecorder(md.RecordingASR):
    """Garde, en plus des transcriptions, les fenêtres envoyées au moteur et le clip : les
    statistiques CTC se calculent APRÈS la reconnaissance (le temps mesuré reste celui du
    pipeline)."""

    def __init__(self, inner: Any) -> None:
        super().__init__(inner)
        self.spans: list[TimeSpan] = []
        self.clip: AudioClip | None = None

    def reset(self) -> None:
        self.heard.clear()
        self.spans.clear()
        self.clip = None

    def transcribe_batch(self, clip: AudioClip, spans: Sequence[TimeSpan]) -> list[Transcript]:
        out: list[Transcript] = self._inner.transcribe_batch(clip, spans)
        self.heard.extend(out)
        self.spans.extend(spans)
        self.clip = clip
        return out

    def ctc(self) -> tuple[CtcStats, int]:
        """Statistiques du chemin le plus probable du CTC dans les fenêtres de parole."""
        import numpy as np

        total, failed = CtcStats(0, 0, 0), 0
        if self.clip is None:
            return total, failed
        for span in self.spans:
            try:
                lattice = self._inner.lattice(self.clip, span)
                best = np.asarray(lattice.log_probs, dtype=np.float32).argmax(axis=1)
                total = total + ctc_stats(best.tolist(), lattice.blank)
            except Exception:  # fenêtre trop courte pour le modèle : comptée, jamais cachée
                failed += 1
        return total, failed


def _build_solo(args: argparse.Namespace) -> Any:
    from aqr.pipeline.factory import RecognizeOptions, build_recognizer

    return build_recognizer(
        RecognizeOptions(
            asr="fastconformer",
            corpus_dir=args.corpus_dir,
            translation_id=None,
            device=args.device,
        ),
        os.environ,
    )


def cmd_run(args: argparse.Namespace) -> int:
    from aqr.pipeline.output import build_json

    truth_doc = json.loads((args.deg_derived / "truth.json").read_text(encoding="utf-8"))
    todo = [j for j in jobs_for(args) if not out_paths(args.out_dir, j)[1].exists()]
    _log(f"run {args.set}: {len(todo)} fichiers à traiter")
    if not todo:
        return 0
    missing = [j.audio for j in todo if not j.audio.exists()]
    if missing:
        raise SystemExit(f"audios absents (lancer prepare) : {missing[:3]} …")
    started = time.perf_counter()
    recognizer = _build_solo(args)
    recorder = SpeedRecorder(recognizer.pipeline._asr)
    recognizer.pipeline._asr = recorder
    _log(f"modèles chargés en {time.perf_counter() - started:.1f} s")

    for job in todo:
        recorder.reset()
        begun = time.perf_counter()
        result = md.with_gpu_retry(lambda job=job: recognizer.pipeline.run(job.audio))
        wall = time.perf_counter() - begun
        digest = md._sha256(job.audio)
        document = build_json(result, recognizer.renderer, None, digest)
        ctc, ctc_failed = recorder.ctc()
        rescaled = rescale_document(document, job.comp)
        meta: dict[str, Any] = {
            "schema": "aqr.speed-run/1",
            "set": job.kind,
            "cell": job.cell,
            "file": job.file,
            "comp": job.comp,
            "stretch": job.stretch,
            "audio_sha256": digest,
            "audio_s": round(result.duration_s, 3),
            "origin_s": round(result.duration_s * job.comp, 3),
            "wall_s": round(wall, 3),
            "windows": result.windows,
            "windows_s": round(sum(s.duration_s for s in recorder.spans), 3),
            "asr_words": sum(len(t.words) for t in recorder.heard),
            "ctc": {
                "frames": ctc.frames,
                "nonblank": ctc.nonblank,
                "tokens": ctc.tokens,
                "failed_windows": ctc_failed,
            },
            "engine": result.engine.asr,
            "note": "",
            "score": None,
        }
        if job.stretch is not None:
            verses = [
                TruthVerse(VerseRef.parse(v["ref"]), v["start_s"], v["end_s"])
                for v in truth_doc[job.file]["verses"]
            ]
            recognition, note = parse_for_scoring(rescaled)
            score = score_file(scale_truth(verses, job.stretch), recognition)
            meta["score"] = score.to_dict()
            meta["note"] = note
        recognition_path, meta_path = out_paths(args.out_dir, job)
        md._write_atomic(
            recognition_path, json.dumps(rescaled, ensure_ascii=False, indent=1) + "\n"
        )
        md._write_atomic(meta_path, json.dumps(meta, ensure_ascii=False, indent=1) + "\n")
        detail = (
            f"{meta['score']['recognized']}/{meta['score']['expected']} reconnus, "
            f"{meta['score']['false_recognized']} faux"
            if meta["score"]
            else f"{len(profile_for(rescaled).recognized)} versets distincts"
        )
        _log(
            f"{job.kind}/{job.cell} {job.file}: {detail}, "
            f"{wall:.1f} s pour {result.duration_s:.1f} s"
        )
    return 0


# --- lecture des résultats ---------------------------------------------------------------------


def profile_for(document: Mapping[str, Any]) -> Profile:
    recognition, _note = parse_for_scoring(document)
    return profile_recognition(recognition, float(document["source"]["duration_s"]))


def load_recognition(path: Path) -> tuple[dict[str, Any], Recognition]:
    document: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    recognition, _note = parse_for_scoring(document)
    return document, recognition


def load_cell(out_dir: Path, kind: str, cell: str) -> dict[str, dict[str, Any]]:
    folder = out_dir / kind / cell
    return {
        p.name.removesuffix(META_SUFFIX): json.loads(p.read_text(encoding="utf-8"))
        for p in sorted(folder.glob(f"*{META_SUFFIX}"))
    }


# --- support acoustique des versets nouveaux ----------------------------------------------------


def _recognized_intervals(recognition: Recognition) -> dict[VerseRef, list[Any]]:
    from aqr.domain.models import Status
    from aqr.eval.recognition import VerseInterval

    out: dict[VerseRef, list[Any]] = {}
    for item in recognition.intervals:
        if isinstance(item, VerseInterval) and item.status is Status.RECOGNIZED and item.t:
            out.setdefault(item.ref, []).append(item)
    return out


def cmd_support(args: argparse.Namespace) -> int:
    """Chaque verset nouveau (absent de la référence ×1,0) est arbitré sur l'audio D'ORIGINE :
    texte du corpus aligné sur le treillis du moteur, à l'échelle d'origine (ADR-0009)."""
    from aqr.adapters.ffmpeg_extractor import FfmpegAudioExtractor

    recognizer = _build_solo(args)
    verifier = recognizer.pipeline._acoustic
    if verifier is None:
        raise SystemExit("vérificateur acoustique indisponible")
    extractor = FfmpegAudioExtractor()
    folder = args.out_dir / "reel" / "support"
    for name in REAL_FILES:
        reference_path = out_paths(args.out_dir, Job("reel", "c1", name, Path(), 1.0))[0]
        if not reference_path.exists():
            _log(f"support: {name} sans référence, ignoré")
            continue
        _doc, reference = load_recognition(reference_path)
        reference_refs = set(_recognized_intervals(reference))
        clip: AudioClip | None = None
        for comp in REAL_GRID:
            target = folder / f"{name}__c{comp:g}.json"
            path = out_paths(args.out_dir, Job("reel", f"c{comp:g}", name, Path(), comp))[0]
            if target.exists() or not path.exists():
                continue
            document, recognition = load_recognition(path)  # noqa: RUF059
            fresh = {
                ref: spans
                for ref, spans in _recognized_intervals(recognition).items()
                if ref not in reference_refs
            }
            if clip is None and fresh:
                clip = extractor.extract(real_audio(args.derived_dir, 1.0, name))
            entries: list[dict[str, Any]] = []
            for ref, intervals in sorted(fresh.items()):
                assert clip is not None
                best: dict[str, Any] | None = None
                for item in intervals:
                    t0, t1 = item.t
                    window = TimeSpan(
                        max(0.0, t0 - SPEED_RULE.new_verse_pad_s),
                        min(len(clip.samples) / clip.sample_rate, t1 + SPEED_RULE.new_verse_pad_s),
                    )
                    llr: float | None = None
                    if window.duration_s <= 120.0:
                        verifier._lattices = {}
                        llr = verifier.supports(
                            clip, window, [WordSpan(ref, item.first_word, item.last_word)]
                        )
                    entry = {
                        "ref": str(ref),
                        "words": [item.first_word, item.last_word],
                        "t": [round(t0, 3), round(t1, 3)],
                        "llr": None if llr is None else round(llr, 4),
                        "supported": llr is not None and llr >= SPEED_RULE.min_llr_per_frame,
                    }
                    if best is None or (entry["llr"] or -99) > (best["llr"] or -99):
                        best = entry
                assert best is not None
                entries.append(best)
            md._write_atomic(target, json.dumps(entries, ensure_ascii=False, indent=1) + "\n")
            _log(
                f"support {name} ×{comp:g}: {len(entries)} versets nouveaux, "
                f"{sum(1 for e in entries if e['supported'])} soutenus"
            )
    return 0


# --- rapport ------------------------------------------------------------------------------------


def _pct(value: float | None) -> str:
    return "n/d" if value is None else f"{value:.1%}"


def _letters(corpus: Any, interval: Any) -> int:
    from aqr.corpus.normalize import normalize_arabic

    words = corpus.words(interval.ref)[interval.first_word - 1 : interval.last_word]
    return sum(len(normalize_arabic(w).replace(" ", "")) for w in words)


def raw_estimates(
    recognition: Recognition, meta: Mapping[str, Any], corpus: Any
) -> dict[str, float | None]:
    """Les quatre débits bruts d'un fichier, tirés de sa PREMIÈRE PASSE (aucune vérité)."""
    words = interval_rates(recognition, lambda i: i.last_word - i.first_word + 1)
    letters = interval_rates(recognition, lambda i: _letters(corpus, i))
    frames = meta["ctc"]["frames"]
    return {
        "mots_par_s": aggregate_rate(words),
        "lettres_par_s": aggregate_rate(letters),
        "ctc_non_blanc": meta["ctc"]["nonblank"] / frames if frames else None,
        "mots_asr_par_s": meta["asr_words"] / meta["windows_s"] if meta["windows_s"] else None,
    }


def _score_of(meta: Mapping[str, Any]) -> FileScore:
    names = FileScore.__dataclass_fields__
    return FileScore(**{k: v for k, v in meta["score"].items() if k in names})


def report_temoins(out_dir: Path, corpus: Any) -> tuple[list[str], dict[str, Any]]:
    lines: list[str] = []
    summary: dict[str, Any] = {}
    matrix: dict[tuple[float, float], dict[str, FileScore]] = {}
    metas: dict[tuple[float, float], dict[str, dict[str, Any]]] = {}
    for stretch, comp in temoin_cells():
        cell = load_cell(out_dir, "temoins", cell_id(stretch, comp))
        if len(cell) == len(temoin_files()):
            matrix[(stretch, comp)] = {n: _score_of(m) for n, m in cell.items()}
            metas[(stretch, comp)] = cell
    cells = sorted(matrix)
    comps = sorted({c for _s, c in cells})

    lines.append(
        "### Rappel (versets attendus `recognized` / attendus) — étirement x compensation\n"
    )
    lines.append(
        "| Étirement \\ compensation | " + " | ".join(factor_label(c) for c in comps) + " |"
    )
    lines.append("|---|" + "---|" * len(comps))
    best: dict[float, list[float]] = {}
    for stretch in STRETCHES:
        row, recalls = [], {}
        for comp in comps:
            if (stretch, comp) not in matrix:
                row.append("")
                continue
            t = totals(matrix[(stretch, comp)].values())
            recalls[comp] = t.recognized
            false = f" ({t.false_recognized} faux)" if t.false_recognized else ""
            row.append(f"{t.recognized / t.expected:.1%}{false}")
        top = max(recalls.values()) if recalls else 0
        best[stretch] = [c for c, r in recalls.items() if r >= top - 1]
        lines.append(f"| {factor_label(stretch)} | " + " | ".join(row) + " |")
    lines.append("")
    lines.append(
        "Compensations à moins d'un verset du meilleur rappel, par étirement "
        "(inverse = 1/étirement) :\n"
    )
    for stretch in STRETCHES:
        near = [factor_label(c) for c in best[stretch]]
        lines.append(f"- {factor_label(stretch)} : {', '.join(near)} (inverse : {1 / stretch:.2f})")
    lines.append("")
    summary["best_compensations"] = {str(s): best[s] for s in STRETCHES}

    # --- estimateurs --------------------------------------------------------------------------
    reciter = {file_id(r, s): r for r, s in SELECTION}
    names = temoin_files()
    raw: dict[tuple[float, str], dict[str, float | None]] = {}
    for stretch in STRETCHES:
        for name in names:
            meta = metas[(stretch, 1.0)][name]
            _document, recognition = load_recognition(
                out_dir / "temoins" / cell_id(stretch, 1.0) / f"{name}{RECOGNITION_SUFFIX}"
            )
            raw[(stretch, name)] = raw_estimates(recognition, meta, corpus)
    typical: dict[str, dict[str, float]] = {}
    for estimator in ESTIMATORS:
        clean = {n: raw[(1.0, n)][estimator] for n in names}
        usable = {n: v for n, v in clean.items() if v}
        typical[estimator] = leave_reciter_out(usable, reciter)
    ratio: dict[str, dict[tuple[float, str], float | None]] = {e: {} for e in ESTIMATORS}
    errors: dict[str, list[float]] = {e: [] for e in ESTIMATORS}
    for estimator in ESTIMATORS:
        for stretch in STRETCHES:
            for name in names:
                value, ref = raw[(stretch, name)][estimator], typical[estimator].get(name)
                r = value / ref if value and ref else None
                ratio[estimator][(stretch, name)] = r
                if stretch < 1.0:
                    errors[estimator].append(1.0 if r is None else relative_error(r, stretch))
    chosen_name = choose_estimator(errors)
    lines.append(
        "### Estimateurs du débit — rapport estimé (débit / débit typique) par étirement\n"
    )
    lines.append(
        "Médiane sur les 9 fichiers. Erreur = médiane de |estimé − vrai| / vrai, "
        "étirements ≤ ×0,8.\n"
    )
    lines.append(
        "| Estimateur | "
        + " | ".join(factor_label(s) for s in STRETCHES)
        + " | erreur relative médiane | erreur max |"
    )
    lines.append("|---|" + "---|" * (len(STRETCHES) + 2))
    for estimator in ESTIMATORS:
        cols = []
        for stretch in STRETCHES:
            values = [ratio[estimator][(stretch, n)] for n in names]
            ok = [v for v in values if v is not None]
            cols.append(f"{statistics.median(ok):.2f}" if ok else "n/d")
        mark = " **(retenu)**" if estimator == chosen_name else ""
        lines.append(
            f"| {estimator}{mark} | "
            + " | ".join(cols)
            + f" | {median(errors[estimator]):.1%} | {max(errors[estimator]):.1%} |"
        )
    lines.append("")
    summary["estimators"] = {
        e: {"median_rel_error": median(errors[e]), "max_rel_error": max(errors[e])}
        for e in ESTIMATORS
    }
    summary["chosen_estimator"] = chosen_name
    summary["typical"] = typical

    # --- règle (i) : facteur estimé contre facteur un, pour chaque estimateur ---------------
    lines.append("### Facteur ESTIMÉ contre facteur un (règle (i))\n")
    lines.append("| Estimateur | " + " | ".join(factor_label(s) for s in STRETCHES) + " |")
    lines.append("|---|" + "---|" * len(STRETCHES))
    verdicts: dict[str, Any] = {}
    chosen_by: dict[str, dict[tuple[float, str], float]] = {}
    for estimator in (*ESTIMATORS, "oracle"):
        pick: dict[tuple[float, str], float] = {}
        for stretch in STRETCHES:
            for name in names:
                if estimator == "oracle":
                    pick[(stretch, name)] = min(
                        (c for s, c in cells if s == stretch),
                        key=lambda c, stretch=stretch: abs(c * stretch - 1.0),
                    )
                else:
                    r = ratio[estimator][(stretch, name)]
                    pick[(stretch, name)] = 1.0 if r is None else snap_compensation(r)
        chosen_by[estimator] = pick
        rows = temoin_rows(matrix, pick)
        ok, reasons = temoin_verdict(rows)
        verdicts[estimator] = {
            "ok": ok,
            "reasons": reasons,
            "rows": [
                {
                    "stretch": r.stretch,
                    "recall_one": r.recall_one,
                    "recall_estimated": r.recall_estimated,
                    "gain_points": r.gain_points,
                    "false_one": r.false_one,
                    "false_estimated": r.false_estimated,
                }
                for r in rows
            ],
        }
        label = "oracle (facteur connu, majorant)" if estimator == "oracle" else estimator
        cols = [
            f"{r.recall_one:.1%} → {r.recall_estimated:.1%} "
            f"({r.gain_points:+.1f}; faux {r.false_estimated})"
            for r in rows
        ]
        lines.append(f"| {label} | " + " | ".join(cols) + " |")
    lines.append("")
    summary["temoin_verdicts"] = verdicts
    summary["temoin_ok"] = verdicts[chosen_name]["ok"]
    summary["temoin_reasons"] = verdicts[chosen_name]["reasons"]
    lines.append(
        f"Estimateur retenu par la règle : **{chosen_name}** ; verdict (i) : "
        f"**{'tient' if summary['temoin_ok'] else 'ne tient pas'}**"
        + ("" if summary["temoin_ok"] else " — " + " ; ".join(summary["temoin_reasons"]))
        + "\n"
    )

    # --- coût --------------------------------------------------------------------------------
    lines.append("### Coût (moteur seul)\n")
    lines.append(
        "| Étirement | compensation | durée traitée (s) | temps (s) | RTF sur l'audio d'origine |"
    )
    lines.append("|---|---|---|---|---|")
    for stretch in (0.4, 0.3):
        for comp in comps:
            if (stretch, comp) not in metas:
                continue
            m = metas[(stretch, comp)].values()
            audio, wall = sum(x["audio_s"] for x in m), sum(x["wall_s"] for x in m)
            origin = sum(x["origin_s"] for x in m)
            lines.append(
                f"| {factor_label(stretch)} | {factor_label(comp)} | {audio:.0f} | {wall:.0f} "
                f"| {wall / origin:.3f} |"
            )
    lines.append("")

    # --- intervalle de confiance du rappel retenu à ×0,4 et ×0,3 ------------------------------
    for stretch in (0.4, 0.3):
        t1 = totals(matrix[(stretch, 1.0)].values())
        picked = {n: matrix[(stretch, chosen_by[chosen_name][(stretch, n)])][n] for n in names}
        te = totals(picked.values())
        lo, hi = wilson_interval(te.recognized, te.expected)
        lines.append(
            f"- {factor_label(stretch)} : sans compensation {t1.recognized}/{t1.expected}, "
            f"facteur estimé {te.recognized}/{te.expected} (Wilson {lo:.1%}-{hi:.1%}), "
            f"faux {te.false_recognized}"
        )
    lines.append("")
    summary["raw_clean"] = {e: {n: raw[(1.0, n)][e] for n in names} for e in ESTIMATORS}
    return lines, summary


def session_profile(audio_path: Path, sessions: Path) -> tuple[str | None, Profile | None]:
    import hashlib

    digest = hashlib.sha256(audio_path.read_bytes()).hexdigest()
    for session in sessions.glob("*/session.json"):
        info = json.loads(session.read_text(encoding="utf-8"))
        if info.get("audio_sha256") == digest:
            prediction = session.parent / "prediction.recognition.json"
            if prediction.exists():
                doc = json.loads(prediction.read_text(encoding="utf-8"))
                recognition, _n = parse_for_scoring(doc)
                return info.get("name"), profile_recognition(recognition, info["audio_duration_s"])
    return None, None


def report_reel(
    out_dir: Path, corpus: Any, audio_dir: Path, sessions: Path, temoins: Mapping[str, Any]
) -> tuple[list[str], dict[str, Any]]:
    """`temoins` : le résumé des témoins (estimateur retenu, débits des 9 sourates propres). Le
    débit typique des vrais fichiers est la médiane des 9 propres, tous récitants confondus : ces
    fichiers n'ont pas de récitant à exclure."""
    lines: list[str] = []
    chosen_estimator: str = temoins["chosen_estimator"]
    summary: dict[str, Any] = {"files": {}, "chosen_estimator": chosen_estimator}
    reciter_pool = {
        e: median([v for v in temoins["raw_clean"][e].values() if v]) for e in ESTIMATORS
    }
    summary["typical_pool"] = reciter_pool
    support: dict[tuple[str, float], list[dict[str, Any]]] = {}
    for path in sorted((out_dir / "reel" / "support").glob("*.json")):
        name, _sep, comp = path.stem.partition("__c")
        support[(name, float(comp))] = json.loads(path.read_text(encoding="utf-8"))

    slow_supported: dict[str, int] = {}
    controls_new: dict[str, int] = {}
    for name, (rel, role) in REAL_FILES.items():
        cells = {c: load_cell(out_dir, "reel", f"c{c:g}").get(name) for c in REAL_FACTORS}
        if any(m is None for m in cells.values()):
            lines.append(f"### {name} — mesure incomplète, ignoré\n")
            continue
        profiles: dict[float, Profile] = {}
        recognitions: dict[float, Recognition] = {}
        for comp in REAL_FACTORS:
            _d, recognition = load_recognition(
                out_dir / "reel" / f"c{comp:g}" / f"{name}{RECOGNITION_SUFFIX}"
            )
            recognitions[comp] = recognition
            profiles[comp] = profile_recognition(recognition, cells[comp]["origin_s"])  # type: ignore[index]
        ref = profiles[1.0]
        session_name, session = session_profile(audio_dir / rel, sessions)
        raw = raw_estimates(recognitions[1.0], cells[1.0], corpus)  # type: ignore[arg-type]
        ratios = {e: (raw[e] / reciter_pool[e] if raw[e] else None) for e in ESTIMATORS}
        ratio = ratios[chosen_estimator]
        chosen = 1.0 if ratio is None else snap_compensation(ratio, grid=REAL_GRID)
        lines.append(
            f"### {name} ({'sans Coran' if role == 'controle' else 'vrai lent'}) — "
            f"{ref.duration_s / 60:.1f} min\n"
        )
        lines.append(
            "Débit (mots/s des intervalles reconnus à ×1,0) : "
            + (f"{raw['mots_par_s']:.2f}" if raw["mots_par_s"] else "n/d")
            + " ; rapport estimé : "
            + ", ".join(f"{e} {r:.2f}" if r else f"{e} n/d" for e, r in ratios.items())
            + f" ; facteur choisi ({chosen_estimator}) : {factor_label(chosen)}\n"
        )
        lines.append(
            "| Facteur | versets distincts | intervalles reconnus | suites (longueurs) "
            "| part en suites | non reconnu (abstention) | reconnu (temps) | incertains "
            "| nouveaux vs ×1,0 | dont soutenus | perdus vs ×1,0 | temps (s) |"
        )
        lines.append("|---|---|---|---|---|---|---|---|---|---|---|---|")
        for comp in REAL_FACTORS:
            p = profiles[comp]
            new = p.recognized - ref.recognized
            lost = ref.recognized - p.recognized
            entries = support.get((name, comp), [])
            supported = [e for e in entries if e["supported"]]
            runs = ",".join(str(n) for n in sorted(p.runs, reverse=True)[:5])
            lines.append(
                f"| {factor_label(comp)} | {len(p.recognized)} | {p.recognized_intervals} "
                f"| {runs or '-'} | "
                f"{p.coherent_share:.0%} | {p.abstention_share:.1%} | {p.recognized_share:.1%} | "
                f"{p.uncertain_intervals} | {len(new)} | {len(supported) if comp > 1 else '-'} | "
                f"{len(lost)} | {cells[comp]['wall_s']:.0f} |"  # type: ignore[index]
            )
        if session is not None:
            lines.append(
                f"\nRéférence cascade (session `{session_name}`, 23/10) : "
                f"{len(session.recognized)} versets distincts, "
                f"{session.abstention_share:.1%} non reconnu, "
                f"{session.recognized_intervals} intervalles.\n"
            )
        else:
            lines.append("\nPas de session cascade de référence pour ce fichier.\n")
        per_factor = {
            f"{comp:g}": {
                "distinct": len(profiles[comp].recognized),
                "abstention_share": profiles[comp].abstention_share,
                "new": len(profiles[comp].recognized - ref.recognized),
                "supported_new": sum(1 for e in support.get((name, comp), []) if e["supported"]),
                "lost": len(ref.recognized - profiles[comp].recognized),
            }
            for comp in REAL_FACTORS
        }
        any_supported = sum(v["supported_new"] for v in per_factor.values())
        at_chosen = per_factor[f"{chosen:g}"]["supported_new"] if chosen > 1.0 else 0
        if role == "lent":
            slow_supported[name] = at_chosen
        else:
            controls_new[name] = max((v["supported_new"] for v in per_factor.values()), default=0)
        summary["files"][name] = {
            "role": role,
            "raw": raw,
            "ratios": ratios,
            "chosen": chosen,
            "per_factor": per_factor,
            "supported_any_factor": any_supported,
        }
    ok, reasons = real_verdict(slow_supported, controls_new)
    summary.update(
        slow_supported=slow_supported, controls_new=controls_new, real_ok=ok, real_reasons=reasons
    )
    lines.append(
        f"Verdict (ii) : **{'tient' if ok else 'ne tient pas'}**"
        + ("" if ok else " — " + " ; ".join(reasons))
        + "\n"
    )
    return lines, summary


def cmd_report(args: argparse.Namespace) -> int:
    from aqr.corpus.tanzil_repository import TanzilCorpusRepository

    corpus = TanzilCorpusRepository(args.corpus_dir)
    text, summary = report_temoins(args.out_dir, corpus)
    parts = ["## Témoins à vérité connue\n", *text]
    if (args.out_dir / "reel").exists():
        # l'estimateur retenu sur les témoins sert aussi aux vrais fichiers
        real_text, real_summary = report_reel(
            args.out_dir, corpus, args.audio_dir, args.sessions_dir, summary
        )
        summary["reel"] = real_summary
        parts += ["\n## Vrais fichiers\n", *real_text]
        summary["decision"] = decide_speed(summary["temoin_ok"], real_summary["real_ok"])
        parts.append(f"\n## Décision\n\n{summary['decision']}\n")
    md._write_atomic(args.out_dir / "summary.md", "\n".join(parts) + "\n")
    md._write_atomic(
        args.out_dir / "summary.json",
        json.dumps(summary, ensure_ascii=False, indent=1, default=str) + "\n",
    )
    print("\n".join(parts))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)

    def common(p: argparse.ArgumentParser, *, jobs: bool = True) -> None:
        p.add_argument("--out-dir", type=Path, required=True)
        p.add_argument("--derived-dir", type=Path, help="audios accélérés (hors dépôt)")
        p.add_argument("--deg-derived", type=Path, help="derived de la campagne de dégradation")
        p.add_argument("--audio-dir", type=Path, default=os.environ.get("AQR_AUDIO_DIR"))
        p.add_argument("--corpus-dir", type=Path, default=ROOT / "data" / "corpus")
        p.add_argument("--device", default="auto", choices=("auto", "cpu", "cuda"))
        if jobs:
            p.add_argument("--set", choices=("temoins", "reel"), required=True)
            p.add_argument("--cells", nargs="*")
            p.add_argument("--files", nargs="*")

    prepare = sub.add_parser("prepare", help="audios accélérés")
    common(prepare)
    prepare.add_argument("--workers", type=int, default=4)
    prepare.set_defaults(func=cmd_prepare)
    run = sub.add_parser("run", help="relance le moteur seul sur chaque cellule")
    common(run)
    run.set_defaults(func=cmd_run)
    support = sub.add_parser("support", help="versets nouveaux arbitrés sur l'audio d'origine")
    common(support, jobs=False)
    support.set_defaults(func=cmd_support)
    report = sub.add_parser("report", help="tableaux, estimateurs, règle")
    common(report, jobs=False)
    report.add_argument(
        "--sessions-dir", type=Path, default=Path(r"D:\01-Dev\Data\aqr-review\sessions")
    )
    report.set_defaults(func=cmd_report)

    args = parser.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
