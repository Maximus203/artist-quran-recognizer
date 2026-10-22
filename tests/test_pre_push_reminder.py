"""Le hook pre-push rappelle (sans jamais bloquer) la note de version, et garde ses refus existants.

Chaque test pousse pour de vrai vers un dépôt nu temporaire : c'est Git qui exécute le hook.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

HOOKS = Path(__file__).resolve().parents[1] / ".githooks"
REMINDER = "pre-push (rappel, ne bloque pas)"

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git requis")


def _git(cwd: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.test", *args],
        cwd=cwd,
        check=check,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


@pytest.fixture
def work(tmp_path: Path) -> Path:
    remote = tmp_path / "remote.git"
    _git(tmp_path, "init", "--bare", "-b", "develop", str(remote))
    repo = tmp_path / "work"
    _git(tmp_path, "init", "-b", "develop", str(repo))
    _git(repo, "config", "core.hooksPath", HOOKS.as_posix())
    _git(repo, "remote", "add", "origin", str(remote))
    _commit(repo, {"README.md": "base\n"}, "chore: base")
    _git(repo, "push", "origin", "develop")
    _git(repo, "checkout", "-b", "feature")
    return repo


def _commit(repo: Path, files: dict[str, str], message: str, *, no_verify: bool = False) -> None:
    for name, content in files.items():
        path = repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    _git(repo, "add", "-A")
    # `no_verify` : simule un commit qui a échappé au hook commit-msg (le pre-push est le filet).
    _git(repo, "commit", *(["--no-verify"] if no_verify else []), "-m", message)


def _push(repo: Path) -> subprocess.CompletedProcess[str]:
    return _git(repo, "push", "origin", "feature", check=False)


def test_rappel_quand_src_ou_web_change_sans_note_de_version_et_le_push_passe(work: Path) -> None:
    _commit(work, {"src/aqr/x.py": "x = 1\n", "web/lib/x.ts": "export {}\n"}, "feat: un changement")
    result = _push(work)
    assert result.returncode == 0, result.stderr
    assert REMINDER in result.stderr


def test_pas_de_rappel_si_la_note_de_version_est_touchee(work: Path) -> None:
    _commit(work, {"src/aqr/x.py": "x = 1\n"}, "feat(x): un changement")
    _commit(work, {"docs/RELEASE-NOTES.md": "# Notes de version\n"}, "docs: note de version")
    result = _push(work)
    assert result.returncode == 0, result.stderr
    assert REMINDER not in result.stderr


def test_un_second_push_de_documentation_ne_rappelle_rien(work: Path) -> None:
    _commit(work, {"src/aqr/x.py": "x = 1\n"}, "feat(x): un changement")
    assert _push(work).returncode == 0
    _commit(work, {"docs/autre.md": "texte\n"}, "docs: une page")
    result = _push(work)
    assert result.returncode == 0, result.stderr
    assert REMINDER not in result.stderr


def test_le_rappel_ne_masque_pas_le_refus_d_une_signature_d_ia(work: Path) -> None:
    _commit(
        work,
        {"src/aqr/x.py": "x = 1\n"},
        "feat(x): un changement\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
        no_verify=True,
    )
    result = _push(work)
    assert result.returncode != 0
    assert "signature d'IA" in result.stderr
    assert REMINDER in result.stderr


def test_le_refus_d_un_fichier_audio_reste_actif(work: Path) -> None:
    _commit(work, {"docs/voix.mp3": "x"}, "docs: un audio")
    result = _push(work)
    assert result.returncode != 0
    assert "audio/vidéo/modèle" in result.stderr
