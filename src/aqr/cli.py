"""Point d'entrée CLI : `aqr data ...` (outillage de données). La reconnaissance de bout en bout
(`aqr recognize`) arrive en phase 5 — voir docs/PLAN.md.

Chemins : `$AQR_AUDIO_DIR` (obligatoire, ou `--audio-dir`) ; le manifeste est, par ordre de
priorité, `--manifest`, `$AQR_MANIFEST`, `tests/fixtures/audio/manifest.yaml` (depuis la racine du
dépôt) puis `<audio_dir>/manifest.yaml`.

Codes de sortie : 0 succès · 1 erreur sur les données (fiche, étiquettes, cas inconnu) ·
2 utilisation impossible (variable manquante, moteur indisponible).
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Mapping, Sequence
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
from aqr.data.split import assign_splits

_DEFAULT_MANIFEST = Path("tests/fixtures/audio/manifest.yaml")


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
    for side in config.splits:
        names = sorted(r for r, s in mapping.items() if s == side)
        hours = sum(c.duree_s or 0 for c in manifest.cases if mapping[c.recitant] == side) / 3600
        print(
            f"{side:5s} {len(names):2d} récitants · {hours:5.2f} h · {', '.join(names)}", file=out
        )
    print(f"{changed} cas affecté(s){' (simulation)' if dry_run else ''}", file=out)
    return 0


def main(
    argv: Sequence[str] | None = None,
    *,
    env: Mapping[str, str] | None = None,
    out: TextIO | None = None,
    err: TextIO | None = None,
    convert: Converter = ffmpeg_converter,
) -> int:
    out, err = out or sys.stdout, err or sys.stderr
    env = os.environ if env is None else env
    parser = _build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
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
