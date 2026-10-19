#!/usr/bin/env python3
"""Jeu de données du fine-tuning du FastConformer (étape C) : sources épinglées → manifestes NeMo.

    python scripts/build_finetune_manifest.py pin          # épingle toutes les sources
    python scripts/build_finetune_manifest.py fetch --source tadabur --max-files 1 --dry-run
    python scripts/build_finetune_manifest.py fetch --source tadabur --max-files 1
    python scripts/build_finetune_manifest.py build --source tadabur --prune-raw

Tout vit hors dépôt, dans $AQR_FINETUNE_DIR : `raw/<source>/` (fichiers téléchargés, vérifiés par
`data/finetune/LOCK.json`), `audio/<source>/<locuteur>/` (WAV mono 16 kHz) et
`manifests/<source>/{train,val}.jsonl` + `report.json` + `build.json`. Un fichier source déjà
traité n'est pas retraité (`--rebuild` pour forcer) ; `--prune-raw` le supprime une fois sa part
écrite (Tadabur complet : 938 Go bruts, ~160 Go de WAV extraits).

Sources, licences, exclusions : docs/evaluation/finetune-data.md. Aucun entraînement ici.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
from collections.abc import Iterator, Sequence
from fnmatch import fnmatch
from pathlib import Path

from aqr.corpus.checksums import CorpusChecksumError, CorpusLock
from aqr.corpus.normalize import normalize_arabic
from aqr.corpus.tanzil_format import parse_tanzil_txt
from aqr.data.config import FinetuneConfig
from aqr.data.finetune import (
    BuildContext,
    QuranNgramIndex,
    Utterance,
    corpus_alphabet,
    merge_parts,
    part_done,
    process_utterances,
    tadabur_speaker,
    write_part,
)
from aqr.data.finetune_lock import data_files, fetch_files, pin_source, verify_files
from aqr.data.finetune_sources import (
    EXCLUDED_TADABUR_RECITERS,
    FINETUNE_SOURCES,
    DatasetSpec,
    ExcludedVoice,
    SourceKind,
)
from aqr.domain.models import VerseRef
from aqr.models.lock import ModelLockError, ModelsLock

ROOT = Path(__file__).resolve().parents[1]
CONFIG = FinetuneConfig()
SIMPLE_KEY = "simple"
"""Fichier du corpus (data/corpus/LOCK.json) qui porte la graphie cible : imla'i vocalisée."""


def data_dir_from(args: argparse.Namespace) -> Path:
    raw = args.data_dir or os.environ.get(CONFIG.env_var)
    if not raw:
        sys.exit(f"Variable d'environnement manquante : {CONFIG.env_var} (ou --data-dir)")
    path = Path(raw).expanduser().resolve()
    if path == ROOT or ROOT in path.parents:
        sys.exit(f"{path} est dans le dépôt : audio et manifestes vivent hors dépôt (AGENTS.md)")
    return path


def sources_from(arg: str | None) -> list[DatasetSpec]:
    keys = arg.split(",") if arg else list(FINETUNE_SOURCES)
    unknown = [k for k in keys if k not in FINETUNE_SOURCES]
    if unknown:
        sys.exit(f"source(s) inconnue(s) : {unknown} (connues : {list(FINETUNE_SOURCES)})")
    return [FINETUNE_SOURCES[k] for k in keys]


def part_name(name: str) -> str:
    """`data/train-00384.parquet` → `data__train-00384` : un nom de fichier, stable."""
    return name.rsplit(".", 1)[0].replace("/", "__")


def load_simple_words(corpus_dir: Path) -> dict[VerseRef, tuple[str, ...]]:
    """Mots de la graphie `simple` (vérifiée par data/corpus/LOCK.json), sans les marques seules."""
    lock = CorpusLock.load(corpus_dir / "LOCK.json")
    lock.verify(corpus_dir)
    if SIMPLE_KEY not in lock.files:
        raise CorpusChecksumError(f"« {SIMPLE_KEY} » absent de data/corpus/LOCK.json")
    raw = (corpus_dir / lock.files[SIMPLE_KEY].path).read_text(encoding="utf-8")
    return {
        ref: tuple(w for w in text.split() if normalize_arabic(w))
        for ref, text in parse_tanzil_txt(raw).items()
    }


def excluded_voices(spec: DatasetSpec) -> dict[str, ExcludedVoice]:
    if spec.kind is not SourceKind.TADABUR:
        return {}
    return {tadabur_speaker(i): v for i, v in EXCLUDED_TADABUR_RECITERS.items()}


def check_exclusions(spec: DatasetSpec, raw_dir: Path) -> None:
    """Chaque voix exclue doit exister dans le dictionnaire épinglé (un id faux n'exclut rien)."""
    if spec.kind is not SourceKind.TADABUR:
        return
    path = raw_dir / spec.key / "sheikh_dict.json"
    known = set(json.loads(path.read_text(encoding="utf-8-sig")).values())
    missing = sorted(set(EXCLUDED_TADABUR_RECITERS) - known)
    if missing:
        sys.exit(f"{spec.key} : voix exclue(s) absente(s) de sheikh_dict.json : {missing}")


def utterances(spec: DatasetSpec, name: str, raw_dir: Path) -> Iterator[Utterance]:
    from aqr.data.finetune_readers import iter_common_voice, iter_fleurs, iter_tadabur

    unit = next(u for u in spec.units if fnmatch(name, u.pattern))
    path = raw_dir / spec.key / name
    if spec.kind is SourceKind.TADABUR:
        return iter_tadabur(path)
    if unit.split is None:
        raise ValueError(f"{spec.key} : {name} sans jeu officiel")
    if spec.kind is SourceKind.FLEURS:
        return iter_fleurs(path, unit.split)
    if unit.transcript is None:
        raise ValueError(f"{spec.key} : {name} sans fichier de transcriptions")
    return iter_common_voice(path, raw_dir / spec.key / unit.transcript, unit.split)


def git_head() -> str | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return out.stdout.strip()


def sha256_path(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# --- Sous-commandes ---------------------------------------------------------------------------


def cmd_pin(args: argparse.Namespace) -> int:
    from aqr.models.hf_hub import HfHub

    raw_dir = data_dir_from(args) / "raw"
    lock = ModelsLock.load(args.lock)
    hub = HfHub(token=os.environ.get("HF_TOKEN") or None, repo_type="dataset")
    for spec in sources_from(args.source):
        entry = pin_source(spec, lock, hub, raw_dir, revision=args.revision, repin=args.repin)
        lock.save(args.lock)
        total = sum(f.size for f in entry.files.values()) / 1e9
        print(
            f"ok {spec.key} @ {entry.revision[:12]} · {len(entry.files)} fichier(s) · "
            f"{total:.1f} Go"
        )
    return 0


def selected(spec: DatasetSpec, lock: ModelsLock, args: argparse.Namespace) -> list[str]:
    only = args.only.split(",") if args.only else None
    return data_files(spec, lock, max_files=args.max_files, only=only)


def cmd_fetch(args: argparse.Namespace) -> int:
    from aqr.models.hf_hub import HfHub

    raw_dir = data_dir_from(args) / "raw"
    lock = ModelsLock.load(args.lock)
    hub = HfHub(token=os.environ.get("HF_TOKEN") or None, repo_type="dataset")
    for spec in sources_from(args.source):
        names = [*spec.aux, *selected(spec, lock, args)]
        entry = lock.models[spec.key]
        size = sum(entry.files[n].size for n in names) / 1e9
        print(f"{spec.key} @ {entry.revision[:12]} : {len(names)} fichier(s), {size:.2f} Go")
        if args.dry_run:
            for name in names:
                print(f"  {name}  {entry.files[name].sha256[:12]}…  {entry.files[name].size}")
            continue
        for path in fetch_files(spec, names, lock, hub, raw_dir):
            print(f"  ok {path.relative_to(raw_dir)} (sha256 conforme)")
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    from aqr.data.finetune_readers import decode_audio

    data_dir = data_dir_from(args)
    raw_dir = data_dir / "raw"
    lock = ModelsLock.load(args.lock)
    simple = load_simple_words(args.corpus)
    alphabet = corpus_alphabet(" ".join(words) for words in simple.values())
    index = QuranNgramIndex(simple.values(), n=CONFIG.quran_ngram)
    for spec in sources_from(args.source):
        check_exclusions(spec, raw_dir)
        ctx = BuildContext(
            spec=spec,
            config=CONFIG,
            simple_words=simple,
            alphabet=alphabet,
            quran_index=index,
            excluded=excluded_voices(spec),
            audio_root=data_dir / "audio",
            manifest_dir=data_dir / "manifests" / spec.key,
        )
        manifest_dir = ctx.manifest_dir
        parts_dir = manifest_dir / "parts"
        for name in selected(spec, lock, args):
            label = part_name(name)
            if part_done(parts_dir, label) and not args.rebuild:
                continue
            path = raw_dir / spec.key / name
            if not path.exists():
                continue
            verify_files(spec, [name], lock, raw_dir)
            part = process_utterances(
                utterances(spec, name, raw_dir), ctx, lambda b: decode_audio(b, CONFIG.sample_rate)
            )
            write_part(parts_dir, label, part)
            kept = sum(len(e) for e in part.entries.values())
            print(
                f"  {spec.key}/{name} : {kept} retenu(s), "
                f"rejets {part.report.to_json()['rejected']}"
            )
            if args.prune_raw:
                path.unlink()
        try:
            summary = merge_parts(manifest_dir, CONFIG)
        except FileNotFoundError:
            print(f"{spec.key} : aucun fichier téléchargé (lancer `fetch`)")
            continue
        trace = {
            "source": spec.key,
            "repo_id": spec.repo_id,
            "revision": lock.models[spec.key].revision,
            "license": spec.license,
            "finetune_lock_sha256": sha256_path(args.lock),
            "corpus_lock_sha256": sha256_path(args.corpus / "LOCK.json"),
            "git": git_head(),
            "python": platform.python_version(),
            "config": {k: v for k, v in vars(CONFIG).items()},
            "excluded_voices": {k: vars(v) for k, v in excluded_voices(spec).items()},
        }
        (manifest_dir / "build.json").write_text(
            json.dumps(trace, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"{spec.key} : {json.dumps(summary['kept'], ensure_ascii=False)}")
    return 0


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--data-dir", help=f"défaut : ${CONFIG.env_var}")
    p.add_argument("--lock", type=Path, default=ROOT / "data" / "finetune" / "LOCK.json")
    sub = p.add_subparsers(dest="command", required=True)

    pin = sub.add_parser(
        "pin", help="épingler révision + sha256 (sans télécharger les gros fichiers)"
    )
    pin.add_argument("--source", help=f"séparées par des virgules ({', '.join(FINETUNE_SOURCES)})")
    pin.add_argument("--revision", help="révision à épingler (défaut : tête du dépôt)")
    pin.add_argument("--repin", action="store_true", help="accepter une nouvelle version")
    pin.set_defaults(func=cmd_pin)

    for name, func, help_ in (
        ("fetch", cmd_fetch, "télécharger les fichiers épinglés et vérifier leur sha256"),
        ("build", cmd_build, "extraire l'audio et écrire les manifestes NeMo"),
    ):
        cmd = sub.add_parser(name, help=help_)
        cmd.add_argument("--source", help="séparées par des virgules (défaut : toutes)")
        cmd.add_argument("--max-files", type=int, help="les N premiers fichiers de données")
        cmd.add_argument("--only", help="fichiers de données précis, séparés par des virgules")
        cmd.set_defaults(func=func)
        if name == "fetch":
            cmd.add_argument("--dry-run", action="store_true", help="lister sans télécharger")
        else:
            cmd.add_argument("--corpus", type=Path, default=ROOT / "data" / "corpus")
            cmd.add_argument("--rebuild", action="store_true", help="retraiter les parts faites")
            cmd.add_argument(
                "--prune-raw", action="store_true", help="supprimer le fichier source traité"
            )
    return p


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        return int(args.func(args))
    except (ModelLockError, CorpusChecksumError, OSError) as exc:
        print(f"ERREUR : {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
