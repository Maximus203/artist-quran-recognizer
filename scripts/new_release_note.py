#!/usr/bin/env python3
"""Insère en tête de `docs/RELEASE-NOTES.md` le squelette d'une nouvelle entrée datée.

Usage :
    python scripts/new_release_note.py "Titre court" --tags utilisateur,technique --pr 69
    python scripts/new_release_note.py "Titre court" --tags décision --pr 69,70 --date 2026-10-23

Le squelette contient des marques `<à compléter>` : `scripts/check_docs_index.py` refuse un fichier
qui en garde une. Les étiquettes valides et le format sont ceux de ce contrôle (source unique).
"""

from __future__ import annotations

import argparse
import datetime
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_docs_index import PLACEHOLDER, RELEASE_NOTES, ROOT, TAGS


def build_entry(title: str, tags: list[str], prs: list[int], date: datetime.date) -> str:
    """Texte de l'entrée (sans ligne vide finale)."""
    title = " ".join(title.split())
    if not title:
        raise ValueError("le titre ne peut pas être vide")
    unknown = [t for t in tags if t not in TAGS]
    if not tags or unknown or len(set(tags)) != len(tags):
        raise ValueError(f"étiquettes valides : {', '.join(TAGS)} (reçu : {tags})")
    pr = ", ".join(f"#{n}" for n in prs) if prs else "-"
    return (
        f"## {date.isoformat()} — {title}\n"
        f"Étiquettes : {', '.join(tags)}\n"
        f"PR : {pr}\n\n"
        f"**Ce qui change.** {PLACEHOLDER}\n\n"
        f"**Pourquoi / décision.** {PLACEHOLDER} (renvoyer vers l'ADR ou le rapport concerné ; "
        "supprimer ce paragraphe s'il n'apporte rien)\n"
    )


def insert_entry(notes: str, entry: str) -> str:
    """Place `entry` avant la première entrée existante (ou en fin de fichier s'il n'y en a pas)."""
    if not notes.startswith("# Notes de version"):
        raise ValueError("RELEASE-NOTES.md doit commencer par « # Notes de version »")
    match = re.search(r"^## ", notes, flags=re.MULTILINE)
    if match is None:
        return notes.rstrip("\n") + "\n\n" + entry
    return notes[: match.start()] + entry + "\n" + notes[match.start() :]


def parse_prs(raw: str) -> list[int]:
    values = [part.strip().lstrip("#") for part in raw.split(",") if part.strip()]
    if raw.strip() in ("", "-"):
        return []
    if not all(v.isdigit() for v in values):
        raise ValueError(f"numéros de PR attendus (ex. 69 ou 69,70), reçu : {raw!r}")
    return [int(v) for v in values]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("title", help="titre court de l'entrée")
    parser.add_argument(
        "--tags",
        default="technique",
        help=f"étiquettes séparées par des virgules ({', '.join(TAGS)})",
    )
    parser.add_argument("--pr", default="-", help="numéro(s) de PR (69 ou 69,70) ; « - » si aucune")
    parser.add_argument("--date", default=None, help="AAAA-MM-JJ (défaut : aujourd'hui)")
    parser.add_argument("--file", type=Path, default=ROOT / RELEASE_NOTES, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        date = datetime.date.fromisoformat(args.date) if args.date else datetime.date.today()
        entry = build_entry(
            args.title, [t.strip() for t in args.tags.split(",")], parse_prs(args.pr), date
        )
        notes = args.file.read_text(encoding="utf-8")
        args.file.write_text(insert_entry(notes, entry), encoding="utf-8", newline="\n")
    except (ValueError, OSError) as exc:
        print(f"ERREUR {exc}", file=sys.stderr)
        return 2
    print(f"entrée ajoutée en tête de {args.file.name} : complète les marques {PLACEHOLDER}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
