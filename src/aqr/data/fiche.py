"""Fiche d'accompagnement d'un enregistrement (docs/DATA-COLLECTION.md §3), schéma strict."""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import yaml

from aqr.data.config import DataConfig

_REQUIRED = ("fichier", "categorie", "recitant", "riwaya", "langues", "droits")
_OPTIONAL = ("lieu", "contenu_approx", "source", "id")
_RECITANT = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*")
_LANGUE = re.compile(r"[a-z]{2,3}")


class FicheError(ValueError):
    """Fiche invalide : `problems` liste tous les défauts, pour les corriger d'un coup."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


@dataclass(frozen=True)
class Fiche:
    fichier: str
    categorie: tuple[str, ...]
    recitant: str
    riwaya: str
    langues: tuple[str, ...]
    droits: str
    lieu: str | None = None
    contenu_approx: str | None = None
    source: str | None = None
    id: str | None = None


def _text(data: Mapping[str, object], key: str, problems: list[str]) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        problems.append(f"{key} : texte non vide requis")
        return ""
    return value.strip()


def parse_fiche(data: object, config: DataConfig) -> Fiche:
    if not isinstance(data, Mapping):
        raise FicheError(["la fiche doit être un dictionnaire YAML (clé: valeur)"])
    problems: list[str] = []
    for key in data:
        if key not in _REQUIRED and key not in _OPTIONAL:
            problems.append(f"clé inconnue : {key!r}")
    for key in _REQUIRED:
        if key not in data:
            problems.append(f"{key} : champ obligatoire manquant")

    fichier = _text(data, "fichier", problems) if "fichier" in data else ""
    droits = _text(data, "droits", problems) if "droits" in data else ""

    categories: tuple[str, ...] = ()
    if "categorie" in data:
        raw = data["categorie"]
        values = [raw] if isinstance(raw, str) else list(raw) if isinstance(raw, list) else []
        bad = [v for v in values if v not in config.categories]
        if not values:
            problems.append("categorie : une catégorie (ou une liste) C01–C15 est requise")
        span = f"{config.categories[0]}–{config.categories[-1]}"
        for v in bad:
            problems.append(f"categorie : {v!r} inconnue (attendu {span})")
        categories = tuple(str(v) for v in values if v in config.categories)

    recitant = ""
    if "recitant" in data:
        recitant = _text(data, "recitant", problems)
        if recitant and not _RECITANT.fullmatch(recitant):
            problems.append(
                f"recitant : {recitant!r} n'est pas un identifiant anonyme "
                "(lettres, chiffres, _ et - ; jamais un nom)"
            )
        recitant = recitant.lower()  # imam_A et imam_a désignent le même groupe de découpage

    riwaya = ""
    if "riwaya" in data:
        riwaya = str(data["riwaya"])
        if riwaya not in config.riwayas:
            problems.append(f"riwaya : {riwaya!r} inconnue (attendu {' | '.join(config.riwayas)})")

    langues: tuple[str, ...] = ()
    if "langues" in data:
        raw_l = data["langues"]
        values_l = list(raw_l) if isinstance(raw_l, list) else []
        if not values_l or not all(isinstance(v, str) and _LANGUE.fullmatch(v) for v in values_l):
            problems.append("langues : liste non vide de codes (ar, fr, wo…) requise")
        else:
            langues = tuple(values_l)

    def optional(key: str) -> str | None:
        value = data.get(key)
        return value.strip() if isinstance(value, str) and value.strip() else None

    if problems:
        raise FicheError(problems)
    return Fiche(
        fichier=fichier,
        categorie=categories,
        recitant=recitant,
        riwaya=riwaya,
        langues=langues,
        droits=droits,
        lieu=optional("lieu"),
        contenu_approx=optional("contenu_approx"),
        source=optional("source"),
        id=optional("id"),
    )


def load_fiche(path: Path, config: DataConfig) -> Fiche:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise FicheError([f"YAML illisible : {exc}"]) from exc
    return parse_fiche(data, config)
