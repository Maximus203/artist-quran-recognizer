"""Point d'entrée CLI : `aqr data ...` (outillage de données), `aqr recognize FICHIER`
(reconnaissance de bout en bout : JSON `aqr.recognition/1` puis SRT/VTT) et `aqr align FICHIER
--verses ...` (alignement forcé de versets déclarés : JSON `aqr.alignment/1`, ADR-0006).

Chemins : `$AQR_AUDIO_DIR` (obligatoire, ou `--audio-dir`) ; le manifeste est, par ordre de
priorité, `--manifest`, `$AQR_MANIFEST`, `tests/fixtures/audio/manifest.yaml` (depuis la racine du
dépôt) puis `<audio_dir>/manifest.yaml`.

Codes de sortie : 0 succès · 1 erreur sur les données (fiche, étiquettes, cas inconnu, fichier
absent ou déjà écrit) · 2 utilisation impossible (variable manquante, moteur ou option
indisponible) · 3 `export-subtitles` : des passages ambigus restent à corriger (voir ADR-0014).

`aqr export-subtitles PREDICTION` (SRT, WebVTT, ASS, JSON), `aqr export-readiness PREDICTION` (le
contrôle « prêt à exporter ? ») et `aqr corpus-verse REF` (un verset lu dans le corpus) servent
l'atelier et la ligne de commande : voir `docs/DECISIONS.md` et
`docs/design/export-sous-titres.md`.
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

from aqr.alignment.plan import plan_document, propose_passages
from aqr.alignment.service import (
    AlignerUnavailable,
    AlignmentService,
    AlignOptions,
    PassageRequest,
    align_passages,
    alignment_document,
    build_alignment_service,
    parse_verse_spec,
    passage_of,
    read_plan,
)
from aqr.corpus.checksums import CorpusChecksumError
from aqr.data.alignment_import import import_alignment
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
from aqr.export.options import ExportOptions, OptionsError, parse_options
from aqr.export.service import (
    Environment as ExportEnvironment,
)
from aqr.export.service import (
    ExportBlocked,
    InputsError,
    corpus_verse,
    load_inputs,
    run_export,
    run_readiness,
)
from aqr.export.service import Inputs as ExportInputs
from aqr.pipeline.factory import (
    ASR_CHOICES,
    CASCADE,
    CONSTRAINED_UNAVAILABLE,
    RecognizeOptions,
    Recognizer,
    RecognizerUnavailable,
    build_recognizer,
)
from aqr.pipeline.output import SCHEMA as RECOGNITION_SCHEMA
from aqr.pipeline.output import build_json, render_srt, render_vtt

_DEFAULT_MANIFEST = Path("tests/fixtures/audio/manifest.yaml")
_FORMATS = ("json", "srt", "vtt")
RecognizerFactory = Callable[[RecognizeOptions, Mapping[str, str]], Recognizer]
AlignerFactory = Callable[[AlignOptions, Mapping[str, str]], AlignmentService]


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

    imp = sub.add_parser(
        "import-alignment",
        help="passages alignés et validés à l'oreille -> vérité terrain (ADR-0006)",
    )
    imp.add_argument("alignment", type=Path, help="document aqr.alignment/2 des passages validés")
    imp.add_argument("--reviewed-by", required=True, help="identifiant anonyme (ex. rel-01)")
    imp.add_argument("--date", help="AAAA-MM-JJ de la validation")
    imp.add_argument("--note", help="note de provenance (défaut : méthode et relecteur unique)")

    rec = commands.add_parser(
        "recognize", help="audio/vidéo -> versets horodatés (JSON puis SRT/VTT)"
    )
    rec.add_argument("file", type=Path)
    rec.add_argument("--out-dir", type=Path, default=Path("aqr-out"))
    rec.add_argument("--format", default="json,srt", help="liste parmi json,srt,vtt")
    rec.add_argument("--force", action="store_true", help="écraser des sorties existantes")
    rec.add_argument("--translation", default="french_hameedullah", help="identifiant ou « none »")
    rec.add_argument("--asr", default=CASCADE, choices=ASR_CHOICES)
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
    rec.add_argument(
        "--no-acoustic-check",
        dest="acoustic_check",
        action="store_false",
        help="ne pas vérifier les suites sur le treillis du FastConformer (ADR-0008) : preuve "
        "textuelle seule, temps = bords des fenêtres",
    )

    ali = commands.add_parser(
        "align",
        help="versets déclarés -> limites mot à mot sur l'audio (alignement forcé, ADR-0006)",
    )
    ali.add_argument("file", type=Path)
    what = ali.add_mutually_exclusive_group(required=True)
    what.add_argument(
        "--verses",
        help="ce qui est récité, dans l'ordre : « 112:1-4 », « 21:51-23:118 », « 2:255[1-10] »",
    )
    what.add_argument(
        "--plan",
        type=Path,
        help="plusieurs passages : plan `aqr.align-plan/1` (voir plan-alignment)",
    )
    ali.add_argument(
        "--at", help="passage « début-fin » en secondes (avec --verses ; défaut : tout)"
    )
    ali.add_argument("--out-dir", type=Path, default=Path("aqr-out"))
    ali.add_argument("--force", action="store_true", help="écraser une sortie existante")
    ali.add_argument("--models-dir", type=Path, help="défaut : $AQR_MODELS_DIR")
    ali.add_argument("--lock", type=Path, default=Path("models/LOCK.json"))
    ali.add_argument("--corpus-dir", type=Path, default=Path("data/corpus"))
    ali.add_argument("--device", default="auto", help="auto | cpu | cuda")
    ali.add_argument(
        "--energy-ratio",
        type=float,
        default=AlignOptions.energy_ratio,
        help="affinage des limites par l'énergie (0 = désactivé ; défaut provisoire, ADR-0006)",
    )

    pla = commands.add_parser(
        "plan-alignment",
        help="sortie de recognize -> passages proposés à aligner (à corriger par l'humain)",
    )
    pla.add_argument("prediction", type=Path, help="<fichier>.recognition.json")
    pla.add_argument("--out", type=Path, help="défaut : sortie standard")
    _add_export_commands(commands)
    return parser


def _add_export_commands(commands: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    """`export-subtitles`, `export-readiness`, `corpus-verse` (voir `aqr.export.service`)."""

    def common(cmd: argparse.ArgumentParser) -> None:
        cmd.add_argument("--corpus-dir", type=Path, default=Path("data/corpus"))
        cmd.add_argument(
            "--options", default="{}", help="options d'export (objet JSON, voir aqr.export.options)"
        )
        cmd.add_argument(
            "--no-translations",
            action="store_true",
            help="ne lire ni le cache ni l'API QuranEnc (hors ligne strict)",
        )

    def passage(cmd: argparse.ArgumentParser) -> None:
        cmd.add_argument("prediction", type=Path, help="<fichier>.recognition.json")
        cmd.add_argument("--decisions", type=Path, help="decisions.json (aqr.decisions/1)")
        cmd.add_argument("--review", type=Path, help="review.json (aqr.review/2)")
        cmd.add_argument(
            "--blocking-tags",
            default="",
            help="étiquettes de revue qui bloquent l'export, séparées par des virgules",
        )
        common(cmd)

    sub = commands.add_parser(
        "export-subtitles",
        help="prédiction + décisions -> sous-titres SRT, WebVTT, ASS ou JSON (ADR-0014)",
    )
    passage(sub)
    sub.add_argument("--out", type=Path, help="fichier à écrire")
    sub.add_argument("--force", action="store_true", help="écraser le fichier existant")
    sub.add_argument(
        "--preview", type=int, metavar="N", help="n'écrit rien : résumé et N premiers sous-titres"
    )
    sub.add_argument("--format", dest="fmt", help="srt | vtt | ass | json (défaut : options)")
    sub.add_argument("--content", help="ar_fr | ar | fr")
    sub.add_argument("--policy", help="omit | marker | first (passages non résolus, si forcé)")
    sub.add_argument(
        "--allow-unresolved",
        action="store_true",
        help="forcer l'export malgré les passages ambigus",
    )

    ready = commands.add_parser(
        "export-readiness", help="le contrôle « prêt à exporter ? » : passages ambigus et décisions"
    )
    passage(ready)
    ready.add_argument("--page", type=int, default=0)
    ready.add_argument("--size", type=int, default=10)
    ready.add_argument(
        "--type", dest="item_type", help="uncertain | inferred | cut | approx | report"
    )

    verse = commands.add_parser(
        "corpus-verse", help="un verset lu dans le corpus (jamais un modèle)"
    )
    verse.add_argument("ref", help="sourate:verset")
    verse.add_argument("--words", help="plage de mots « début-fin »")
    common(verse)


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
        acoustic_check=args.acoustic_check,
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
    # Sous-titres d'abord : ils n'ont besoin d'aucune traduction, et le JSON (qui en a besoin, par
    # verset et pour la basmala) peut échouer hors ligne après plus d'une minute de calcul.
    if "srt" in targets:
        targets["srt"].write_text(render_srt(result, renderer), encoding="utf-8")
    if "vtt" in targets:
        targets["vtt"].write_text(render_vtt(result, renderer), encoding="utf-8")
    if "json" in targets:
        try:
            document = build_json(result, renderer, translation, _sha256_of(args.file))
        except (OSError, ValueError, RuntimeError) as exc:
            print(
                f"ERREUR rendu du JSON impossible : {exc}. La traduction (QuranEnc) est peut-être "
                "indisponible : réessayer avec le réseau, ou avec --translation none.",
                file=err,
            )
            return 1
        targets["json"].write_text(
            json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
        )
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


def _align(
    args: argparse.Namespace,
    env: Mapping[str, str],
    out: TextIO,
    err: TextIO,
    factory: AlignerFactory,
) -> int:
    if not args.file.is_file():
        print(f"ERREUR fichier introuvable : {args.file}", file=err)
        return 1
    target = args.out_dir / f"{args.file.stem}.alignment.json"
    if target.exists() and not args.force:
        print(f"ERREUR sortie déjà présente : {target} (--force pour écraser)", file=err)
        return 1
    options = AlignOptions(
        models_dir=args.models_dir,
        lock_path=args.lock,
        corpus_dir=args.corpus_dir,
        device=args.device,
        energy_ratio=args.energy_ratio or None,
    )
    sha256 = _sha256_of(args.file)
    try:
        service = factory(options, env)
        if args.verses is not None:
            parse_verse_spec(args.verses, service.texts.word_count)
        plan = (
            read_plan(json.loads(args.plan.read_text(encoding="utf-8")), sha256)
            if args.plan is not None
            else None
        )
    except AlignerUnavailable as exc:
        print(str(exc), file=err)
        return 2
    except (ValueError, KeyError, OSError) as exc:
        print(f"ERREUR {exc}", file=err)
        return 2
    try:
        clip = service.extract(args.file)
        duration = len(clip.samples) / clip.sample_rate
        requests = plan or [PassageRequest(passage_of(args.at, duration), args.verses)]
        passages = align_passages(service, clip, requests)
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"ERREUR {exc}", file=err)
        return 1
    failed = [p for p in passages if "error" in p]
    if len(failed) == len(passages):
        for passage in failed:
            print(f"ERREUR {passage['error']}", file=err)
        return 1
    source = {"file": args.file.name, "sha256": sha256, "duration_s": duration}
    document = alignment_document(source=source, service=service, passages=passages)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for passage in failed:
        print(f"AVERTISSEMENT passage {passage['t']} : {passage['error']}", file=err)
    for passage in passages:
        if "error" not in passage:
            print(
                f"{passage['t'][0]:.1f}-{passage['t'][1]:.1f} s · {passage['declared']} · "
                f"preuve acoustique {passage['evidence']['llr_per_frame']:.3f} par trame",
                file=out,
            )
    print(f"écrit : {target}", file=out)
    return 0


def _import_alignment(
    args: argparse.Namespace, env: Mapping[str, str], out: TextIO, err: TextIO
) -> int:
    """Aucun audio n'est lu : seul le manifeste est requis (`--manifest`, `$AQR_MANIFEST`, puis
    celui du dépôt)."""
    manifest = args.manifest or (Path(env["AQR_MANIFEST"]) if env.get("AQR_MANIFEST") else None)
    manifest = manifest or _DEFAULT_MANIFEST
    try:
        document = json.loads(args.alignment.read_text(encoding="utf-8"))
        report = import_alignment(
            manifest,
            document,
            reviewed_by=args.reviewed_by,
            config=DataConfig(),
            date=args.date,
            note=args.note,
        )
    except (OSError, ValueError, ManifestError) as exc:
        print(f"ERREUR {exc}", file=err)
        return 1
    windows = ", ".join(f"{a:.1f}-{b:.1f}" for a, b in report.windows) or "fichier entier"
    print(
        f"{report.case_id} : {report.verses} verset(s) de vérité terrain · fenêtres {windows} · "
        f"écrit : {manifest}",
        file=out,
    )
    return 0


def _export_environment(args: argparse.Namespace, env: Mapping[str, str]) -> ExportEnvironment:
    cache = env.get("AQR_CACHE_DIR") or os.path.join(os.path.expanduser("~"), ".cache", "aqr")
    return ExportEnvironment(
        corpus_dir=args.corpus_dir,
        cache_dir=None if args.no_translations else Path(cache) / "translations",
        segments_dir=Path(env.get("AQR_SEGMENTS_DIR") or "data/translation-segments"),
    )


def _export_options(args: argparse.Namespace) -> ExportOptions:
    try:
        raw = json.loads(args.options)
    except json.JSONDecodeError as exc:
        raise OptionsError(f"--options : JSON invalide ({exc})") from None
    if not isinstance(raw, dict):
        raise OptionsError("--options : un objet JSON est attendu")
    for key, value in (
        ("format", getattr(args, "fmt", None)),
        ("content", getattr(args, "content", None)),
        ("policy", getattr(args, "policy", None)),
    ):
        if value:
            raw[key] = value
    if getattr(args, "allow_unresolved", False):
        raw["allow_unresolved"] = True
    return parse_options(raw)


def _export_common(
    args: argparse.Namespace, env: Mapping[str, str]
) -> tuple[ExportInputs, ExportOptions, ExportEnvironment, frozenset[str]]:
    options = _export_options(args)
    inputs = load_inputs(args.prediction, args.decisions, args.review)
    tags = frozenset(t.strip() for t in args.blocking_tags.split(",") if t.strip())
    return inputs, options, _export_environment(args, env), tags


def _print_json(document: object, out: TextIO) -> None:
    out.write(json.dumps(document, ensure_ascii=False, indent=1) + "\n")


def _export_subtitles(
    args: argparse.Namespace, env: Mapping[str, str], out: TextIO, err: TextIO
) -> int:
    if args.out is None and args.preview is None:
        print("ERREUR --out FICHIER ou --preview N est requis", file=err)
        return 2
    if args.out is not None and args.out.exists() and not args.force:
        print(f"ERREUR sortie déjà présente : {args.out} (--force pour écraser)", file=err)
        return 1
    try:
        inputs, options, environment, tags = _export_common(args, env)
        result = run_export(inputs, options, environment, tags, preview=args.preview)
    except (OptionsError, InputsError, CorpusChecksumError, OSError, ValueError) as exc:
        print(f"ERREUR {exc}", file=err)
        return 1
    except ExportBlocked as exc:
        print(f"ERREUR {exc} : corriger ou forcer (--allow-unresolved)", file=err)
        _print_json({"error": "unresolved_items", "unresolved": exc.unresolved}, out)
        return 3
    if args.out is not None and args.preview is None:
        data = result.content.encode("utf-8")
        if options.bom and options.format != "json":
            data = b"\xef\xbb\xbf" + data
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_bytes(data)
        result.summary["file"] = args.out.name
        result.summary["bytes"] = len(data)
    _print_json(result.summary, out)
    return 0


def _export_readiness(
    args: argparse.Namespace, env: Mapping[str, str], out: TextIO, err: TextIO
) -> int:
    try:
        inputs, options, environment, tags = _export_common(args, env)
        payload = run_readiness(
            inputs,
            options,
            environment,
            tags,
            page=max(0, args.page),
            size=args.size,
            type_filter=args.item_type,
        )
    except (OptionsError, InputsError, CorpusChecksumError, OSError, ValueError) as exc:
        print(f"ERREUR {exc}", file=err)
        return 1
    _print_json(payload, out)
    return 0


def _corpus_verse(
    args: argparse.Namespace, env: Mapping[str, str], out: TextIO, err: TextIO
) -> int:
    words: tuple[int, int] | None = None
    try:
        if args.words:
            first, _, last = args.words.partition("-")
            words = (int(first), int(last or first))
        payload = corpus_verse(
            args.ref, words, _export_options(args), _export_environment(args, env)
        )
    except (OptionsError, CorpusChecksumError, OSError, ValueError) as exc:
        print(f"ERREUR {exc}", file=err)
        return 1
    _print_json(payload, out)
    return 0 if payload.get("ok") else 1


def _plan_alignment(args: argparse.Namespace, out: TextIO, err: TextIO) -> int:
    try:
        prediction = json.loads(args.prediction.read_text(encoding="utf-8"))
        if prediction.get("schema") != RECOGNITION_SCHEMA:
            raise ValueError(f"{args.prediction} n'est pas une sortie {RECOGNITION_SCHEMA}")
        source = prediction["source"]
        proposals = propose_passages(prediction["intervals"], float(source["duration_s"]))
    except (OSError, ValueError, KeyError) as exc:
        print(f"ERREUR {exc}", file=err)
        return 1
    text = json.dumps(plan_document(source, proposals), ensure_ascii=False, indent=1) + "\n"
    if args.out is None:
        out.write(text)
    else:
        args.out.write_text(text, encoding="utf-8")
        print(f"{len(proposals)} passage(s) proposé(s) · écrit : {args.out}", file=out)
    return 0


def main(
    argv: Sequence[str] | None = None,
    *,
    env: Mapping[str, str] | None = None,
    out: TextIO | None = None,
    err: TextIO | None = None,
    convert: Converter = ffmpeg_converter,
    recognizer_factory: RecognizerFactory = build_recognizer,
    aligner_factory: AlignerFactory = build_alignment_service,
) -> int:
    out, err = out or sys.stdout, err or sys.stderr
    env = os.environ if env is None else env
    parser = _build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    if args.command == "recognize":
        return _recognize(args, env, out, err, recognizer_factory)
    if args.command == "align":
        return _align(args, env, out, err, aligner_factory)
    if args.command == "plan-alignment":
        return _plan_alignment(args, out, err)
    if args.command == "export-subtitles":
        return _export_subtitles(args, env, out, err)
    if args.command == "export-readiness":
        return _export_readiness(args, env, out, err)
    if args.command == "corpus-verse":
        return _corpus_verse(args, env, out, err)
    if args.command != "data":
        parser.print_help(out)
        return 0

    if args.action == "import-alignment":
        return _import_alignment(args, env, out, err)
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
