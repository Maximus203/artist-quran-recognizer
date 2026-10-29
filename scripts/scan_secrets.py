"""Cherche des secrets dans les fichiers suivis par Git, et (`--history`) dans tout l'historique.

Sans dépendance : des motifs de secrets connus (clés cloud, jetons GitHub / Hugging Face /
Telegram / Slack, clés privées) et les affectations `TOKEN|KEY|SECRET|PASSWORD|SALT = <valeur
longue>`. Ce n'est pas un remplaçant de gitleaks (à lancer aussi quand il est installé, cf.
docs/SECURITE-PRE-DEPLOIEMENT.md §14) : c'est un filet qui tourne partout, sans réseau.
Code retour : 0 propre, 1 secret probable trouvé. Jamais de valeur complète dans la sortie.

    python scripts/scan_secrets.py            # fichiers suivis
    python scripts/scan_secrets.py --history  # + tout l'historique (toutes les branches)
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from collections.abc import Iterable, Iterator
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

KNOWN = re.compile(
    r"AKIA[0-9A-Z]{16}"
    r"|gh[pousr]_[A-Za-z0-9]{30,}"
    r"|github_pat_[A-Za-z0-9_]{30,}"
    r"|hf_[A-Za-z0-9]{30,}"
    r"|sk-[A-Za-z0-9]{32,}"
    r"|xox[bp]-[A-Za-z0-9-]{20,}"
    r"|-----BEGIN [A-Z ]*PRIVATE KEY-----"
    r"|\b[0-9]{8,10}:AA[A-Za-z0-9_-]{33}\b"
)
ASSIGNED = re.compile(
    r"(?P<name>[A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|SALT))[\"']?\s*[:=]\s*[\"']?"
    r"(?P<value>[A-Za-z0-9+/_\-=]{24,})"
)
# Noms qui désignent un identifiant public ou un modèle, pas un secret.
PUBLIC_NAMES = ("MODEL_KEY", "MUNO_KEY", "PUBLIC_KEY", "CACHE_KEY", "ENV_KEY", "STORAGE_KEY")
SKIP_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".woff", ".woff2", ".ttf", ".zip", ".gz"}
SKIP_PARTS = ("test", "fixture", ".example", "package-lock.json", "uv.lock")


def _placeholder(value: str) -> bool:
    """Valeur d'exemple : un seul caractère répété, `x…`, `t…`, `a1a1…` ou un mot-clé évident."""
    lowered = value.lower()
    if len(set(lowered)) <= 3:
        return True
    return any(
        word in lowered for word in ("example", "exemple", "changeme", "placeholder", "your")
    )


def findings(text: str) -> Iterator[str]:
    """Débuts des valeurs suspectes trouvées dans `text`."""
    for match in KNOWN.finditer(text):
        yield match.group(0)[:8] + "…"
    for match in ASSIGNED.finditer(text):
        name, value = match.group("name"), match.group("value")
        if name.endswith(PUBLIC_NAMES) or _placeholder(value) or ("-" in value and value.islower()):
            continue  # identifiant lisible (« muno-fastconformer-… »), pas un secret
        yield f"{name}={value[:4]}…"


def _skip(name: str) -> bool:
    lowered = name.lower()
    return Path(name).suffix.lower() in SKIP_SUFFIXES or any(p in lowered for p in SKIP_PARTS)


def scan_tree(root: Path = ROOT) -> list[str]:
    names = subprocess.run(
        ["git", "ls-files"], cwd=root, capture_output=True, text=True, check=True
    ).stdout.splitlines()
    out: list[str] = []
    for name in names:
        path = root / name
        if _skip(name) or not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        out.extend(f"{name} : {hit}" for hit in findings(text))
    return out


def scan_history(root: Path = ROOT) -> list[str]:
    log = subprocess.run(
        ["git", "log", "--all", "-p", "--no-color", "--pretty=format:COMMIT %h"],
        cwd=root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=True,
    ).stdout
    out: list[str] = []
    commit, current = "?", ""
    for line in log.splitlines():
        if line.startswith("COMMIT "):
            commit = line[7:]
        elif line.startswith("+++ b/"):
            current = line[6:]
        elif line.startswith("+") and not line.startswith("+++") and not _skip(current):
            out.extend(f"{commit} {current} : {hit}" for hit in findings(line[1:]))
    return sorted(set(out))


def sensitive_files_in_history(root: Path = ROOT) -> list[str]:
    names = subprocess.run(
        ["git", "log", "--all", "--name-only", "--pretty=format:"],
        cwd=root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=True,
    ).stdout.splitlines()
    pattern = re.compile(
        r"(^|/)\.env($|\.)|\.pem$|\.key$|live-signing|\.sqlite|\.db$|id_rsa|credentials", re.I
    )
    return sorted({n for n in names if n and pattern.search(n) and not n.endswith(".example")})


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--history", action="store_true", help="scanner aussi tout l'historique")
    args = parser.parse_args(list(argv) if argv is not None else None)
    problems = scan_tree()
    if args.history:
        problems += scan_history()
        problems += [f"fichier sensible déjà commité : {n}" for n in sensitive_files_in_history()]
    for problem in problems:
        print(problem)
    print(f"{len(problems)} secret(s) probable(s)." if problems else "Aucun secret détecté.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
