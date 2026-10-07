#!/usr/bin/env python3
"""Compare deux sorties `aqr.recognition/1` du MÊME audio (deux moteurs ASR) : accord seulement.

    python scripts/compare_engines.py a.recognition.json b.recognition.json [--out rapport.json]

Sans vérité terrain, deux moteurs qui s'accordent peuvent se tromper ensemble : ce script ne mesure
**aucune précision**. Il rapporte, sur les versets `recognized` : ceux que les deux nomment au même
endroit (recouvrement ≥ `--min-overlap` de l'intervalle le plus court), ceux que l'un seul nomme,
et les **désaccords** (même plage de temps, versets différents) — les cas à écouter en premier.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _verses(document: dict[str, object]) -> list[dict[str, object]]:
    intervals = document["intervals"]
    assert isinstance(intervals, list)
    return [i for i in intervals if i["kind"] == "verse" and i["status"] == "recognized" and i["t"]]


def _overlap(a: list[float], b: list[float]) -> float:
    inter = min(a[1], b[1]) - max(a[0], b[0])
    return max(0.0, inter) / max(1e-9, min(a[1] - a[0], b[1] - b[0]))


def compare(
    a_doc: dict[str, object], b_doc: dict[str, object], min_overlap: float
) -> dict[str, object]:
    a_verses, b_verses = _verses(a_doc), _verses(b_doc)
    agree: list[str] = []
    disagree: list[dict[str, object]] = []
    matched_b: set[int] = set()
    only_a: list[str] = []
    for va in a_verses:
        hits = [
            (k, vb)
            for k, vb in enumerate(b_verses)
            if _overlap(va["t"], vb["t"]) >= min_overlap  # type: ignore[arg-type]
        ]
        if not hits:
            only_a.append(str(va["ref"]))
            continue
        matched_b.update(k for k, _ in hits)
        if any(vb["ref"] == va["ref"] for _, vb in hits):
            agree.append(str(va["ref"]))
        else:
            disagree.append({"t": va["t"], "a": va["ref"], "b": [vb["ref"] for _, vb in hits]})
    only_b = [str(vb["ref"]) for k, vb in enumerate(b_verses) if k not in matched_b]
    return {
        "a": a_doc["engine"]["asr"],  # type: ignore[index]
        "b": b_doc["engine"]["asr"],  # type: ignore[index]
        "recognized_a": len(a_verses),
        "recognized_b": len(b_verses),
        "agree": len(agree),
        "only_a": only_a,
        "only_b": only_b,
        "disagreements": disagree,
        "timing_a": a_doc["timing"],
        "timing_b": b_doc["timing"],
        "note": "accord entre moteurs, pas exactitude : aucune vérité terrain",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("a", type=Path)
    parser.add_argument("b", type=Path)
    parser.add_argument("--min-overlap", type=float, default=0.5)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    report = compare(
        json.loads(args.a.read_text(encoding="utf-8")),
        json.loads(args.b.read_text(encoding="utf-8")),
        args.min_overlap,
    )
    text = json.dumps(report, ensure_ascii=False, indent=1)
    if args.out:
        args.out.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
