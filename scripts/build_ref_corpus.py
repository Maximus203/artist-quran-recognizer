#!/usr/bin/env python3
"""Construit le corpus de référence : mixages à vérité exacte, silence, parole hors cible et
versions dégradées (bruit, téléphone, réverbération, MP3, silence en tête), avec manifeste.

    python scripts/fetch_everyayah.py --dest ~/aqr-ref/everyayah      # sources (hors dépôt)
    python scripts/build_ref_corpus.py --seed 7 --per-scenario 2

Audios : ~/aqr-ref (--out-dir ; jamais dans le dépôt). Sources : <out-dir>/everyayah,
<out-dir>/specials et <out-dir>/speech (voir scripts/make_mix.py ; un scénario sans source est
écarté avec sa raison). Manifeste : tests/fixtures/ref-corpus/manifest.yaml (schéma figé :
src/aqr/data/refcorpus.py). Droits des sources : docs/data-lots/ref-corpus-provenance.md.

Règles du découpage
- Récitants disjoints entre dev et test, et rien n'est réaffecté d'un lancement à l'autre : les
  affectations du manifeste existant sont reprises telles quelles, même si les paramètres changent.
- Un même enregistrement source (fichier de speech/ ou de specials/) ne sert qu'à un seul jeu. La
  parole hors cible prend un pseudo-récitant dérivé de son contenu ; un mixage dont une source est
  déjà dans l'autre jeu est écarté (raison affichée). Avec un seul clip par special, la prière
  n'existe donc que d'un côté : fournir un clip distinct par jeu pour couvrir les deux.
- Un récitant EveryAyah sans basmala (ex. Abdul_Basit_Murattal_192kbps) est écarté, avec sa raison.

Reproduire
- La trace `manifest.build.json`, écrite à côté du manifeste, consigne tout ce qui détermine le
  résultat : graine, sel du découpage, scénarios, dégradations, récitants retenus et écartés,
  SHA-256 du LOCK.json d'EveryAyah, fichiers speech/ et specials/ utilisés (nom + SHA-256),
  versions de ffmpeg et de libmp3lame, SHA git du code et commande exacte.
- Rejouer cette commande sur les mêmes sources (même LOCK.json, même ffmpeg) redonne le manifeste
  octet pour octet : `git diff tests/fixtures/ref-corpus/manifest.yaml` doit être vide.
- Seule `manifest.build.json` peut changer d'un rejeu à l'autre (SHA git du code).
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path
from typing import Any

from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.data.config import DataConfig
from aqr.data.ingest import sha256_file
from aqr.data.mixer import SCENARIOS
from aqr.data.refbuild import (
    DEFAULT_DEGRADATIONS,
    ReferenceClipProvider,
    build_ref_corpus,
    ensure_outside_repo,
)
from aqr.data.refcorpus import RefCorpusError
from aqr.data.reftrace import portable_path, trace_path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = "scripts/build_ref_corpus.py"
CODE_PATHS = ("src", "scripts", "pyproject.toml")
"""Ce qui détermine le résultat du build : le SHA git n'a de sens que si cela n'a pas bougé."""


def command_line(args: argparse.Namespace, root: Path, home: Path) -> str:
    """Commande exacte (toutes les valeurs effectives), avec des chemins portables."""
    parts = [
        "python",
        SCRIPT,
        "--out-dir",
        portable_path(args.out_dir, root, home),
        "--manifest",
        portable_path(args.manifest, root, home),
        "--corpus",
        portable_path(args.corpus, root, home),
        "--seed",
        str(args.seed),
        "--per-scenario",
        str(args.per_scenario),
    ]
    if args.scenarios:
        parts += ["--scenarios", args.scenarios]
    return " ".join(parts)


def _git(*args: str) -> str:
    done = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=False)
    return done.stdout.strip() if done.returncode == 0 else ""


def git_state() -> dict[str, Any]:
    """SHA du code qui construit, et `dirty` si le code a des modifications non validées."""
    return {
        "sha": _git("rev-parse", "HEAD") or None,
        "dirty": bool(_git("status", "--porcelain", "--", *CODE_PATHS)),
    }


def lock_sha256(path: Path) -> str | None:
    lock = path / "LOCK.json"
    return sha256_file(lock) if lock.exists() else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--out-dir", type=Path, default=Path("~/aqr-ref"))
    parser.add_argument(
        "--manifest", type=Path, default=ROOT / "tests/fixtures/ref-corpus/manifest.yaml"
    )
    parser.add_argument("--corpus", type=Path, default=ROOT / "data" / "corpus")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--per-scenario", type=int, default=2)
    parser.add_argument("--scenarios", help=f"séparés par des virgules ({', '.join(SCENARIOS)})")
    args = parser.parse_args(argv)

    out_dir = args.out_dir.expanduser()
    try:
        ensure_outside_repo(out_dir, ROOT)
    except RefCorpusError as exc:
        sys.exit(str(exc))
    config = DataConfig()
    corpus = TanzilCorpusRepository(args.corpus)
    provider = ReferenceClipProvider(out_dir, sample_rate=config.sample_rate)
    report = build_ref_corpus(
        provider,
        corpus,
        out_dir,
        args.manifest,
        seed=args.seed,
        per_scenario=args.per_scenario,
        scenarios=args.scenarios.split(",") if args.scenarios else None,
        degradations=DEFAULT_DEGRADATIONS,
        config=config,
        environment={
            "command": command_line(args, ROOT, Path.home()),
            "git": git_state(),
            "tanzil_lock_sha256": lock_sha256(args.corpus),
        },
    )
    for name, reason in report.skipped:
        print(f"ÉCARTÉ {name} : {reason}", file=sys.stderr)
    for name, reason in report.removed:
        print(f"RETIRÉ {name} : {reason}", file=sys.stderr)
    for problem in report.problems:
        print(f"PROBLÈME {problem}", file=sys.stderr)
    cases = report.manifest.cases
    print(
        f"{len(cases)} cas · dev {sum(c.split == 'dev' for c in cases)} · "
        f"test {sum(c.split == 'test' for c in cases)} · {len(report.skipped)} écarté(s)"
    )
    if report.problems:
        print("manifeste NON écrit (voir PROBLÈME)", file=sys.stderr)
        return 1
    print(f"manifeste : {args.manifest}")
    print(f"trace : {trace_path(args.manifest)}")
    return 0 if cases else 1


if __name__ == "__main__":
    sys.exit(main())
