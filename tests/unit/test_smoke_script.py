"""`scripts/smoke_e2e.sh` : étape inconnue refusée (une faute de frappe ne doit pas « réussir »
sans rien lancer) ; mode strict par défaut ; skip seulement avec AQR_SMOKE_STRICT=0 explicite."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "smoke_e2e.sh"
BASH = shutil.which("bash")

pytestmark = pytest.mark.skipif(BASH is None, reason="bash absent")


def _run(
    tmp_path: Path, *args: str, path: str | None = None, **env: str
) -> subprocess.CompletedProcess[str]:
    audio = tmp_path / "audio"
    clips = audio / "everyayah" / "Alafasy_128kbps"
    clips.mkdir(parents=True, exist_ok=True)
    for ayah in range(1, 5):  # clips présents : le script ne tente aucun téléchargement
        (clips / f"112{ayah:03d}.mp3").write_bytes(b"")
    base = {k: v for k, v in os.environ.items() if not k.startswith("AQR_")}
    base["PATH"] = path if path is not None else os.environ.get("PATH", "")
    base.update(AQR_AUDIO_DIR=str(audio), AQR_MODELS_DIR=str(tmp_path / "models"))
    assert BASH is not None
    return subprocess.run(
        [BASH, str(SCRIPT), *args],
        cwd=ROOT,
        env={**base, **env},
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


@pytest.mark.parametrize("args", [("clli",), ("CLI",), ("cli", "extra"), ("all", "browser")])
def test_an_unknown_step_is_a_usage_error_and_launches_nothing(
    tmp_path: Path, args: tuple[str, ...]
) -> None:
    done = _run(tmp_path, *args)
    assert done.returncode == 2, done.stdout + done.stderr
    assert "usage" in done.stderr.lower()
    assert "all|cli|browser" in done.stderr
    assert "Résumé" not in done.stdout  # rien n'a été lancé ni résumé affiché


def test_the_usage_check_comes_before_the_environment_check(tmp_path: Path) -> None:
    base = {k: v for k, v in os.environ.items() if not k.startswith("AQR_")}
    assert BASH is not None
    done = subprocess.run(
        [BASH, str(SCRIPT), "clli"],
        cwd=ROOT,
        env=base,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert done.returncode == 2
    assert "all|cli|browser" in done.stderr


def test_help_prints_the_usage_and_succeeds(tmp_path: Path) -> None:
    done = _run(tmp_path, "--help")
    assert done.returncode == 0
    assert "all|cli|browser" in done.stdout + done.stderr


@pytest.fixture()
def path_without_ffmpeg(tmp_path: Path) -> str:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for tool in ("dirname", "mktemp", "tr", "rm", "grep", "tee", "cat"):
        found = shutil.which(tool)
        if found:
            (bin_dir / tool).symlink_to(found)
    return str(bin_dir)


@pytest.mark.parametrize("flag", [{}, {"AQR_SMOKE_STRICT": ""}, {"AQR_SMOKE_STRICT": "1"}])
def test_missing_ffmpeg_fails_by_default(
    tmp_path: Path, path_without_ffmpeg: str, flag: dict[str, str]
) -> None:
    done = _run(tmp_path, "cli", path=path_without_ffmpeg, **flag)
    assert done.returncode == 2, done.stdout + done.stderr
    assert "ffmpeg absent" in done.stderr


def test_missing_ffmpeg_skips_loudly_only_with_an_explicit_zero(
    tmp_path: Path, path_without_ffmpeg: str
) -> None:
    done = _run(tmp_path, "cli", path=path_without_ffmpeg, AQR_SMOKE_STRICT="0")
    assert done.returncode == 0, done.stdout + done.stderr
    assert "NON EXÉCUTÉ" in done.stdout
