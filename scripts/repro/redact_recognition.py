#!/usr/bin/env python3
"""Expurge une sortie `aqr recognize` (JSON) pour la versionner : sans texte ni traduction.

python scripts/repro/redact_recognition.py lot1-05.recognition.json > lot1-05.redacted.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from aqr.pipeline.output import redact_document

if __name__ == "__main__":
    document = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    json.dump(redact_document(document), sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")
