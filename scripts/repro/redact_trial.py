#!/usr/bin/env python3
"""Expurge une sortie de `lot1_trial_v0.py` pour la versionner : aucune transcription brute
(le texte de l'ASR sur une voix de tiers n'est pas à publier), seulement temps, références, scores,
détections.

    python scripts/repro/redact_trial.py trial_05.json > docs/evaluation/trials/lot1-05.v0.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def redact(data: dict[str, object]) -> dict[str, object]:
    out = {k: v for k, v in data.items() if k != "segments"}
    segments = data["segments"]
    assert isinstance(segments, list)
    out["segments"] = [{k: v for k, v in seg.items() if k != "text"} for seg in segments]
    return out


if __name__ == "__main__":
    payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    json.dump(redact(payload), sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")
