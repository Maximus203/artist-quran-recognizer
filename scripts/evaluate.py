#!/usr/bin/env python3
"""Évalue des sorties `aqr.recognition/1` contre la vérité terrain humaine du manifeste.

    python scripts/evaluate.py --predictions sorties/ --split dev --min-reference-verses 50 \
        --out rapport-dev.json

`sorties/` contient un JSON par cas, nommé `<id>.json`. Seuls les cas `annote` avec
`annotation.by: human` et `reviewed_by` sont évalués ; les autres sont listés avec leur raison,
jamais comptés. Aucun cas annoté : « aucune métrique », code de sortie non nul, rien d'inventé.
Le jeu `test` est réservé : `--split test` exige `--final` (mesure finale, pas de réglage).
Définitions des métriques : docs/EVALUATION-METRICS.md.

Codes de sortie : 0 ok ; 1 rien d'évalué ou un cas refusé ; 2 usage / jeu test sans --final.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, TextIO

from aqr.data.manifest import Manifest, has_trusted_truth, provenance_problems
from aqr.eval.metrics import (
    CaseResult,
    EvaluationRefused,
    MatchPolicy,
    aggregate,
    evaluate_recognition,
)
from aqr.eval.recognition import RecognitionError, load_recognition

ROOT = Path(__file__).resolve().parents[1]
REPORT_SCHEMA = "aqr.evaluation/1"
NO_METRIC = "aucun cas annoté par un humain : aucune métrique"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--manifest", type=Path, default=ROOT / "tests/fixtures/audio/manifest.yaml"
    )
    parser.add_argument("--predictions", type=Path, required=True, help="dossier des <id>.json")
    parser.add_argument("--split", choices=("dev", "test"), default="dev")
    parser.add_argument(
        "--final", action="store_true", help="autorise le jeu test (mesure finale uniquement)"
    )
    parser.add_argument("--out", type=Path, help="rapport JSON (défaut : sortie standard)")
    parser.add_argument(
        "--min-overlap",
        type=float,
        default=0.5,
        help="recouvrement minimal de rattachement, convention non calibrée (défaut : 0.5)",
    )
    parser.add_argument(
        "--min-reference-verses",
        type=int,
        required=True,
        help="en dessous, le résultat est marqué non défendable (à choisir, pas de défaut)",
    )
    return parser


def _write_report(report: dict[str, Any], out: Path | None, stdout: TextIO) -> None:
    text = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if out is None:
        stdout.write(text)
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8", newline="\n")


def _summary(agg: dict[str, Any], skipped: int, stdout: TextIO) -> None:
    total = agg["overall"]
    stdout.write(
        f"{total['n_cases']} cas annoté(s) humainement, {total['n_reference_verses']} verset(s) "
        f"de référence, {total['n_recognized_predictions']} verset(s) reconnu(s) ; "
        f"{skipped} cas ignoré(s) (non évaluables)\n"
    )
    stdout.write(
        f"faux versets : {total['n_false_verses']} (taux {total['false_verse_rate']}) · "
        f"omissions : {total['n_omissions']} (taux {total['omission_rate']}) · "
        f"facteur temps réel : {total['realtime_factor']}\n"
    )
    if not total["defensible"]:
        stdout.write(
            f"ATTENTION résultat non défendable : moins de {agg['min_reference_verses']} versets "
            "de référence, ne rien conclure de ces taux\n"
        )


def main(
    argv: list[str] | None = None, *, out: TextIO | None = None, err: TextIO | None = None
) -> int:
    stdout, stderr = out or sys.stdout, err or sys.stderr
    args = _parser().parse_args(argv)
    if args.split == "test" and not args.final:
        print(
            "Refusé : le jeu test est réservé aux mesures finales ; relancer avec --final "
            "seulement pour une mesure finale (jamais pour régler quoi que ce soit).",
            file=stderr,
        )
        return 2
    try:
        policy = MatchPolicy(min_overlap=args.min_overlap)
    except ValueError as exc:
        print(f"Refusé : {exc}", file=stderr)
        return 2

    manifest = Manifest.load(args.manifest)
    in_split = [c for c in manifest.cases if c.split == args.split]
    skipped: list[dict[str, str]] = []
    results: list[CaseResult] = []
    engines: dict[str, Any] = {}
    missing: list[str] = []
    refused: list[dict[str, str]] = []
    for case in in_split:
        if not has_trusted_truth(case):
            skipped.append(
                {
                    "id": case.id,
                    "reason": "pas évaluable : " + " ; ".join(provenance_problems(case)),
                }
            )
            continue
        path = args.predictions / f"{case.id}.json"
        if not path.exists():
            missing.append(case.id)
            continue
        try:
            recognition = load_recognition(path)
            results.append(evaluate_recognition(case, recognition, policy=policy))
            engines[case.id] = dict(recognition.engine)
        except (RecognitionError, EvaluationRefused) as exc:
            refused.append({"id": case.id, "reason": str(exc)})

    agg = aggregate(results, min_reference_verses=args.min_reference_verses) if results else None
    report: dict[str, Any] = {
        "schema": REPORT_SCHEMA,
        "split": args.split,
        "final": bool(args.final),
        "policy": {"min_overlap": policy.min_overlap},
        "min_reference_verses": args.min_reference_verses,
        "engines": engines,
        "cases": [r.to_dict() for r in results],
        "skipped": skipped,
        "missing_predictions": missing,
        "refused": refused,
        "aggregate": agg,
    }
    if not results:
        report["message"] = (
            NO_METRIC
            if not any(has_trusted_truth(c) for c in in_split)
            else ("aucune prédiction exploitable pour les cas annotés : aucune métrique")
        )
    _write_report(report, args.out, stdout)
    for item in refused:
        print(f"Refusé : cas {item['id']} : {item['reason']}", file=stderr)
    if missing:
        print(f"Prédictions manquantes (cas non évalués) : {', '.join(missing)}", file=stderr)
    if agg is None:
        print(report["message"], file=stderr)
        return 1
    _summary(agg, len(skipped), stdout)
    return 1 if refused else 0


if __name__ == "__main__":
    raise SystemExit(main())
