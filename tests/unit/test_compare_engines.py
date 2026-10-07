"""Comparaison de deux moteurs : accord seulement, jamais présenté comme une exactitude."""

from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "compare_engines", ROOT / "scripts" / "compare_engines.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)  # type: ignore[union-attr]


def _doc(asr: str, verses: list[tuple[str, float, float, str]]) -> dict:
    return {
        "engine": {"asr": asr},
        "timing": {"total_s": 1.0},
        "intervals": [
            {"kind": "verse", "ref": r, "status": s, "t": [a, b]} for r, a, b, s in verses
        ]
        + [{"kind": "abstention", "reason": "silence", "t": [0.0, 1.0]}],
    }


def test_accord_desaccord_et_verset_propre_a_un_moteur():
    a = _doc(
        "A",
        [("1:2", 0, 4, "recognized"), ("1:7", 5, 9, "recognized"), ("2:1", 20, 22, "recognized")],
    )
    b = _doc(
        "B",
        [
            ("1:2", 0.2, 4.1, "recognized"),
            ("112:1", 5, 9, "recognized"),
            ("3:1", 40, 42, "recognized"),
        ],
    )
    report = module.compare(a, b, 0.5)
    assert report["agree"] == 1
    assert report["disagreements"] == [{"t": [5, 9], "a": "1:7", "b": ["112:1"]}]
    assert report["only_a"] == ["2:1"] and report["only_b"] == ["3:1"]
    assert "pas exactitude" in report["note"]


def test_inferred_et_uncertain_ne_comptent_pas_comme_reconnus():
    a = _doc("A", [("1:2", 0, 4, "inferred")])
    b = _doc("B", [("1:2", 0, 4, "uncertain")])
    report = module.compare(a, b, 0.5)
    assert report["recognized_a"] == report["recognized_b"] == 0 and report["agree"] == 0
