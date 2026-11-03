#!/usr/bin/env python3
"""Sonde : ce que l'ASR a réellement transcrit sous les abstentions d'une sortie `aqr recognize`.

    python scripts/probe_abstentions.py AUDIO RECOGNITION_JSON --out PROBE_JSON [--sample 12]

`aqr.recognition/1` ne garde pas la transcription des fenêtres en abstention (I1 : seul le
corpus est restitué). Pour comprendre une abstention, on retranscrit la même plage avec le même
ASR, puis on la repasse au matcher : transcription brute, texte normalisé, 3 meilleurs candidats.

Sondées : toutes les abstentions qui suivent un verset partiel de près (scénario « respiration au
milieu d'un verset » : la suite du verset est-elle dans l'abstention ?), plus un échantillon
déterministe des autres abstentions, réparti par raison. Diagnostic hors chaîne : rien n'est
restitué à l'utilisateur, la sortie (texte de l'ASR compris) reste hors dépôt (`--out`).
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AFTER_PARTIAL_MAX_GAP_S = 5.0
"""Écart maximal entre la fin d'un verset partiel et l'abstention suivante pour la sonder comme
« suite possible » ; même ordre que `merge_max_gap_s` du décodeur (diagnostic, pas un réglage)."""


@dataclass(frozen=True)
class Probe:
    start_s: float
    end_s: float
    reason: str
    best_score: float | None
    after_partial: tuple[str, int, int] | None = None
    """(verset, premier mot, dernier mot) du verset partiel qui précède, sinon None."""
    selected: str = "random"
    """Motif de sélection : `after_partial`, `top_score` ou `random` (seul l'échantillon
    `random` se lit comme représentatif des abstentions)."""


def pick_probes(
    intervals: Sequence[Mapping[str, object]], sample: int, seed: int = 7, top_scores: int = 0
) -> list[Probe]:
    """Abstentions qui suivent un verset partiel (toutes) + les `top_scores` autres les mieux
    notées (« presque reconnues ») + `sample` autres tirées au hasard, réparties par raison."""
    after: list[Probe] = []
    others: dict[str, list[Probe]] = {}
    previous: Mapping[str, object] | None = None
    for item in intervals:
        if item.get("kind") == "abstention":
            t = item["t"]
            assert isinstance(t, list)
            reason = str(item.get("reason"))
            score = item.get("best_score")
            best = float(score) if isinstance(score, int | float) else None
            if (
                previous is not None
                and previous.get("partial")
                and float(t[0]) - float(previous["t"][1]) <= AFTER_PARTIAL_MAX_GAP_S  # type: ignore[index]
            ):
                words = previous["words"]
                assert isinstance(words, list)
                ref = (str(previous["ref"]), int(words[0]), int(words[1]))
                after.append(Probe(float(t[0]), float(t[1]), reason, best, ref, "after_partial"))
            elif reason != "silence":
                others.setdefault(reason, []).append(Probe(float(t[0]), float(t[1]), reason, best))
        if item.get("kind") in ("verse", "abstention"):
            previous = item if item.get("kind") == "verse" else None
    pool_all = [p for pool in others.values() for p in pool]
    best_first = sorted(
        (p for p in pool_all if p.best_score is not None),
        key=lambda p: (p.best_score, -p.start_s),
        reverse=True,
    )[:top_scores]
    for p in best_first:
        others[p.reason].remove(p)
    chosen = [replace(p, selected="top_score") for p in best_first]
    others = {reason: pool for reason, pool in others.items() if pool}
    rng = random.Random(seed)
    reasons = sorted(others)
    for i, reason in enumerate(reasons):
        quota = sample // len(reasons) + (1 if i < sample % len(reasons) else 0)
        pool = others[reason]
        chosen.extend(rng.sample(pool, min(quota, len(pool))))
    return sorted(after + chosen, key=lambda p: p.start_s)


def continues(partial: tuple[str, int, int], ref: str, first_word: int) -> bool:
    """Le candidat reprend-il le verset partiel là où il s'est arrêté (ou au verset suivant) ?"""
    verse, _, last = partial
    if ref == verse:
        return first_word > last - 2  # tolérance : un mot de recouvrement à la reprise
    sura, aya = verse.split(":")
    return ref == f"{sura}:{int(aya) + 1}" and first_word <= 2


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", type=Path)
    parser.add_argument("recognition", type=Path)
    parser.add_argument("--out", type=Path, required=True, help="JSON de sonde (hors dépôt)")
    parser.add_argument("--sample", type=int, default=12, help="abstentions tirées au hasard")
    parser.add_argument("--top-scores", type=int, default=6, help="abstentions les mieux notées")
    parser.add_argument("--corpus", type=Path, default=ROOT / "data" / "corpus")
    parser.add_argument("--device", default="auto")
    args = parser.parse_args()
    models_dir = os.environ.get("AQR_MODELS_DIR")
    if not models_dir:
        sys.exit("Variable manquante : AQR_MODELS_DIR")

    from aqr.adapters.fastconformer import FastConformerConfig, FastConformerQuranASR
    from aqr.adapters.ffmpeg_extractor import FfmpegAudioExtractor
    from aqr.corpus.imlai_corrections import build_word_corrections, load_simple_clean_words
    from aqr.corpus.normalize import normalize_arabic
    from aqr.corpus.tanzil_repository import TanzilCorpusRepository
    from aqr.domain.models import TimeSpan
    from aqr.matching.flow_matcher import FlowVerseMatcher

    document = json.loads(args.recognition.read_text(encoding="utf-8"))
    probes = pick_probes(document["intervals"], args.sample, top_scores=args.top_scores)
    asr = FastConformerQuranASR(
        FastConformerConfig(
            models_dir=Path(models_dir), lock_path=ROOT / "models" / "LOCK.json", device=args.device
        )
    )
    corpus = TanzilCorpusRepository(args.corpus)
    corrections = build_word_corrections(corpus, load_simple_clean_words(args.corpus))
    matcher = FlowVerseMatcher(corpus, word_corrections=corrections)
    clip = FfmpegAudioExtractor().extract(args.audio)
    spans = [TimeSpan(p.start_s, p.end_s) for p in probes]
    transcripts = asr.transcribe_batch(clip, spans) if spans else []

    rows = []
    for probe, transcript in zip(probes, transcripts, strict=True):
        raw = " ".join(w.text for w in transcript.words)
        text = normalize_arabic(raw)
        candidates = matcher.match(text, top_k=3) if text else []
        top = [
            {
                "ref": str(c.span.ref),
                "words": [c.span.first_word, c.span.last_word],
                "refs": [str(r) for r in c.refs],
                "score": round(c.score, 4),
                "quality": None if c.quality is None else round(c.quality, 4),
                "coverage": round(c.coverage, 4),
            }
            for c in candidates
        ]
        row: dict[str, object] = {
            "t": [probe.start_s, probe.end_s],
            "reason": probe.reason,
            "selected": probe.selected,
            "best_score": probe.best_score,
            "raw": raw,
            "normalized": text,
            "n_words": len(text.split()),
            "mean_confidence": round(
                sum(w.confidence for w in transcript.words) / len(transcript.words), 3
            )
            if transcript.words
            else None,
            "top": top,
        }
        if probe.after_partial is not None:
            row["after_partial"] = list(probe.after_partial)
            row["continues_partial"] = bool(
                top and continues(probe.after_partial, top[0]["ref"], top[0]["words"][0])
            )
        rows.append(row)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps({"source": document["source"], "probes": rows}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    after = [r for r in rows if "after_partial" in r]
    print(
        f"{len(rows)} plages sondées · {len(after)} après un verset partiel, dont "
        f"{sum(1 for r in after if r['continues_partial'])} dont le meilleur candidat est la suite"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
