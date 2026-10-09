"""Point d'entrée CLI : `aqr data ...` (outillage de données) et `aqr recognize FICHIER`
(reconnaissance de bout en bout : JSON `aqr.recognition/1` puis SRT/VTT).

Chemins : `$AQR_AUDIO_DIR` (obligatoire, ou `--audio-dir`) ; le manifeste est, par ordre de
priorité, `--manifest`, `$AQR_MANIFEST`, `tests/fixtures/audio/manifest.yaml` (depuis la racine du
dépôt) puis `<audio_dir>/manifest.yaml`.

Codes de sortie : 0 succès · 1 erreur sur les données (fiche, étiquettes, cas inconnu, fichier
absent ou déjà écrit) · 2 utilisation impossible (variable manquante, moteur ou option
indisponible).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import replace
from pathlib import Path
from typing import TextIO

from aqr.data.config import DataConfig
from aqr.data.ingest import Converter, ffmpeg_converter, ingest
from aqr.data.labels import (
    LabelError,
    PreannotationUnavailable,
    UnavailablePreAnnotator,
    export_labels,
    import_labels,
    preannotate,
)
from aqr.data.manifest import Manifest, ManifestError
from aqr.data.split import assign_splits, quarantine_recitant
from aqr.pipeline.factory import (
    CONSTRAINED_UNAVAILABLE,
    RecognizeOptions,
    Recognizer,
    RecognizerUnavailable,
    build_recognizer,
)
from aqr.pipeline.output import build_json, render_srt, render_vtt

_DEFAULT_MANIFEST = Path("tests/fixtures/audio/manifest.yaml")
_FORMATS = ("json", "srt", "vtt")
RecognizerFactory = Callable[[RecognizeOptions, Mapping[str, str]], Recognizer]


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="aqr", description=__doc__)
    commands = parser.add_subparsers(dest="command")
    data = commands.add_parser("data", help="outillage de données (docs/DATA-COLLECTION.md §5)")
    data.add_argument("--audio-dir", type=Path, help="défaut : $AQR_AUDIO_DIR")
    data.add_argument("--manifest", type=Path, help="défaut : voir l'aide d'`aqr`")
    sub = data.add_subparsers(dest="action", required=True)

    ing = sub.add_parser("ingest", help="inbox/ -> manifeste (fiche, sha256, WAV 16 kHz)")
    ing.add_argument("--inbox", type=Path, help="défaut : <audio_dir>/inbox")

    for name, text in (
        ("export-labels", "manifeste -> étiquettes Audacity"),
        ("import-labels", "étiquettes Audacity -> manifeste (cas passé à `annote`)"),
        ("preannotate", "proposition d'étiquettes par le moteur (phase 5)"),
    ):
        cmd = sub.add_parser(name, help=text)
        cmd.add_argument("case_id")
        if name != "import-labels":
            cmd.add_argument("--force", action="store_true", help="écraser un fichier existant")

    spl = sub.add_parser(
        "split", help="dev/test 70/30 par récitant (affectations existantes figées)"
    )
    spl.add_argument("--dry-run", action="store_true")

    qua = sub.add_parser(
        "quarantine",
        help="récitant exposé pendant le réglage -> quarantaine (sens unique ; voir le protocole)",
    )
    qua.add_argument("recitant", help="identifiant exact du récitant dans le manifeste")
    qua.add_argument("--dry-run", action="store_true")

    rec = commands.add_parser(
        "recognize", help="audio/vidéo -> versets horodatés (JSON puis SRT/VTT)"
    )
    rec.add_argument("file", type=Path)
    rec.add_argument("--out-dir", type=Path, default=Path("aqr-out"))
    rec.add_argument("--format", default="json,srt", help="liste parmi json,srt,vtt")
    rec.add_argument("--force", action="store_true", help="écraser des sorties existantes")
    rec.add_argument("--translation", default="french_hameedullah", help="identifiant ou « none »")
    rec.add_argument("--asr", default="whisper", choices=("whisper", "fastconformer"))
    rec.add_argument("--segmenter", default="recitation", choices=("recitation", "silero"))
    rec.add_argument(
        "--allow-fallback-segmenter",
        action="store_true",
        help="repli Silero si le segmenteur principal échoue (non fiable, signalé dans la sortie)",
    )
    rec.add_argument("--models-dir", type=Path, help="défaut : $AQR_MODELS_DIR")
    rec.add_argument("--lock", type=Path, default=Path("models/LOCK.json"))
    rec.add_argument("--corpus-dir", type=Path, default=Path("data/corpus"))
    rec.add_argument("--device", default="auto", help="auto | cpu | cuda")
    rec.add_argument("--batch-size", type=int, default=8)
    rec.add_argument(
        "--constrained", action="store_true", help="preuve acoustique CTC (ADR-0005, indisponible)"
    )
    return parser


def _resolve_paths(args: argparse.Namespace, env: Mapping[str, str]) -> tuple[Path, Path] | None:
    audio = args.audio_dir or (Path(env["AQR_AUDIO_DIR"]) if env.get("AQR_AUDIO_DIR") else None)
    if audio is None:
        return None
    manifest = args.manifest
    if manifest is None and env.get("AQR_MANIFEST"):
        manifest = Path(env["AQR_MANIFEST"])
    if manifest is None:
        manifest = (
            _DEFAULT_MANIFEST if _DEFAULT_MANIFEST.parent.is_dir() else audio / "manifest.yaml"
        )
    return audio, manifest


def _split(manifest_path: Path, config: DataConfig, dry_run: bool, out: TextIO) -> int:
    manifest = Manifest.load(manifest_path)
    mapping = assign_splits(manifest.cases, config)
    changed = 0
    for index, case in enumerate(manifest.cases):
        if case.split is None:
            manifest.cases[index] = replace(case, split=mapping[case.recitant])
            changed += 1
    if not dry_run:
        manifest.save(manifest_path)
    for side in (*config.splits, config.quarantine_split):
        names = sorted(r for r, s in mapping.items() if s == side)
        if not names and side == config.quarantine_split:
            continue  # la quarantaine n'apparaît que s'il y en a une
        hours = sum(c.duree_s or 0 for c in manifest.cases if mapping[c.recitant] == side) / 3600
        print(
            f"{side:5s} {len(names):2d} récitants · {hours:5.2f} h · {', '.join(names)}", file=out
        )
    print(f"{changed} cas affecté(s){' (simulation)' if dry_run else ''}", file=out)
    return 0


def _quarantine(
    manifest_path: Path, config: DataConfig, recitant: str, dry_run: bool, out: TextIO
) -> int:
    manifest = Manifest.load(manifest_path)
    moved = quarantine_recitant(manifest.cases, recitant, config)
    changed = [new for old, new in zip(manifest.cases, moved, strict=True) if old != new]
    manifest.cases = moved
    if not dry_run:
        manifest.save(manifest_path)
    names = sorted({case.recitant for case in changed})
    print(
        f"{len(changed)} cas passé(s) en {config.quarantine_split} "
        f"({', '.join(names) or 'déjà en quarantaine'}){' (simulation)' if dry_run else ''}",
        file=out,
    )
    return 0


def _sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _recognize(
    args: argparse.Namespace,
    env: Mapping[str, str],
    out: TextIO,
    err: TextIO,
    factory: RecognizerFactory,
) -> int:
    formats = [f.strip() for f in args.format.split(",") if f.strip()]
    unknown = [f for f in formats if f not in _FORMATS]
    if unknown or not formats:
        print(f"format inconnu : {unknown or args.format!r} (json, srt, vtt)", file=err)
        return 2
    if not args.file.is_file():
        print(f"ERREUR fichier introuvable : {args.file}", file=err)
        return 1
    names = {"json": ".recognition.json", "srt": ".srt", "vtt": ".vtt"}
    targets = {f: args.out_dir / f"{args.file.stem}{names[f]}" for f in formats}
    existing = [p for p in targets.values() if p.exists()]
    if existing and not args.force:
        print(f"ERREUR sortie déjà présente : {existing[0]} (--force pour écraser)", file=err)
        return 1
    if args.constrained:  # aucun ASR n'expose encore son treillis CTC (ADR-0005)
        print(CONSTRAINED_UNAVAILABLE, file=err)
        return 2
    translation = None if args.translation == "none" else args.translation
    options = RecognizeOptions(
        asr=args.asr,
        segmenter=args.segmenter,
        allow_fallback_segmenter=args.allow_fallback_segmenter,
        models_dir=args.models_dir,
        lock_path=args.lock,
        corpus_dir=args.corpus_dir,
        translation_id=translation,
        device=args.device,
        batch_size=args.batch_size,
        constrained=args.constrained,
    )
    try:
        recognizer = factory(options, env)
        result = recognizer.pipeline.run(args.file)
    except RecognizerUnavailable as exc:
        print(str(exc), file=err)
        return 2
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"ERREUR {exc}", file=err)
        return 1
    args.out_dir.mkdir(parents=True, exist_ok=True)
    renderer = recognizer.renderer
    if "json" in targets:
        document = build_json(result, renderer, translation, _sha256_of(args.file))
        targets["json"].write_text(
            json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
        )
    if "srt" in targets:
        targets["srt"].write_text(render_srt(result, renderer), encoding="utf-8")
    if "vtt" in targets:
        targets["vtt"].write_text(render_vtt(result, renderer), encoding="utf-8")
    for warning in result.warnings:
        print(f"AVERTISSEMENT {warning}", file=err)
    verses = result.detections()
    print(
        f"{len(verses)} détection(s) · {result.windows} fenêtre(s) · "
        f"{result.timing.get('total_s', 0.0):.1f} s de calcul pour "
        f"{result.duration_s:.1f} s d'audio",
        file=out,
    )
    for path in targets.values():
        print(f"écrit : {path}", file=out)
    return 0


def main(
    argv: Sequence[str] | None = None,
    *,
    env: Mapping[str, str] | None = None,
    out: TextIO | None = None,
    err: TextIO | None = None,
    convert: Converter = ffmpeg_converter,
    recognizer_factory: RecognizerFactory = build_recognizer,
) -> int:
    out, err = out or sys.stdout, err or sys.stderr
    env = os.environ if env is None else env
    parser = _build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    if args.command == "recognize":
        return _recognize(args, env, out, err, recognizer_factory)
    if args.command != "data":
        parser.print_help(out)
        return 0

    paths = _resolve_paths(args, env)
    if paths is None:
        print("Variable d'environnement manquante : AQR_AUDIO_DIR (ou --audio-dir)", file=err)
        return 2
    audio_dir, manifest_path = paths
    config = DataConfig()
    try:
        if args.action == "ingest":
            report = ingest(
                args.inbox or audio_dir / "inbox",
                audio_dir,
                manifest_path,
                config=config,
                convert=convert,
            )
            print(
                f"{len(report.added)} ajouté(s) · {len(report.duplicates)} doublon(s) · "
                f"{len(report.errors)} en erreur",
                file=out,
            )
            for name, duplicate_of in report.duplicates:
                print(f"  doublon {name} (= {duplicate_of})", file=out)
            for name, problems in report.errors:
                for problem in problems:
                    print(f"  ERREUR {name} : {problem}", file=err)
            return 1 if report.errors else 0
        if args.action == "export-labels":
            path = export_labels(manifest_path, audio_dir, args.case_id, force=args.force)
            print(f"étiquettes écrites : {path}", file=out)
        elif args.action == "import-labels":
            case = import_labels(manifest_path, audio_dir, args.case_id, config=config)
            print(
                f"{case.id} : {len(case.expected)} versets, {len(case.non_quran)} zones non "
                f"coraniques — statut {case.statut}",
                file=out,
            )
        elif args.action == "preannotate":
            path = preannotate(
                manifest_path, audio_dir, args.case_id, UnavailablePreAnnotator(), force=args.force
            )
            print(f"pré-annotation écrite : {path}", file=out)
        elif args.action == "quarantine":
            return _quarantine(manifest_path, config, args.recitant, args.dry_run, out)
        else:
            return _split(manifest_path, config, args.dry_run, out)
    except PreannotationUnavailable as exc:
        print(str(exc), file=err)
        return 2
    except FileExistsError as exc:
        print(f"{exc} (--force pour écraser)" if "force" not in str(exc) else str(exc), file=err)
        return 1
    except LabelError as exc:
        for problem in exc.problems:
            print(f"  ERREUR {problem}", file=err)
        return 1
    except (KeyError, FileNotFoundError, ManifestError, ValueError) as exc:
        print(f"ERREUR {exc.args[0] if isinstance(exc, KeyError) else exc}", file=err)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
