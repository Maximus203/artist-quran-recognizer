"""Le smoke e2e ne peut pas « réussir » en silence : en mode strict une ressource absente est un
ÉCHEC avec sa raison ; sinon un skip net, signalé dans un résumé « NON EXÉCUTÉ ».

Pytest imbriqué (sous-processus) : c'est le code de sortie réel que voit la CI qui est testé."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def _run_smoke(tmp_path: Path, **env: str) -> subprocess.CompletedProcess[str]:
    base = {k: v for k, v in os.environ.items() if not k.startswith("AQR_")}
    base["PATH"] = os.environ.get("PATH", "")
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "-m",
            "slow",
            "tests/e2e",
            "-rs",
            "-p",
            "no:cacheprovider",
        ],
        cwd=ROOT,
        env={**base, **env},
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )


@pytest.fixture()
def empty_audio_dir(tmp_path: Path) -> str:
    path = tmp_path / "audio"
    path.mkdir()
    return str(path)


def test_strict_with_empty_audio_dir_fails_with_the_reason(
    tmp_path: Path, empty_audio_dir: str
) -> None:
    done = _run_smoke(tmp_path, AQR_SMOKE_STRICT="1", AQR_AUDIO_DIR=empty_audio_dir)
    out = done.stdout + done.stderr
    assert done.returncode != 0, out
    assert "AQR_SMOKE_STRICT=1" in out
    assert "clip EveryAyah absent" in out
    assert "1 error" in out
    assert "skipped" not in out


def test_strict_without_audio_dir_variable_fails(tmp_path: Path) -> None:
    done = _run_smoke(tmp_path, AQR_SMOKE_STRICT="1")
    out = done.stdout + done.stderr
    assert done.returncode != 0, out
    assert "AQR_AUDIO_DIR absent" in out


@pytest.mark.parametrize("flag", [{}, {"AQR_SMOKE_STRICT": "0"}, {"AQR_SMOKE_STRICT": ""}])
def test_not_strict_skips_with_a_clear_reason_and_a_loud_summary(
    tmp_path: Path, empty_audio_dir: str, flag: dict[str, str]
) -> None:
    done = _run_smoke(tmp_path, AQR_AUDIO_DIR=empty_audio_dir, **flag)
    out = done.stdout + done.stderr
    assert done.returncode == 0, out
    assert "SKIPPED" in out
    assert "clip EveryAyah absent" in out
    assert "NON EXÉCUTÉ" in out  # le résumé dit que rien n'a été vérifié
    assert "AQR_SMOKE_STRICT=1" in out  # et comment en faire un échec
