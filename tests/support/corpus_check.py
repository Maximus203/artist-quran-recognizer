"""Contrôle partagé : ce qu'un résultat `aqr.recognition/1` affiche vient bien du Mushaf (I1).

Même sémantique que `HomeRenderer.span_text` : verset non partiel => texte égal à
`repo.text(ref)` ; verset partiel => sous-chaîne exacte du verset, celle des mots
`first..last` (marques de pause comprises). La plage doit tenir dans le verset et le drapeau
`partial` s'accorder avec elle. Un verset `UNCERTAIN` ne porte ni texte ni traduction (I1, I3).
Les assertions de succès exigent des versets RECOGNIZED (I5) : un INFERRED est contrôlé mais ne
compte pas comme preuve.

Deux usages, une seule règle :
- tests/e2e/test_cli_smoke.py : document écrit par `aqr recognize` ;
- web/e2e/browser-smoke.mjs : document renvoyé par `GET /api/sessions/<id>`, via la ligne de
  commande (depuis la racine du dépôt, `PYTHONPATH=src`) :
      python -m tests.support.corpus_check --surah 112 --corpus-dir data/corpus résultat.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aqr.corpus.checksums import CorpusChecksumError
from aqr.corpus.normalize import normalize_arabic
from aqr.domain.models import VerseRef
from aqr.domain.ports import CorpusRepository
from aqr.pipeline.output import SCHEMA

# Tanzil place la basmala (4 mots) au début du verset 1 des sourates qui en portent une.
BASMALA_WORDS = 4
DEFAULT_CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"
_STATUSES = {"recognized", "inferred", "uncertain"}


class CorpusMismatch(AssertionError):
    """Le résultat ne correspond pas au corpus (ou viole un invariant de restitution)."""


@dataclass(frozen=True)
class CorpusReport:
    checked: int  # versets nommés (RECOGNIZED ou INFERRED) contrôlés
    recognized: tuple[VerseRef, ...]  # ceux de statut RECOGNIZED, dans l'ordre du résultat
    partial: int  # versets nommés dont seule une plage de mots est restituée


def expected_span_text(repo: CorpusRepository, ref: VerseRef, first: int, last: int) -> str:
    """Texte attendu pour les mots `first..last` : calque de `HomeRenderer.span_text`."""
    full = repo.text(ref)
    if first == 1 and last >= len(repo.words(ref)):
        return full
    kept: list[str] = []
    words_seen = 0
    for token in full.split():
        if normalize_arabic(token):
            words_seen += 1
        if first <= words_seen <= last:
            kept.append(token)
    return " ".join(kept)


def assert_matches_corpus(
    doc: dict[str, Any],
    repo: CorpusRepository,
    *,
    surah: int | None = None,
    min_recognized: int = 1,
    complete: bool = False,
) -> CorpusReport:
    """Lève `CorpusMismatch` au premier écart ; `surah` limite les versets nommés (I3) ;
    `min_recognized` = nombre minimal de versets RECOGNIZED (0 : ne pas exiger de succès) ;
    `complete` : l'audio récite des versets entiers, donc chaque verset nommé va jusqu'à son
    dernier mot et commence au mot 1 (le verset 1 peut ne pas porter la basmala de Tanzil)."""
    if doc.get("schema") != SCHEMA:
        raise CorpusMismatch(f"schéma inattendu : {doc.get('schema')!r} (attendu {SCHEMA})")
    intervals = doc.get("intervals")
    if not isinstance(intervals, list):
        raise CorpusMismatch("« intervals » absent ou invalide")
    known = set(repo.all_refs())
    recognized: list[VerseRef] = []
    checked = partial_count = 0
    for index, item in enumerate(intervals):
        if not isinstance(item, dict) or item.get("kind") != "verse":
            continue
        where = f"intervalle #{index}"
        status = item.get("status")
        if status not in _STATUSES:
            raise CorpusMismatch(f"{where} : statut inconnu {status!r}")
        if status == "uncertain":
            if item.get("text") or item.get("translation"):
                raise CorpusMismatch(
                    f"{where} : un verset UNCERTAIN ne porte ni texte ni traduction"
                )
            continue
        ref = _named_ref(item.get("ref"), where, known, surah)
        total = len(repo.words(ref))
        first, last = _word_range(item.get("words"), ref, total, where)
        if complete:
            _check_complete(ref, first, last, total)
        is_partial = not (first == 1 and last == total)
        if item.get("partial") is not is_partial:
            raise CorpusMismatch(
                f"{ref} : partial={item.get('partial')!r} incohérent avec la plage de mots "
                f"{first}..{last} sur {total}"
            )
        _check_text(item.get("text"), repo, ref, first, last, is_partial)
        checked += 1
        partial_count += is_partial
        if status == "recognized":
            recognized.append(ref)
    if len(recognized) < min_recognized:
        raise CorpusMismatch(
            f"{len(recognized)} verset(s) RECOGNIZED, {min_recognized} exigé(s) "
            f"({checked} nommé(s) au total ; un INFERRED ne prouve rien)"
        )
    return CorpusReport(checked=checked, recognized=tuple(recognized), partial=partial_count)


def _check_complete(ref: VerseRef, first: int, last: int, total: int) -> None:
    if last != total:
        raise CorpusMismatch(
            f"{ref} : le passage s'arrête au mot {last} sur {total} alors que le verset est "
            "récité en entier"
        )
    starts = (1, BASMALA_WORDS + 1) if ref.ayah == 1 else (1,)
    if first not in starts:
        raise CorpusMismatch(
            f"{ref} : le passage commence au mot {first}, attendu {' ou '.join(map(str, starts))}"
        )


def _named_ref(raw: object, where: str, known: set[VerseRef], surah: int | None) -> VerseRef:
    try:
        ref = VerseRef.parse(str(raw))
    except ValueError as exc:
        raise CorpusMismatch(f"{where} : référence invalide {raw!r} ({exc})") from exc
    if ref not in known:
        raise CorpusMismatch(f"{where} : {ref} absent du corpus")
    if surah is not None and ref.surah != surah:
        raise CorpusMismatch(f"{ref} hors de la sourate {surah} (I3 : jamais un faux verset)")
    return ref


def _word_range(raw: object, ref: VerseRef, total: int, where: str) -> tuple[int, int]:
    if not (
        isinstance(raw, list)
        and len(raw) == 2
        and all(isinstance(n, int) and not isinstance(n, bool) for n in raw)
    ):
        raise CorpusMismatch(f"{where} : « words » invalide pour {ref} : {raw!r}")
    first, last = raw
    if not 1 <= first <= last <= total:
        raise CorpusMismatch(f"{ref} : plage de mots {first}..{last} hors du verset (1..{total})")
    return first, last


def _check_text(
    text: object, repo: CorpusRepository, ref: VerseRef, first: int, last: int, is_partial: bool
) -> None:
    if not isinstance(text, str) or not text:
        raise CorpusMismatch(f"{ref} : texte absent (le texte vient du corpus, I1)")
    full = repo.text(ref)
    if not is_partial:
        if text != full:
            raise CorpusMismatch(f"{ref} : texte différent du corpus ({_first_gap(text, full)})")
        return
    if text not in full:
        raise CorpusMismatch(f"{ref} : le texte partiel n'est pas une sous-chaîne exacte du verset")
    if text != expected_span_text(repo, ref, first, last):
        raise CorpusMismatch(
            f"{ref} : le texte partiel ne correspond pas à la plage de mots {first}..{last}"
        )


def _first_gap(got: str, expected: str) -> str:
    for position, (a, b) in enumerate(zip(got, expected, strict=False)):
        if a != b:
            return f"1er écart au caractère {position} : {a!r} au lieu de {b!r}"
    return f"longueurs {len(got)} et {len(expected)}"


def load_repository(corpus_dir: Path) -> CorpusRepository:
    """Corpus Tanzil vérifié contre LOCK.json à chaque chargement (CorpusChecksumError sinon)."""
    from aqr.corpus.tanzil_repository import TanzilCorpusRepository

    return TanzilCorpusRepository(corpus_dir)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Contrôler un résultat aqr.recognition/1")
    parser.add_argument("result", help="fichier JSON du résultat (« - » : entrée standard)")
    parser.add_argument(
        "--corpus-dir",
        type=Path,
        default=Path(os.environ.get("AQR_CORPUS_DIR") or DEFAULT_CORPUS_DIR),
    )
    parser.add_argument("--surah", type=int, default=None, help="sourate attendue (I3)")
    parser.add_argument("--min-recognized", type=int, default=1)
    parser.add_argument(
        "--complete",
        action="store_true",
        help="l'audio récite des versets entiers (plage complète)",
    )
    args = parser.parse_args(argv)
    raw = sys.stdin.read() if args.result == "-" else Path(args.result).read_text(encoding="utf-8")
    try:
        report = assert_matches_corpus(
            json.loads(raw),
            load_repository(args.corpus_dir),
            surah=args.surah,
            min_recognized=args.min_recognized,
            complete=args.complete,
        )
    except (CorpusMismatch, CorpusChecksumError) as exc:
        print(f"ÉCHEC corpus : {exc}", file=sys.stderr)
        return 1
    refs = ", ".join(str(r) for r in report.recognized)
    print(
        f"OK corpus : {report.checked} verset(s) nommé(s), {len(report.recognized)} RECOGNIZED "
        f"({refs}), {report.partial} partiel(s)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
