#!/usr/bin/env python3
"""Triage des revues humaines : chaque signalement avec ce que le moteur avait fait à cet endroit.

    python scripts/summarize_reviews.py SESSIONS_DIR [--margin 3] [--only-confirmed] [--out FICHIER]

`SESSIONS_DIR` contient un dossier par session de l'atelier (`session.json`, `review.json` au schéma
`aqr.review/2`, `prediction.recognition.json`). Pour chaque signalement, groupé par puce principale,
le script imprime en texte :
- le temps (ou la plage), les puces, le verset attendu, le commentaire ;
- les intervalles de la prédiction qui recouvrent la plage (± marge) : statut, verset, mots,
  répétition, `promoted_by`, confiance ; une abstention, sa raison et son meilleur score ;
- les vérifications acoustiques (`acoustic_checks`) qui la recouvrent : ce que la chaîne a tenté,
  la preuve par trame et la décision.
C'est ce qui fait d'une revue un cas de test : le signalement dit ce qui est faux, la prédiction ce
que le moteur avait fait, les vérifications pourquoi.

Identité : le rapport écrit dans un fichier (`--out`) ne contient AUCUN testeur (il peut se
retrouver dans la documentation) ; sur la console, chaque testeur est un pseudonyme stable (« T3 »),
jamais son nom. Lecture seule : rien n'est écrit dans `SESSIONS_DIR`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections.abc import Iterator, Mapping, Sequence
from pathlib import Path
from typing import Any

NO_TAG = "(sans puce)"
DEFAULT_MARGIN_S = 3.0


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def pseudonym(tester: str) -> str:
    """« T0 » à « T99 » : stable pour un même nom, sans le révéler."""
    return "T" + str(int(hashlib.sha256(tester.encode("utf-8")).hexdigest(), 16) % 100)


def _window(annotation: Mapping[str, Any], margin_s: float) -> tuple[float, float]:
    start = float(annotation["start_s"])
    end = annotation.get("end_s")
    return start - margin_s, (start if end is None else float(end)) + margin_s


def _overlaps(t: Sequence[float] | None, window: tuple[float, float]) -> bool:
    return bool(t) and t[0] <= window[1] and t[1] >= window[0]  # type: ignore[index]


def neighbours(
    intervals: Sequence[Mapping[str, Any]], annotation: Mapping[str, Any], margin_s: float
) -> list[tuple[int, Mapping[str, Any]]]:
    """(indice, intervalle) de la prédiction qui recouvrent le signalement à la marge près."""
    window = _window(annotation, margin_s)
    return [(i, iv) for i, iv in enumerate(intervals) if _overlaps(iv.get("t"), window)]


def overlapping_checks(
    checks: Sequence[Mapping[str, Any]], annotation: Mapping[str, Any], margin_s: float
) -> list[Mapping[str, Any]]:
    window = _window(annotation, margin_s)
    return [c for c in checks if _overlaps(c.get("t"), window)]


def _span(t: Sequence[float] | None) -> str:
    return "t=?" if not t else f"t=[{t[0]:g}, {t[1]:g}]"


def _interval_line(index: int, iv: Mapping[str, Any]) -> str:
    kind = iv.get("kind")
    if kind == "verse":
        low, high = iv.get("words") or (0, 0)
        parts = [f"{iv.get('ref')} [{low}-{high}] {iv.get('status')}", _span(iv.get("t"))]
        if iv.get("status") == "uncertain":
            parts.append("candidats " + ", ".join(iv.get("candidates") or []))
        if iv.get("repetition"):
            parts.append("repetition")
        if iv.get("promoted_by"):
            parts.append(f"promoted_by={iv['promoted_by']}")
        if iv.get("confidence") is not None:
            parts.append(f"conf {iv['confidence']}")
        return f"    #{index} " + "  ".join(parts)
    if kind == "abstention":
        return (
            f"    #{index} abstention {iv.get('reason')}  {_span(iv.get('t'))}"
            f"  meilleur score {iv.get('best_score')}"
        )
    return f"    #{index} {kind} {iv.get('label', '')}  {_span(iv.get('t'))}".rstrip()


def _check_line(check: Mapping[str, Any]) -> str:
    kind = check.get("kind")
    name = f"{kind}/{check['role']}" if check.get("role") else str(kind)
    parts = [
        name,
        _span(check.get("t")),
        str(check.get("verses")),
        f"llr {check.get('llr_per_frame')}",
    ]
    if check.get("passage_llr_per_frame") is not None:
        parts.append(f"passage {check['passage_llr_per_frame']}")
    if check.get("text_similarity") is not None:
        parts.append(f"sim {check['text_similarity']}")
    if check.get("words"):
        parts.append(f"mots {check['words']}")
        parts.append(f"faibles {check.get('weak_words', 0)}")
    if check.get("gain_nats") is not None:
        parts.append(f"gain {check['gain_nats']} nats")
    parts.append("accepté" if check.get("accepted") else "refusé")
    return "    " + "  ".join(parts)


def render_annotation(
    session: str,
    annotation: Mapping[str, Any],
    prediction: Mapping[str, Any] | None,
    margin_s: float,
    tester: str | None,
) -> str:
    """Un signalement et son contexte, en texte. `tester` : pseudonyme à montrer, ou None."""
    end = annotation.get("end_s")
    when = f"{annotation['start_s']:g} s" if end is None else f"{annotation['start_s']:g}-{end:g} s"
    tags = ", ".join(annotation.get("tags") or []) or NO_TAG
    head = f"[{session}] {when}  puces: {tags}  attendu: {annotation.get('expected_ref') or '-'}"
    head += f"  ({annotation.get('status')})"
    if tester is not None:
        head += f"  testeur {tester}"
    lines = [head]
    description = (annotation.get("description") or "").strip()
    if description:
        lines.append(f"  commentaire : {description}")
    if prediction is None:
        lines.append("  (aucune prédiction dans cette session)")
        return "\n".join(lines)
    near = neighbours(prediction.get("intervals") or [], annotation, margin_s)
    lines.append("  intervalles :" if near else "  intervalles : aucun")
    lines.extend(_interval_line(i, iv) for i, iv in near)
    checks = overlapping_checks(prediction.get("acoustic_checks") or [], annotation, margin_s)
    if checks:
        lines.append("  vérifications acoustiques :")
        lines.extend(_check_line(c) for c in checks)
    return "\n".join(lines)


def _sessions(root: Path) -> Iterator[tuple[str, dict[str, Any], dict[str, Any] | None]]:
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        review = folder / "review.json"
        if not review.exists():
            continue
        name = folder.name
        meta = folder / "session.json"
        if meta.exists():
            name = str(_read(meta).get("name") or name)
        prediction = folder / "prediction.recognition.json"
        yield name, _read(review), (_read(prediction) if prediction.exists() else None)


def report(
    root: Path,
    margin_s: float = DEFAULT_MARGIN_S,
    *,
    console: bool,
    only_confirmed: bool = False,
) -> str:
    """Le rapport texte. `console` : pseudonymes des testeurs ; sinon aucune identité."""
    groups: dict[str, list[str]] = {}
    for name, review, prediction in _sessions(root):
        for annotation in review.get("annotations") or []:
            if only_confirmed and annotation.get("status") != "confirmed":
                continue
            tags = annotation.get("tags") or []
            who = pseudonym(str(annotation.get("tester", ""))) if console else None
            groups.setdefault(tags[0] if tags else NO_TAG, []).append(
                render_annotation(name, annotation, prediction, margin_s, who)
            )
    if not groups:
        return "aucun signalement\n"
    blocks = [
        f"== {tag} ({len(items)})\n" + "\n\n".join(items) for tag, items in sorted(groups.items())
    ]
    return "\n\n".join(blocks) + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("sessions_dir", type=Path)
    parser.add_argument("--margin", type=float, default=DEFAULT_MARGIN_S, help="marge en secondes")
    parser.add_argument("--only-confirmed", action="store_true", help="ignorer les brouillons")
    parser.add_argument("--out", type=Path, help="écrire le rapport (sans identité de testeur)")
    args = parser.parse_args(argv)
    if not args.sessions_dir.is_dir():
        parser.error(f"dossier introuvable : {args.sessions_dir}")
    text = report(
        args.sessions_dir,
        args.margin,
        console=args.out is None,
        only_confirmed=args.only_confirmed,
    )
    if args.out is None:
        sys.stdout.write(text)
    else:
        args.out.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
