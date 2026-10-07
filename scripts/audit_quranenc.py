#!/usr/bin/env python3
"""Audit des traductions QuranEnc : détecte les anomalies de la SOURCE (jamais corrigées ici).

    python scripts/audit_quranenc.py --translation french_hameedullah \\
        --out docs/evaluation/quranenc-audit-french_hameedullah.json

Deux anomalies cherchées : (1) traduction d'un verset = même texte répété deux fois ;
(2) traduction d'un verset qui se termine par la traduction complète du verset précédent.
Rien n'est réécrit : l'invariant I2 impose de restituer la traduction telle que reçue. Ce script
ne fait que mesurer l'étendue du défaut pour le signaler au mainteneur de la source.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from aqr.domain.quran_structure import SURAH_COUNT

BASE = "https://quranenc.com/api/v1/translation/sura"


def fetch_sura(translation: str, sura: int) -> list[dict[str, str]]:
    request = urllib.request.Request(
        f"{BASE}/{translation}/{sura}",
        headers={"User-Agent": "artist-quran-recognizer/0.1 (+scripts/audit_quranenc.py)"},
    )
    for attempt in range(4):  # coupures TLS ponctuelles observées derrière le proxy
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                result: list[dict[str, str]] = json.load(response)["result"]
                return result
        except urllib.error.URLError:
            if attempt == 3:
                raise
            time.sleep(2 * 2**attempt)
    raise AssertionError("inatteignable")


def anomalies(verses: list[dict[str, str]]) -> list[dict[str, object]]:
    found: list[dict[str, object]] = []
    previous = ""  # traduction du verset précédent, ramenée à une seule occurrence
    for verse in verses:
        text = verse["translation"].strip()
        aya = int(verse["aya"])
        half = len(text) // 2
        unit = text
        if len(text) > 20 and text[:half].strip() == text[half:].strip():
            found.append({"aya": aya, "type": "repetition_exacte"})
            unit = text[:half].strip()
        elif previous and len(previous) > 20 and text.endswith(previous) and text != previous:
            found.append({"aya": aya, "type": "fin_du_verset_precedent"})
        previous = unit
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--translation", default="french_hameedullah")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    report: dict[str, object] = {"translation": args.translation, "source": BASE, "suras": {}}
    total = 0
    suras: dict[str, list[dict[str, object]]] = {}
    for sura in range(1, SURAH_COUNT + 1):
        found = anomalies(fetch_sura(args.translation, sura))
        if found:
            suras[str(sura)] = found
            total += len(found)
    report["suras"] = suras
    report["verses_flagged"] = total
    print(f"{args.translation} : {total} verset(s) signalé(s) dans {len(suras)} sourate(s)")
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(
            json.dumps(report, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
