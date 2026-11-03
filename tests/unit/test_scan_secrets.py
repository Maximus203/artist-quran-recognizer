"""Le filet anti-secrets détecte de vrais motifs, ignore les exemples (§13)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "scan_secrets.py"
_spec = importlib.util.spec_from_file_location("scan_secrets", SCRIPT)
assert _spec and _spec.loader
scan = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(scan)


@pytest.mark.parametrize(
    "line",
    [
        "aws = AKIA" + "ABCDEFGHIJKLMNOP",
        "token ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8",
        "HF_TOKEN=hf_" + "aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQ",
        "-----BEGIN RSA " + "PRIVATE KEY-----",
        "bot 123456789:AA" + "Hk3jd8sKd92jSdk2lskdJ2kdl3kdjs8dk",
        "AQR_ACCESS_TOKEN=" + "Zk3Jd9sLw2PqR7vXn5TbY8mC4hF1gA6e",
        'const SECRET_KEY = "' + 'Qw3rTy7UiOp9AsDf2GhJk5LzXc8VbNm1"',
    ],
)
def test_real_looking_secrets_are_detected(line: str) -> None:
    assert list(scan.findings(line)), line


@pytest.mark.parametrize(
    "line",
    [
        'MODEL_KEY = "muno-fastconformer-quran-streaming"',
        "AQR_LIVE_KEY=" + "x" * 40,
        "AQR_ACCESS_TOKEN=" + "t" * 32,
        "AQR_ACCESS_TOKEN=exemple-de-jeton-a-remplacer-ici-1234",
        "AQR_AUDIT_SALT=",
        "HF_TOKEN=",
    ],
)
def test_examples_and_public_identifiers_are_ignored(line: str) -> None:
    assert list(scan.findings(line)) == [], line


def test_output_never_prints_a_whole_secret() -> None:
    hits = list(scan.findings("AQR_ACCESS_TOKEN=" + "Zk3Jd9sLw2PqR7vXn5TbY8mC4hF1gA6e"))
    assert hits and all(len(hit) < 30 for hit in hits)


def test_the_repository_tree_is_clean() -> None:
    assert scan.scan_tree() == []
