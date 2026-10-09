"""Script `build_ref_corpus.py` : commande rejouable et trace sans chemin local."""

from __future__ import annotations

import argparse
from pathlib import Path

from scripts.build_ref_corpus import command_line

from aqr.data.reftrace import portable_path

ROOT = Path("/work/repo")
HOME = Path("/home/someone")


def test_chemins_portables() -> None:
    assert portable_path(Path("~/aqr-ref"), ROOT, HOME) == "~/aqr-ref"
    assert portable_path(HOME / "aqr-ref", ROOT, HOME) == "~/aqr-ref"
    assert portable_path(ROOT / "data" / "corpus", ROOT, HOME) == "data/corpus"
    assert portable_path(Path("tests/fixtures/x.yaml"), ROOT, HOME) == "tests/fixtures/x.yaml"
    outside = portable_path(Path("/mnt/secret-disk/audio"), ROOT, HOME)
    assert outside == "<hors-depot>/audio" and "secret-disk" not in outside


def test_commande_exacte_et_portable() -> None:
    args = argparse.Namespace(
        out_dir=HOME / "aqr-ref",
        manifest=ROOT / "tests/fixtures/ref-corpus/manifest.yaml",
        corpus=ROOT / "data" / "corpus",
        seed=7,
        per_scenario=2,
        scenarios=None,
    )
    assert command_line(args, ROOT, HOME) == (
        "python scripts/build_ref_corpus.py --out-dir ~/aqr-ref "
        "--manifest tests/fixtures/ref-corpus/manifest.yaml --corpus data/corpus "
        "--seed 7 --per-scenario 2"
    )
    args.scenarios = "priere,assise_fr"
    assert command_line(args, ROOT, HOME).endswith("--per-scenario 2 --scenarios priere,assise_fr")
