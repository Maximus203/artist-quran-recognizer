"""Le smoke e2e ne peut pas « réussir » en silence : le mode strict est le DÉFAUT (variable absente
ou vide) et une ressource absente est un ÉCHEC avec sa raison. Seul `AQR_SMOKE_STRICT=0`, explicite,
autorise un skip net, signalé dans un résumé « NON EXÉCUTÉ ».

Pytest imbriqué (sous-processus) : c'est le code de sortie réel que voit la CI qui est testé."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def _run_smoke(tmp_path: Path, *targets: str, **env: str) -> subprocess.CompletedProcess[str]:
    base = {k: v for k, v in os.environ.items() if not k.startswith("AQR_")}
    base["PATH"] = os.environ.get("PATH", "")
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "-m",
            "slow",
            *(targets or ("tests/e2e",)),
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


@pytest.mark.parametrize(
    "flag", [{}, {"AQR_SMOKE_STRICT": ""}, {"AQR_SMOKE_STRICT": "1"}], ids=["unset", "empty", "1"]
)
def test_strict_is_the_default_and_fails_with_the_reason(
    tmp_path: Path, empty_audio_dir: str, flag: dict[str, str]
) -> None:
    done = _run_smoke(tmp_path, AQR_AUDIO_DIR=empty_audio_dir, **flag)
    out = done.stdout + done.stderr
    assert done.returncode != 0, out  # avant : code 0, « 1 skipped », le bug d'origine
    assert "clip EveryAyah absent" in out
    assert "AQR_SMOKE_STRICT=0" in out  # le seul moyen d'autoriser le skip, dit en clair
    assert "1 error" in out
    assert "skipped" not in out


def test_strict_without_audio_dir_variable_fails(tmp_path: Path) -> None:
    done = _run_smoke(tmp_path)
    out = done.stdout + done.stderr
    assert done.returncode != 0, out
    assert "AQR_AUDIO_DIR absent" in out


@pytest.mark.parametrize("value", ["0", "false", "no", "off"])
def test_only_an_explicit_zero_skips_with_a_clear_reason_and_a_loud_summary(
    tmp_path: Path, empty_audio_dir: str, value: str
) -> None:
    done = _run_smoke(tmp_path, AQR_AUDIO_DIR=empty_audio_dir, AQR_SMOKE_STRICT=value)
    out = done.stdout + done.stderr
    assert done.returncode == 0, out
    assert "SKIPPED" in out
    assert "clip EveryAyah absent" in out
    assert "NON EXÉCUTÉ" in out  # le résumé dit que rien n'a été vérifié
    assert "AQR_SMOKE_STRICT" in out  # et que le skip est un choix explicite


def test_the_summary_only_lists_skips_of_the_e2e_tests(tmp_path: Path) -> None:
    other = tmp_path / "test_ailleurs.py"
    other.write_text(
        "import pytest\n\n"
        "@pytest.mark.slow\n"
        "def test_ailleurs():\n"
        "    pytest.skip('skip hors e2e')\n",
        encoding="utf-8",
    )
    # le test e2e est écarté (-k) : seul un test étranger au smoke est sauté
    done = _run_smoke(
        tmp_path,
        "tests/e2e",
        str(other),
        "--rootdir",
        str(ROOT),
        "-k",
        "ailleurs",
        AQR_SMOKE_STRICT="0",
    )
    out = done.stdout + done.stderr
    assert done.returncode == 0, out
    assert "skip hors e2e" in out  # le résumé court de pytest le liste, c'est normal
    assert "NON EXÉCUTÉ" not in out  # mais ce n'est pas le smoke e2e qui a été sauté


def test_the_summary_names_the_e2e_skip_even_with_other_skips(
    tmp_path: Path, empty_audio_dir: str
) -> None:
    other = tmp_path / "test_ailleurs.py"
    other.write_text(
        "import pytest\n\n"
        "@pytest.mark.slow\n"
        "def test_ailleurs():\n"
        "    pytest.skip('skip hors e2e')\n",
        encoding="utf-8",
    )
    done = _run_smoke(
        tmp_path,
        "tests/e2e",
        str(other),
        "--rootdir",
        str(ROOT),
        AQR_SMOKE_STRICT="0",
        AQR_AUDIO_DIR=empty_audio_dir,
    )
    out = done.stdout + done.stderr
    banner = out.split("smoke e2e : NON EXÉCUTÉ")[1].split("short test summary")[0]
    assert "test_cli_smoke.py" in banner
    assert "skip hors e2e" not in banner
