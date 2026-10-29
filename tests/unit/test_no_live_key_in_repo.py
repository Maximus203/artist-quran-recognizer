"""La clé de signature des jetons du direct ne vit jamais dans Git (section 12)."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# `AQR_LIVE_KEY=<clé de 16 caractères au moins>`, en variable ou en clé JSON ; valeurs vides exclues.
_ASSIGNED = re.compile(r"AQR_LIVE_KEY[\"']?\s*[:=]\s*[\"']?([A-Za-z0-9_\-+/=]{16,})")
_ALLOWED = {"x" * 16, "t" * 40, "t" * 16}


def _tracked() -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.splitlines()
    return [ROOT / name for name in out if (ROOT / name).is_file()]


def test_no_tracked_file_assigns_a_live_signing_key() -> None:
    offenders: list[str] = []
    for path in _tracked():
        if path.suffix in {".png", ".jpg", ".woff", ".woff2", ".ttf", ".zip", ".gz", ".lock"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for match in _ASSIGNED.finditer(text):
            value = match.group(1)
            if value in _ALLOWED or set(value) <= {"x", "t", "-", "_"}:
                continue  # valeur d'exemple ou de test (« tttt… »)
            offenders.append(f"{path.relative_to(ROOT)} : {value[:6]}…")
    assert offenders == [], f"clé de signature dans Git : {offenders}"


def test_the_local_key_file_is_ignored_by_git() -> None:
    ignored = subprocess.run(
        ["git", "check-ignore", "-q", "live-signing.key"], cwd=ROOT, check=False
    ).returncode
    assert ignored == 0, "live-signing.key doit figurer dans .gitignore"
