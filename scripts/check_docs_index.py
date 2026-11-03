#!/usr/bin/env python3
"""Contrôle l'index de la documentation (`docs/docs-index.json`) et les notes de version.

L'index liste les documents affichés dans l'onglet « Documentation » de l'atelier. Ce contrôle
refuse : un fichier absent ou hors de `docs/`, un identifiant (`slug`) en double, une section
inconnue, une ADR oubliée, et tout document indexé qui contiendrait un identifiant de personne,
un secret ou un texte coranique long (le texte du Mushaf n'est jamais redistribué ici).
Il contrôle aussi le format strict de `docs/RELEASE-NOTES.md` (voir son en-tête).

Usage :
    python scripts/check_docs_index.py            # code 0 si tout est conforme, 1 sinon
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = "docs/docs-index.json"
RELEASE_NOTES = "docs/RELEASE-NOTES.md"

SECTIONS = ("Vue d'ensemble", "Architecture", "Décisions", "Évaluation", "Données", "Interface")
FIELDS = ("slug", "title", "section", "file", "summary")
SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

# Interdits dans un document indexé (affiché tel quel dans l'application).
MAX_ARABIC_WORDS = 8  # au-delà : un verset entier, donc du texte du Mushaf redistribué
_ARABIC_RUN = re.compile(r"(?:[؀-ۿ]+[ \t]+)*[؀-ۿ]+")
_FORBIDDEN = {
    "adresse e-mail": re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),
    "identifiant de locuteur": re.compile(r"\b(?:orateur|recitant|speaker)_\w+", re.IGNORECASE),
    "jeton ou clé": re.compile(
        r"\b(?:hf_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b"
        r"|-----BEGIN [A-Z ]*PRIVATE KEY-----"
    ),
}

# Format des notes de version.
TAGS = ("utilisateur", "technique", "décision")
_ENTRY = re.compile(r"^## (\d{4}-\d{2}-\d{2}) — (\S.*)$")
_TAGS_LINE = re.compile(r"^Étiquettes : (\S.*)$")
_PR_LINE = re.compile(r"^PR : (-|#\d+(?:, #\d+)*)$")
PLACEHOLDER = "<à compléter>"


def check_index(root: Path = ROOT) -> list[str]:
    """Erreurs de l'index (liste vide si tout est conforme)."""
    path = root / INDEX
    if not path.is_file():
        return [f"{INDEX} : fichier absent"]
    try:
        entries = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"{INDEX} : JSON invalide ({exc})"]
    if not isinstance(entries, list) or not entries:
        return [f"{INDEX} : doit être une liste non vide"]

    errors: list[str] = []
    slugs: set[str] = set()
    files: set[str] = set()
    for position, entry in enumerate(entries, start=1):
        where = f"{INDEX} entrée {position}"
        if not isinstance(entry, dict):
            errors.append(f"{where} : doit être un objet")
            continue
        missing = [f for f in FIELDS if not isinstance(entry.get(f), str) or not entry[f].strip()]
        if missing or set(entry) - set(FIELDS):
            errors.append(
                f"{where} : champs attendus {list(FIELDS)} (problème : {missing or 'extra'})"
            )
            continue
        slug, file = entry["slug"], entry["file"]
        where = f"{INDEX} « {slug} »"
        if not SLUG.match(slug):
            errors.append(f"{where} : slug invalide (minuscules, chiffres et tirets)")
        if slug in slugs:
            errors.append(f"{where} : slug en double")
        slugs.add(slug)
        if entry["section"] not in SECTIONS:
            errors.append(
                f"{where} : section inconnue « {entry['section']} » ({', '.join(SECTIONS)})"
            )
        if file in files:
            errors.append(f"{where} : fichier déjà indexé ({file})")
        files.add(file)
        errors.extend(_check_file(root, where, file))

    for adr in sorted((root / "docs" / "adr").glob("*.md")):
        relative = adr.relative_to(root).as_posix()
        if relative not in files:
            errors.append(f"{INDEX} : l'ADR {relative} n'est pas indexée")
    return errors


def _check_file(root: Path, where: str, file: str) -> list[str]:
    if not file.startswith("docs/") or not file.endswith(".md") or ".." in file.split("/"):
        return [f"{where} : « {file} » doit être un fichier .md sous docs/"]
    path = root / file
    if not path.is_file():
        return [f"{where} : fichier introuvable ({file})"]
    text = path.read_text(encoding="utf-8")
    errors = [
        f"{where} : {label} dans {file} (« {match.group(0)[:40]} »)"
        for label, pattern in _FORBIDDEN.items()
        if (match := pattern.search(text))
    ]
    longest = max((len(run.group(0).split()) for run in _ARABIC_RUN.finditer(text)), default=0)
    if longest > MAX_ARABIC_WORDS:
        errors.append(
            f"{where} : {file} cite {longest} mots arabes de suite (plus de {MAX_ARABIC_WORDS} : "
            "texte du Mushaf, à ne pas redistribuer)"
        )
    return errors


def check_release_notes(root: Path = ROOT) -> list[str]:
    """Erreurs de format de `docs/RELEASE-NOTES.md` (liste vide si conforme)."""
    path = root / RELEASE_NOTES
    if not path.is_file():
        return [f"{RELEASE_NOTES} : fichier absent"]
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0] != "# Notes de version":
        return [f"{RELEASE_NOTES} : la première ligne doit être « # Notes de version »"]

    errors: list[str] = []
    previous = ""
    entries = 0
    for number, line in enumerate(lines, start=1):
        if PLACEHOLDER in line:
            errors.append(f"{RELEASE_NOTES}:{number} : squelette non rempli ({PLACEHOLDER})")
        if not line.startswith("## "):
            continue
        entries += 1
        match = _ENTRY.match(line)
        if not match:
            errors.append(
                f"{RELEASE_NOTES}:{number} : titre attendu « ## AAAA-MM-JJ — Titre court »"
            )
            continue
        date = match.group(1)
        if previous and date > previous:
            errors.append(
                f"{RELEASE_NOTES}:{number} : {date} est postérieure à l'entrée précédente"
            )
        previous = date
        errors.extend(_check_entry_header(lines, number))
    if not entries:
        errors.append(f"{RELEASE_NOTES} : aucune entrée")
    return errors


def _check_entry_header(lines: list[str], number: int) -> list[str]:
    """`number` : numéro (base 1) du titre. Les deux lignes suivantes : étiquettes puis PR."""
    errors: list[str] = []
    tags = lines[number] if number < len(lines) else ""
    pr = lines[number + 1] if number + 1 < len(lines) else ""
    where = f"{RELEASE_NOTES}:{number}"
    tags_match = _TAGS_LINE.match(tags)
    if not tags_match:
        errors.append(f"{where} : la ligne suivant le titre doit être « Étiquettes : … »")
    else:
        given = [t.strip() for t in tags_match.group(1).split(",")]
        unknown = [t for t in given if t not in TAGS]
        if unknown or len(set(given)) != len(given):
            errors.append(f"{where} : étiquettes valides {', '.join(TAGS)} (reçu : {given})")
    if not _PR_LINE.match(pr):
        errors.append(f"{where} : la 2e ligne après le titre doit être « PR : #NN » ou « PR : - »")
    return errors


def main() -> int:
    errors = check_index() + check_release_notes()
    for error in errors:
        print(f"ERREUR {error}", file=sys.stderr)
    if errors:
        print(f"{len(errors)} problème(s) dans la documentation.", file=sys.stderr)
        return 1
    entries = json.loads((ROOT / INDEX).read_text(encoding="utf-8"))
    print(f"documentation conforme : {len(entries)} documents indexés, notes de version valides.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
