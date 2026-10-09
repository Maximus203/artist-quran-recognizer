#!/usr/bin/env python3
"""Évalue des sorties `aqr.recognition/1` contre la vérité terrain humaine du manifeste.

    python scripts/evaluate.py --predictions sorties/ --split dev --min-reference-verses 50 \
        [--transcripts transcriptions/] [--baseline rapport-precedent.json] --out rapport-dev.json

`sorties/` contient un JSON par cas, nommé `<id>.json`. Seuls les cas `annote` avec
`annotation.by: human` et `reviewed_by` sont évalués ; les autres sont listés avec leur raison,
jamais comptés. Aucun cas annoté : « aucune métrique », code de sortie non nul, rien d'inventé.
Le jeu `test` est réservé : `--split test` exige `--final` (mesure finale, pas de réglage).

Le rapport (`aqr.evaluation/2`) a deux blocs : `vitesse` (temps mur, facteur temps réel, pic de RAM,
machine) et `exactitude` (localisation temporelle, identification sourate/verset/plage, non
reconnus,
faux positifs sur silence et hors cible, WER/CER en deux variantes nommées), plus la provenance (SHA
git, empreintes des modèles, manifeste, split, seuils, version de normalisation) et des
avertissements.
`--transcripts DIR` (un `<id>.transcript.json` par cas, sortie brute de l'ASR) active le WER/CER ;
`--baseline rapport.json` compare à un rapport précédent et REFUSE si les manifestes diffèrent.
Définitions : docs/EVALUATION-METRICS.md.

Codes de sortie : 0 ok ; 1 rien d'évalué ou un cas refusé ; 2 usage / jeu test sans --final /
comparaison refusée.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any, TextIO

from aqr.corpus.checksums import CorpusChecksumError
from aqr.corpus.imlai_corrections import build_word_corrections, load_simple_clean_words
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.data.config import DataConfig
from aqr.data.manifest import AudioCase, Manifest, has_trusted_truth, provenance_problems
from aqr.eval.identification import (
    IdentificationResult,
    aggregate_identification,
    evaluate_identification,
)
from aqr.eval.metrics import (
    CaseResult,
    EvaluationRefused,
    MatchPolicy,
    aggregate,
    evaluate_recognition,
)
from aqr.eval.recognition import RecognitionError, load_recognition
from aqr.eval.report import (
    BaselineRefused,
    compare_reports,
    git_state,
    machine_id,
    manifest_identity,
    models_state,
    speed_block,
)
from aqr.eval.transcription import (
    NORMALIZATION_VERSION,
    STRICT_NORMALIZATION_VERSION,
    VARIANT_DESCRIPTIONS,
    VARIANTS,
    TranscriptError,
    TranscriptScore,
    WordSource,
    load_transcript,
    normalization_fingerprint,
    reference_words,
    score_transcript,
    sum_scores,
)

ROOT = Path(__file__).resolve().parents[1]
REPORT_SCHEMA = "aqr.evaluation/2"
NO_METRIC = "aucun cas annoté par un humain : aucune métrique"
WARNING_TAJWID = "identification de verset != validation du tajwid"
WARNING_EVERYAYAH = "plafond optimiste si audio EveryAyah"
DATA = DataConfig()


def _evaluable_split(value: str) -> str:
    if value == DATA.quarantine_split:
        raise argparse.ArgumentTypeError(
            "la quarantaine n'est jamais évaluée ni utilisée au réglage "
            "(docs/evaluation/protocole-reglage-evaluation.md)"
        )
    return value


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--manifest", type=Path, default=ROOT / "tests/fixtures/audio/manifest.yaml"
    )
    parser.add_argument("--predictions", type=Path, required=True, help="dossier des <id>.json")
    parser.add_argument("--split", type=_evaluable_split, choices=DATA.splits, default="dev")
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
    parser.add_argument(
        "--transcripts",
        type=Path,
        help="dossier des <id>.transcript.json (sortie brute de l'ASR) : active le WER/CER",
    )
    parser.add_argument(
        "--corpus-dir",
        type=Path,
        default=ROOT / "data" / "corpus",
        help="corpus Tanzil (texte de référence du WER/CER ; lire --transcripts)",
    )
    parser.add_argument(
        "--models-lock",
        type=Path,
        default=ROOT / "models" / "LOCK.json",
        help="empreintes des modèles écrites dans le rapport",
    )
    parser.add_argument(
        "--baseline",
        type=Path,
        help="rapport précédent à comparer ; refusé si le manifeste, le split ou la normalisation "
        "diffèrent",
    )
    return parser


def _write_report(report: dict[str, Any], out: Path | None, stdout: TextIO) -> None:
    text = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if out is None:
        stdout.write(text)
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8", newline="\n")


def _is_studio_case(case: AudioCase) -> bool:
    """Heuristique : audio EveryAyah (studio) ou mixage construit depuis ses clips."""
    marks = (case.source or "", case.file, case.recitant)
    return case.origine == "mix" or any("everyayah" in m.lower() for m in marks)


def _decoder_thresholds(decoders: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    distinct = {json.dumps(d, sort_keys=True) for d in decoders.values()}
    if len(distinct) <= 1:
        return dict(next(iter(decoders.values()), {}))
    return {"heterogeneous": True, "by_case": {k: dict(v) for k, v in decoders.items()}}


def _load_reference(
    args: argparse.Namespace,
    corpus: WordSource | None,
    corrections: Mapping[str, str] | None,
) -> tuple[WordSource, Mapping[str, str]]:
    if corpus is None:
        repository = TanzilCorpusRepository(args.corpus_dir)
        corpus = repository
        if corrections is None:
            corrections = build_word_corrections(
                repository, load_simple_clean_words(args.corpus_dir)
            )
    return corpus, corrections if corrections is not None else {}


def _score_transcripts(
    cases: list[AudioCase],
    directory: Path,
    corpus: WordSource,
    corrections: Mapping[str, str],
) -> tuple[dict[str, Any], dict[str, float]]:
    per_variant: dict[str, list[TranscriptScore]] = {v: [] for v in VARIANTS}
    per_case: list[dict[str, Any]] = []
    missing: list[str] = []
    refused: list[dict[str, str]] = []
    peaks: dict[str, float] = {}
    for case in cases:
        if not case.expected:
            continue  # silence / hors cible : aucun texte de référence
        path = directory / f"{case.id}.transcript.json"
        if not path.exists():
            missing.append(case.id)
            continue
        try:
            transcript = load_transcript(path)
            if transcript.sha256 != case.sha256:
                raise TranscriptError(
                    f"sha256 de la transcription ({transcript.sha256[:12]}…) différent de celui "
                    f"du manifeste ({case.sha256[:12]}…) : sortie d'un autre fichier"
                )
            reference = reference_words(case.expected, corpus)
        except (TranscriptError, ValueError) as exc:
            refused.append({"id": case.id, "reason": str(exc)})
            continue
        scores = {v: score_transcript(reference, transcript.text, corrections, v) for v in VARIANTS}
        for variant, score in scores.items():
            per_variant[variant].append(score)
        if transcript.peak_rss_mb is not None:
            peaks[case.id] = transcript.peak_rss_mb
        per_case.append({"case_id": case.id, **{v: s.to_dict() for v, s in scores.items()}})
    n_scored = len(per_case)
    block: dict[str, Any] = {
        "measured": n_scored > 0,
        "n_cases": n_scored,
        "variants": {
            v: {**sum_scores(per_variant[v]).to_dict(), "description": VARIANT_DESCRIPTIONS[v]}
            for v in VARIANTS
        }
        if n_scored
        else {},
        "cases": per_case,
        "missing_transcripts": missing,
        "refused": refused,
    }
    if not n_scored:
        block["reason"] = "aucune transcription exploitable pour les cas à versets attendus"
    return block, peaks


def _summary(report: dict[str, Any], skipped: int, stdout: TextIO) -> None:
    agg = report["aggregate"]
    total = agg["overall"]
    speed, exact = report["vitesse"], report["exactitude"]
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
    machine = speed["machine"]
    stdout.write(
        f"VITESSE : temps mur {speed['wall_s']:.2f} s, facteur temps réel "
        f"{speed['realtime_factor']}, pic RAM {speed['peak_ram_mb']} Mo, machine "
        f"{machine['cpu_model']} ({machine['cores']} cœurs)\n"
    )
    ident = exact["identification"]
    stdout.write(
        f"EXACTITUDE : sourate {ident['surah']['hits']}/{ident['surah']['total']} · verset exact "
        f"{ident['verse_exact']['hits']}/{ident['verse_exact']['total']} · plage exacte "
        f"{ident['range_exact']['hits']}/{ident['range_exact']['total']} · non reconnus "
        f"{ident['unrecognized']['n_cases']} · faux positifs silence "
        f"{ident['silence']['n_false_positive_verses']} / hors cible "
        f"{ident['off_target']['n_false_positive_verses']}\n"
    )
    transcription = exact["transcription"]
    if transcription["measured"]:
        for name, variant in transcription["variants"].items():
            stdout.write(f"  [{name}] WER {variant['wer']} · CER {variant['cer']}\n")
    else:
        stdout.write(f"  WER/CER : {transcription['reason']}\n")
    for line in report["warnings"]:
        stdout.write(f"ATTENTION {line}\n")
    if not total["defensible"]:
        stdout.write(
            f"ATTENTION résultat non défendable : moins de {agg['min_reference_verses']} versets "
            "de référence, ne rien conclure de ces taux\n"
        )
    comparison = report.get("comparison")
    if comparison:
        stdout.write(f"COMPARAISON avec {comparison['baseline']} :\n")
        for path, item in comparison["metrics"].items():
            if item["delta"]:
                stdout.write(
                    f"  {path} : {item['baseline']} -> {item['current']} ({item['delta']:+g})\n"
                )
        for change in comparison["context_changes"]:
            stdout.write(f"  contexte modifié : {change}\n")


def main(
    argv: list[str] | None = None,
    *,
    out: TextIO | None = None,
    err: TextIO | None = None,
    corpus: WordSource | None = None,
    corrections: Mapping[str, str] | None = None,
) -> int:
    """`corpus` / `corrections` : injection pour les tests ; sinon chargés depuis --corpus-dir."""
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
    baseline: dict[str, Any] | None = None
    if args.baseline is not None:
        try:
            baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
            if not isinstance(baseline, dict):
                raise ValueError("objet JSON attendu")
        except (OSError, ValueError) as exc:
            print(f"Refusé : baseline illisible {args.baseline} : {exc}", file=stderr)
            return 2
    reference: tuple[WordSource, Mapping[str, str]] | None = None
    if args.transcripts is not None:
        try:
            reference = _load_reference(args, corpus, corrections)
        except (CorpusChecksumError, OSError) as exc:
            print(f"Refusé : corpus Tanzil inutilisable pour le WER/CER : {exc}", file=stderr)
            return 2
    word_corrections = reference[1] if reference else (corrections or {})

    manifest = Manifest.load(args.manifest)
    in_split = [c for c in manifest.cases if c.split == args.split]
    skipped: list[dict[str, str]] = []
    results: list[CaseResult] = []
    identifications: list[IdentificationResult] = []
    evaluated: list[AudioCase] = []
    engines: dict[str, Any] = {}
    decoders: dict[str, Mapping[str, Any]] = {}
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
            result = evaluate_recognition(case, recognition, policy=policy)
            identification = evaluate_identification(case, recognition.intervals)
        except (RecognitionError, EvaluationRefused) as exc:
            refused.append({"id": case.id, "reason": str(exc)})
            continue
        results.append(result)
        identifications.append(identification)
        evaluated.append(case)
        engines[case.id] = dict(recognition.engine)
        decoders[case.id] = dict(recognition.decoder)

    transcription: dict[str, Any] = {
        "measured": False,
        "n_cases": 0,
        "variants": {},
        "cases": [],
        "missing_transcripts": [],
        "refused": [],
        "reason": "non mesuré : --transcripts absent",
    }
    peaks: dict[str, float] = {}
    if args.transcripts is not None and reference is not None:
        transcription, peaks = _score_transcripts(
            evaluated, args.transcripts, reference[0], reference[1]
        )

    agg = aggregate(results, min_reference_verses=args.min_reference_verses) if results else None
    studio = [c.id for c in evaluated if _is_studio_case(c)]
    warnings = [WARNING_TAJWID, WARNING_EVERYAYAH]
    if studio:
        warnings.append(
            f"{len(studio)} cas sur {len(evaluated)} sont de l'audio EveryAyah / mixé (studio) : "
            "plafond optimiste, ne pas lire ces taux comme une performance sur audio réel"
        )
    report: dict[str, Any] = {
        "schema": REPORT_SCHEMA,
        "split": args.split,
        "final": bool(args.final),
        "policy": {"min_overlap": policy.min_overlap},
        "min_reference_verses": args.min_reference_verses,
        "git": git_state(ROOT),
        "models": models_state(args.models_lock),
        "manifest": manifest_identity(
            args.manifest, [(c.id, c.sha256, c.split) for c in evaluated]
        ),
        "thresholds": {
            "match": {"min_overlap": policy.min_overlap},
            "decoder": _decoder_thresholds(decoders),
            "min_reference_verses": args.min_reference_verses,
        },
        "normalization": {
            "version": NORMALIZATION_VERSION,
            "strict_version": STRICT_NORMALIZATION_VERSION,
            "fingerprint": normalization_fingerprint(word_corrections),
            "corrections": len(word_corrections),
        },
        "warnings": warnings,
        "engines": engines,
        "vitesse": speed_block(results, peaks=peaks, machine=machine_id()),
        "exactitude": {
            "localisation": agg,
            "identification": aggregate_identification(identifications),
            "transcription": transcription,
        },
        "identification_cases": [i.to_dict() for i in identifications],
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
    elif baseline is not None:
        try:
            comparison = compare_reports(report, baseline)
        except BaselineRefused as exc:
            print(f"Refusé : baseline {args.baseline} : {exc}", file=stderr)
            return 2
        report["comparison"] = {"baseline": str(args.baseline), **comparison}
    _write_report(report, args.out, stdout)
    for item in refused:
        print(f"Refusé : cas {item['id']} : {item['reason']}", file=stderr)
    for item in transcription["refused"]:
        print(f"Refusé : transcription {item['id']} : {item['reason']}", file=stderr)
    if missing:
        print(f"Prédictions manquantes (cas non évalués) : {', '.join(missing)}", file=stderr)
    if transcription["missing_transcripts"]:
        print(
            "Transcriptions manquantes (WER/CER non calculé) : "
            + ", ".join(transcription["missing_transcripts"]),
            file=stderr,
        )
    if agg is None:
        print(report["message"], file=stderr)
        return 1
    _summary(report, len(skipped), stdout)
    return 1 if refused or transcription["refused"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
