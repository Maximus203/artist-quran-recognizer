"""Les mêmes documents `aqr.decisions/1` que le test TypeScript de l'atelier
(`web/lib/decisions.test.ts`) : ce que Python accepte ou refuse, l'atelier l'accepte ou le refuse
aussi (un document que l'atelier écrit doit toujours être lu par l'export)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from aqr.decisions import DecisionsError, parse_decisions

CASES = json.loads(
    (Path(__file__).resolve().parents[1] / "fixtures" / "decisions" / "documents.json").read_text(
        encoding="utf-8"
    )
)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_meme_verdict_que_l_atelier(case: dict) -> None:
    if case["valid"]:
        parse_decisions(case["document"])
    else:
        with pytest.raises(DecisionsError):
            parse_decisions(case["document"])
