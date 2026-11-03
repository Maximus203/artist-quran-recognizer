"""Le hook commit-msg retire toute signature d'IA et garde le reste du message."""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

HOOK = Path(__file__).resolve().parents[1] / ".githooks" / "commit-msg"

# Sous Windows, `bash` est souvent le bash de WSL, qui ne comprend pas les chemins Windows :
# le hook est exercé sous Linux/macOS (cloud, CI) ; Git for Windows l'exécute via son propre sh.
pytestmark = pytest.mark.skipif(
    shutil.which("bash") is None or sys.platform == "win32",
    reason="bash POSIX requis (non-Windows)",
)


def _run(tmp_path: Path, message: str) -> str:
    f = tmp_path / "MSG"
    f.write_text(message, encoding="utf-8")
    subprocess.run(["bash", HOOK.as_posix(), f.as_posix()], check=True)
    return f.read_text(encoding="utf-8")


def test_strips_all_ai_signatures(tmp_path: Path) -> None:
    out = _run(
        tmp_path,
        "feat(x): sujet\n\nCorps utile.\n\n"
        "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\n"
        "Claude-Session: https://claude.ai/code/session_01Lz\n"
        "🤖 Generated with [Claude Code](https://claude.com/claude-code)\n",
    )
    assert out == "feat(x): sujet\n\nCorps utile.\n"


def test_keeps_human_coauthors_and_normal_text(tmp_path: Path) -> None:
    msg = (
        "fix(y): sujet\n\nMentionne Claude dans le corps ? non : texte libre.\n\n"
        "Co-Authored-By: Awa <awa@example.org>\n"
    )
    out = _run(tmp_path, msg)
    assert "Co-Authored-By: Awa" in out
    assert "texte libre" in out
