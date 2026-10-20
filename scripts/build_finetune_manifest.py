#!/usr/bin/env python3
"""Jeu de données du fine-tuning du FastConformer (étape C) : sources épinglées → manifestes NeMo.

    python scripts/build_finetune_manifest.py pin          # épingle toutes les sources
    python scripts/build_finetune_manifest.py fetch --source tadabur --max-files 1 --dry-run
    python scripts/build_finetune_manifest.py fetch --source tadabur --max-files 1
    python scripts/build_finetune_manifest.py build --source tadabur --prune-raw
    python scripts/build_finetune_manifest.py score --source tadabur   # modèle de base, reprenable
    python scripts/build_finetune_manifest.py filter --source tadabur  # seuil : LabelQcConfig

Tout vit hors dépôt, dans $AQR_FINETUNE_DIR : `raw/<source>/` (fichiers téléchargés, vérifiés par
`data/finetune/LOCK.json`), `audio/<source>/<locuteur>/` (WAV mono 16 kHz) et
`manifests/<source>/{train,val}.jsonl` + `report.json` + `build.json`. Un fichier source déjà
traité n'est pas retraité (`--rebuild` pour forcer) ; `--prune-raw` le supprime une fois sa part
écrite (Tadabur complet : 938 Go bruts, ~160 Go de WAV extraits).

Avant d'entraîner, `score` note chaque étiquette coranique par le modèle de base
(`manifests/<source>/qc/scores.jsonl`, une ligne écrite = acquise) et `filter` écrit
`{train,val}.qc.jsonl` sans la queue de distribution, plus `qc/report.json` et la liste d'écoute
des exemples écartés `qc/rejected.m3u` (docs/evaluation/finetune-label-qc.md).

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
import time
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import replace
from fnmatch import fnmatch
from pathlib import Path
from typing import Any

from aqr.alignment.forced import AlignmentConfig
from aqr.corpus.alignment_text import AlignmentTexts
from aqr.corpus.checksums import CorpusChecksumError, CorpusLock
from aqr.corpus.normalize import normalize_arabic
from aqr.corpus.tanzil_format import parse_tanzil_txt
from aqr.data.config import FinetuneConfig, LabelQcConfig
from aqr.data.finetune import (
    BuildContext,
    QuranNgramIndex,
    Utterance,
    corpus_alphabet,
    merge_parts,
    model_graphie,
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
from aqr.data.label_qc import (
    LabelScore,
    LabelScorer,
    LatticeOf,
    QcFlag,
    filter_manifest,
    qc_report,
    rejected_examples,
)
from aqr.domain.models import TimeSpan, VerseRef
from aqr.domain.ports import AudioClip, CtcLattice
from aqr.models.lock import ModelLockError, ModelsLock

ROOT = Path(__file__).resolve().parents[1]
CONFIG = FinetuneConfig()
QC = LabelQcConfig()
QC_MODEL_KEY = "fastconformer-quran"
"""Modèle de base (models/LOCK.json) qui note les étiquettes avant le fine-tuning."""
SCORES = "scores.jsonl"
SCORES_META = "scores.json"
"""Ce qui a produit les scores (modèle, corpus, alignement) : une reprise ne mélange rien."""
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


# --- Contrôle des étiquettes, avant l'entraînement ---------------------------------------------


def quran_sources(arg: str | None) -> list[DatasetSpec]:
    specs = sources_from(arg) if arg else [s for s in FINETUNE_SOURCES.values() if s.quran]
    spoken = [s.key for s in specs if not s.quran]
    if spoken:
        sys.exit(f"contrôle des étiquettes réservé à la récitation : {spoken} n'en est pas")
    return specs


def entry_key(line: str) -> str:
    return str(json.loads(line)["audio_filepath"])


def manifest_lines(manifest_dir: Path) -> list[tuple[str, str]]:
    """(jeu, ligne) de chaque manifeste construit de la source."""
    out: list[tuple[str, str]] = []
    for split in (CONFIG.train_split, CONFIG.val_split):
        path = manifest_dir / f"{split}.jsonl"
        if path.exists():
            text = path.read_text(encoding="utf-8")
            out += [(split, line) for line in text.splitlines() if line.strip()]
    return out


def scored(line: str, done: Mapping[str, LabelScore]) -> bool:
    """Déjà noté, et pour ce texte : un manifeste reconstruit garde ses chemins audio."""
    entry = json.loads(line)
    score = done.get(str(entry["audio_filepath"]))
    return score is not None and score.text == entry["text"]


def load_scores(path: Path) -> dict[str, LabelScore]:
    """Scores par chemin audio ; le dernier écrit fait foi (renotation après reconstruction)."""
    if not path.exists():
        return {}
    scores = (
        LabelScore.from_json(json.loads(line))
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    )
    return {score.key: score for score in scores}


def scoring_meta(args: argparse.Namespace) -> dict[str, Any]:
    """Ce qui fait un score : modèle (révision épinglée), corpus, graphies de l'alignement."""
    return {
        "model": QC_MODEL_KEY,
        "revision": ModelsLock.load(args.models_lock).models[QC_MODEL_KEY].revision,
        "corpus_lock_sha256": sha256_path(args.corpus / "LOCK.json"),
        "variants": [v.value for v in AlignmentConfig().variants],
        "unknown_symbol": "retiré",
    }


def acoustic_model(args: argparse.Namespace) -> Any:
    from aqr.adapters.fastconformer import FastConformerConfig, FastConformerQuranASR

    raw = args.models_dir or os.environ.get("AQR_MODELS_DIR")
    if not raw:
        sys.exit("Variable d'environnement manquante : AQR_MODELS_DIR (ou --models-dir)")
    config = FastConformerConfig(
        models_dir=Path(raw), lock_path=args.models_lock, model_key=QC_MODEL_KEY, device=args.device
    )
    return FastConformerQuranASR(config)


def clip_lattice(model: Any, manifest_dir: Path) -> LatticeOf:
    """Treillis CTC du modèle sur tout le WAV d'une ligne (mono 16 kHz, écrit par `build`)."""

    def lattice_of(entry: Mapping[str, Any]) -> CtcLattice:
        import soundfile as sf

        path = manifest_dir / str(entry["audio_filepath"])
        samples, rate = sf.read(str(path), dtype="float32")
        if rate != CONFIG.sample_rate or samples.ndim != 1:
            raise ValueError(f"{path} : {rate} Hz, {samples.ndim} dimension(s) inattendues")
        clip = AudioClip(samples=samples, sample_rate=rate, source=str(path))
        lattice: CtcLattice = model.lattice(clip, TimeSpan(0.0, len(samples) / rate))
        return lattice

    return lattice_of


def cmd_score(args: argparse.Namespace) -> int:
    from aqr.corpus.tanzil_repository import TanzilCorpusRepository

    data_dir = data_dir_from(args)
    meta = scoring_meta(args)
    texts = AlignmentTexts.from_corpus_dir(args.corpus, TanzilCorpusRepository(args.corpus))
    model = None
    for spec in quran_sources(args.source):
        manifest_dir = data_dir / "manifests" / spec.key
        qc_dir = manifest_dir / QC.scores_dir
        meta_path, scores_path = qc_dir / SCORES_META, qc_dir / SCORES
        if meta_path.exists() and json.loads(meta_path.read_text(encoding="utf-8")) != meta:
            sys.exit(f"{meta_path} : scores d'un autre modèle ou corpus (supprimer {qc_dir})")
        done = load_scores(scores_path)
        todo = [(s, line) for s, line in manifest_lines(manifest_dir) if not scored(line, done)]
        todo = todo[: args.limit]
        print(f"{spec.key} : {len(done)} déjà noté(s), {len(todo)} à noter")
        if not todo:
            continue
        model = model or acoustic_model(args)
        scorer = LabelScorer(
            texts,
            model.encode,
            clip_lattice(model, manifest_dir),
            unknown_symbol=model.unknown_symbol,
            target=lambda text: model_graphie(text, CONFIG),
        )
        qc_dir.mkdir(parents=True, exist_ok=True)
        meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
        start = time.monotonic()
        with scores_path.open("a", encoding="utf-8", newline="\n") as out:
            for count, (split, line) in enumerate(todo, start=1):
                score = scorer.score(json.loads(line), split)
                out.write(json.dumps(score.to_json(), ensure_ascii=False) + "\n")
                out.flush()  # une ligne écrite est acquise : une interruption reprend ici
                if count % args.progress == 0 or count == len(todo):
                    rate = count / max(time.monotonic() - start, 1e-9)
                    print(f"  {count}/{len(todo)} ({rate:.1f} exemples/s)")
    return 0


def histogram_text(distribution: Mapping[str, Any], threshold: float, width: int = 40) -> str:
    """Histogramme des preuves, seuil marqué : lisible dans un terminal."""
    bins = distribution["histogram"]
    peak = max(b["count"] for b in bins) or 1
    rows = []
    for b in bins:
        mark = "  <- seuil" if b["from"] <= threshold < b["to"] else ""
        bar = "#" * round(width * b["count"] / peak)
        rows.append(f"  [{b['from']:8.3f} ; {b['to']:8.3f}[ {b['count']:6d} {bar}{mark}")
    return "\n".join(rows)


def playlist(examples: Sequence[Mapping[str, Any]], manifest_dir: Path) -> str:
    """Liste d'écoute M3U (VLC, mpv…) des exemples écartés, les pires d'abord."""
    lines = ["#EXTM3U"]
    for e in examples:
        llr = "-" if e["llr_per_frame"] is None else f"{e['llr_per_frame']:.3f}"
        lines.append(f"#EXTINF:{round(e['duration'])},{e['flag']} {llr} {e['ref']} {e['speaker']}")
        lines.append(str((manifest_dir / e["key"]).resolve()))
    return "\n".join(lines) + "\n"


def cmd_filter(args: argparse.Namespace) -> int:
    data_dir = data_dir_from(args)
    config = QC if args.min_llr is None else replace(QC, min_llr_per_frame=args.min_llr)
    threshold = config.min_llr_per_frame
    if threshold is None:
        sys.exit("seuil non calibré : LabelQcConfig.min_llr_per_frame (--min-llr pour essayer)")
    for spec in quran_sources(args.source):
        manifest_dir = data_dir / "manifests" / spec.key
        qc_dir = manifest_dir / QC.scores_dir
        scores = load_scores(qc_dir / SCORES)
        lines = manifest_lines(manifest_dir)
        kept_by_split: dict[str, list[str]] = {}
        rejected: list[tuple[LabelScore, QcFlag]] = []
        try:
            for split in (CONFIG.train_split, CONFIG.val_split):
                if not (manifest_dir / f"{split}.jsonl").exists():
                    continue
                kept, dropped = filter_manifest(
                    [line for s, line in lines if s == split], scores, config
                )
                kept_by_split[split] = kept
                rejected += dropped
        except KeyError as exc:
            sys.exit(f"{spec.key} : {exc.args[0]}")
        for split, kept in kept_by_split.items():
            (manifest_dir / f"{split}{config.manifest_suffix}").write_text(
                "".join(line + "\n" for line in kept), encoding="utf-8", newline="\n"
            )
        report = qc_report([scores[entry_key(line)] for _s, line in lines], config)
        report["kept"]["by_split"] = {s: len(k) for s, k in kept_by_split.items()}
        report["scoring"] = json.loads((qc_dir / SCORES_META).read_text(encoding="utf-8"))
        (qc_dir / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        (qc_dir / "rejected.m3u").write_text(
            playlist(rejected_examples(rejected), manifest_dir), encoding="utf-8", newline="\n"
        )
        counts = {k: v["count"] for k, v in report["rejected"].items()}
        print(f"{spec.key} : {report['kept']['count']} gardé(s), écartés {counts}")
        if report["unknown_symbols"]["labels"]:
            print(
                f"  ATTENTION : {report['unknown_symbols']['labels']} étiquette(s) demandent un "
                "symbole inconnu du modèle (<unk>) : reconstruire avec `build --rebuild`"
            )
        if report["distribution"] is not None:
            print(histogram_text(report["distribution"], threshold))
        print(f"  à écouter : {qc_dir / 'rejected.m3u'}")
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

    score = sub.add_parser("score", help="noter chaque étiquette coranique par le modèle de base")
    score.add_argument("--source", help="sources de récitation (défaut : toutes)")
    score.add_argument("--corpus", type=Path, default=ROOT / "data" / "corpus")
    score.add_argument("--models-dir", help="défaut : $AQR_MODELS_DIR")
    score.add_argument("--models-lock", type=Path, default=ROOT / "models" / "LOCK.json")
    score.add_argument("--device", default="auto", help="auto (cuda si disponible), cuda, cpu")
    score.add_argument("--limit", type=int, help="noter au plus N exemples de plus")
    score.add_argument("--progress", type=int, default=50, help="avancement tous les N exemples")
    score.set_defaults(func=cmd_score)

    filt = sub.add_parser("filter", help="écrire les manifestes filtrés, le rapport, l'écoute")
    filt.add_argument("--source", help="sources de récitation (défaut : toutes)")
    filt.add_argument("--min-llr", type=float, help="essayer un autre seuil que LabelQcConfig")
    filt.set_defaults(func=cmd_filter)
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
