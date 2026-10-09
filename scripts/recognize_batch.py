#!/usr/bin/env python3
"""Reconnaissance par lot avec modèles chargés une seule fois (évaluation de référence).

Écrit `<id>.json` (aqr.recognition/1) par cas du lot, `run.json` (aqr.recognition-run/1) et
`timings.json`. Usage :
    python scripts/recognize_batch.py --manifest M --audio-dir D --split dev \
        --asr fastconformer --out-dir OUT
Aucun audio n'est écrit dans le dépôt ; `--split test` exige `--final` (ensemble réservé).

Un dossier de sortie ne mélange jamais deux runs :
- un seul lot à la fois : verrou `flock` non bloquant sur `<out-dir>/.lock` (code 2 si déjà pris) ;
- au démarrage, `run.json`, `timings.json` et le `<id>.json` de chaque cas du lot sont supprimés
  (jamais un autre fichier : les cas hors lot, p. ex. avec `--limit`, ne sont pas touchés) ;
- chaque `<id>.json` est écrit atomiquement (temporaire dans le dossier puis `os.replace`) ;
- `run.json` est réécrit atomiquement avant le premier cas puis après chacun : statut `running`,
  puis `complete` / `partial` / `interrupted` fixé quoi qu'il arrive (Ctrl-C, SIGTERM et exception),
  `planned`, `done` (cas -> sha256 du fichier écrit), `failed` (cas -> message), moteur, SHA git
  et empreinte du manifeste. `scripts/evaluate.py` refuse tout lot qui n'est pas `complete`.
Code de sortie : 0 seulement si le lot est `complete` ; 1 si un cas a échoué ou si le lot est
interrompu ; 2 usage (jeu test sans --final, aucun cas, modèles indisponibles).
`timings.json` : `process_peak_rss_mb` est le pic de mémoire CUMULÉ du processus (chargement des
modèles compris), relevé après chaque cas : il ne se lit pas comme le pic d'un cas.
"""

from __future__ import annotations

import argparse
import json
import os
import resource
import signal
import sys
import threading
import time
import traceback
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from aqr.cli import RecognizerFactory, _sha256_of
from aqr.corpus.checksums import sha256_of, sha256_of_file
from aqr.data.manifest import AudioCase, Manifest
from aqr.eval.report import git_state
from aqr.eval.run import (
    RUN_FILE,
    TIMINGS_FILE,
    DirectoryBusy,
    RunRecord,
    RunStatus,
    exclusive_directory,
    prediction_file,
    save_run,
    write_text_atomic,
)
from aqr.pipeline.factory import (
    RecognizeOptions,
    Recognizer,
    RecognizerUnavailable,
    build_recognizer,
)
from aqr.pipeline.output import build_json

ROOT = Path(__file__).resolve().parents[1]
RESERVED_IDS = frozenset({Path(RUN_FILE).stem, Path(TIMINGS_FILE).stem})


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--audio-dir", type=Path, required=True)
    p.add_argument("--split", choices=("dev", "test"), default="dev")
    p.add_argument("--final", action="store_true")
    p.add_argument("--asr", choices=("whisper", "fastconformer"), default="fastconformer")
    p.add_argument("--out-dir", type=Path, required=True)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--only-condition", action="append", default=[])
    p.add_argument("--translation", default="none")
    p.add_argument("--corpus-dir", type=Path, default=Path("data/corpus"))
    return p


def _select(manifest: Manifest, args: argparse.Namespace) -> list[AudioCase]:
    cases = [c for c in manifest.cases if c.split == args.split]
    if args.only_condition:
        cases = [
            c for c in cases if (c.extra.get("ref") or {}).get("condition") in args.only_condition
        ]
    return cases[: args.limit] if args.limit else cases


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _dumps(document: Mapping[str, Any]) -> str:
    return json.dumps(document, ensure_ascii=False, indent=1) + "\n"


def _usable_as_file_stem(case_id: str) -> bool:
    """`<id>.json` doit rester dans le dossier de sortie et ne pas être un fichier du lot."""
    return case_id not in RESERVED_IDS | {"", ".", ".."} and Path(case_id).name == case_id


def _purge(out_dir: Path, cases: list[AudioCase]) -> None:
    """Supprime l'état d'un run précédent : run.json, timings.json et les `<id>.json` du lot.

    Tout ou rien : si l'une de ces cibles est un dossier, rien n'est supprimé (OSError claire)."""
    stale = [out_dir / RUN_FILE, out_dir / TIMINGS_FILE]
    stale += [prediction_file(out_dir, c.id) for c in cases]
    for path in stale:
        if path.is_dir() and not path.is_symlink():
            raise IsADirectoryError(
                f"{path} est un dossier, pas une sortie du lot : le déplacer ou choisir un autre "
                "--out-dir (rien n'a été supprimé)"
            )
    for path in stale:
        path.unlink(missing_ok=True)


@contextmanager
def _sigterm_as_interrupt() -> Iterator[None]:
    """SIGTERM devient un KeyboardInterrupt : le lot se conclut `interrupted` au lieu d'être tué
    en laissant `running`. Handler d'origine restauré ; sans effet hors du thread principal."""
    if threading.current_thread() is not threading.main_thread():
        yield
        return

    def terminate(signum: int, frame: object) -> None:
        raise KeyboardInterrupt("SIGTERM")

    previous = signal.signal(signal.SIGTERM, terminate)
    try:
        yield
    finally:
        signal.signal(signal.SIGTERM, previous)


def _recognize_case(
    case: AudioCase,
    args: argparse.Namespace,
    recognizer: Recognizer,
    translation_id: str | None,
) -> tuple[dict[str, Any], str, dict[str, Any]]:
    """Reconnaît un cas et écrit `<id>.json` atomiquement. Renvoie (ligne de temps, sha256 du
    fichier écrit, bloc `engine` de la sortie). Lève OSError / ValueError / RuntimeError."""
    path = args.audio_dir / case.file
    started = time.perf_counter()
    result = recognizer.pipeline.run(path)
    wall = time.perf_counter() - started
    document = build_json(result, recognizer.renderer, translation_id, _sha256_of(path))
    text = _dumps(document)
    write_text_atomic(prediction_file(args.out_dir, case.id), text)
    row = {
        "id": case.id,
        "wall_s": round(wall, 3),
        "audio_s": round(result.duration_s, 3),
        # pic CUMULÉ du processus (modèles chargés compris) : non attribuable à ce cas
        "process_peak_rss_mb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024,
    }
    print(f"{case.id} {wall:.1f}s/{result.duration_s:.1f}s", flush=True)
    engine = document["engine"]
    assert isinstance(engine, dict)
    return row, sha256_of(text.encode("utf-8")), engine


def main(
    argv: list[str] | None = None,
    *,
    recognizer_factory: RecognizerFactory = build_recognizer,
    env: Mapping[str, str] = os.environ,
) -> int:
    """`recognizer_factory` / `env` : injection pour les tests (modèle : `aqr.cli.main`)."""
    args = _parser().parse_args(argv)
    if args.split == "test" and not args.final:
        print("ensemble test réservé : relancer avec --final", file=sys.stderr)
        return 2
    cases = _select(Manifest.load(args.manifest), args)
    if not cases:
        print(
            f"aucun cas à traiter (split {args.split}, filtres du lot) : rien n'est modifié",
            file=sys.stderr,
        )
        return 2
    unusable = sorted(c.id for c in cases if not _usable_as_file_stem(c.id))
    if unusable:
        print(
            "identifiant(s) de cas inutilisable(s) comme nom de sortie (réservé au lot ou "
            f"avec un chemin) : {', '.join(unusable)}",
            file=sys.stderr,
        )
        return 2
    args.out_dir.mkdir(parents=True, exist_ok=True)
    try:
        with exclusive_directory(args.out_dir), _sigterm_as_interrupt():
            return _run_locked(args, cases, recognizer_factory, env)
    except DirectoryBusy as exc:
        print(f"Refusé : {exc}", file=sys.stderr)
        return 2


def _run_locked(
    args: argparse.Namespace,
    cases: list[AudioCase],
    recognizer_factory: RecognizerFactory,
    env: Mapping[str, str],
) -> int:
    """Le lot proprement dit, sous le verrou du dossier de sortie (un seul lot à la fois)."""
    try:
        _purge(args.out_dir, cases)
    except OSError as exc:
        print(f"ERREUR purge impossible, rien n'a été supprimé : {exc}", file=sys.stderr)
        return 2
    translation_id = None if args.translation == "none" else args.translation
    options = RecognizeOptions(
        asr=args.asr, corpus_dir=args.corpus_dir, translation_id=translation_id, device="cpu"
    )
    t0 = time.perf_counter()
    run = RunRecord(
        status=RunStatus.RUNNING,
        asr=args.asr,
        planned=tuple(c.id for c in cases),
        options={
            "asr": args.asr,
            "split": args.split,
            "final": bool(args.final),
            "only_condition": list(args.only_condition),
            "limit": args.limit,
            "translation": args.translation,
            "device": options.device,
        },
        git=git_state(ROOT),
        manifest={"name": args.manifest.name, "sha256": sha256_of_file(args.manifest)},
        timing={"started_at": _now(), "finished_at": None, "model_load_s": None, "elapsed_s": None},
    )
    save_run(args.out_dir, run)  # `running` : tout arrêt brutal reste détectable

    rows: list[dict[str, Any]] = []
    status, error, code = RunStatus.INTERRUPTED, None, 1
    try:
        recognizer = recognizer_factory(options, env)
        load_s = round(time.perf_counter() - t0, 2)
        run = replace(run, timing={**run.timing, "model_load_s": load_s})
        save_run(args.out_dir, run)
        for case in cases:
            try:
                row, written_sha, engine = _recognize_case(case, args, recognizer, translation_id)
            except (OSError, ValueError, RuntimeError) as exc:
                message = f"{type(exc).__name__}: {exc}"
                rows.append({"id": case.id, "error": message})
                run = replace(run, failed={**run.failed, case.id: message})
                print(f"ÉCHEC {case.id} : {message}", file=sys.stderr, flush=True)
            else:
                rows.append(row)
                run = replace(
                    run,
                    done={**run.done, case.id: written_sha},
                    engine=run.engine if run.engine is not None else engine,
                )
            save_run(args.out_dir, run)
        status = RunStatus.PARTIAL if run.failed else RunStatus.COMPLETE
        code = 1 if run.failed else 0
    except RecognizerUnavailable as exc:
        error, code = str(exc), 2
        print(error, file=sys.stderr)
    except KeyboardInterrupt as exc:
        error = f"KeyboardInterrupt: {exc}" if str(exc) else "KeyboardInterrupt"
        print("lot interrompu (Ctrl-C ou SIGTERM) : run.json = interrupted", file=sys.stderr)
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        traceback.print_exc()
    finally:
        # Statut fixé quoi qu'il arrive. Si l'écriture échoue, `running` reste dans run.json : le
        # lot est alors non évaluable, ce qui est le bon défaut.
        try:
            elapsed = round(time.perf_counter() - t0, 2)
            run = replace(
                run,
                status=status,
                error=error,
                timing={**run.timing, "finished_at": _now(), "elapsed_s": elapsed},
            )
            save_run(args.out_dir, run)
            summary = {
                "asr": args.asr,
                "split": args.split,
                "status": status.value,
                "model_load_s": run.timing.get("model_load_s"),
                "cases": rows,
            }
            write_text_atomic(args.out_dir / TIMINGS_FILE, _dumps(summary))
        except OSError as exc:
            print(f"ERREUR état du lot non écrit : {exc}", file=sys.stderr)
            code = code or 1
    print(
        f"lot {status.value} : {len(run.done)}/{len(run.planned)} cas écrits, "
        f"{len(run.failed)} en échec ({args.out_dir / RUN_FILE})"
    )
    return code


if __name__ == "__main__":
    raise SystemExit(main())
