"""Sonde des abstentions (scripts/probe_abstentions.py) : sélection des plages, sans modèle."""

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _probe_module():
    spec = importlib.util.spec_from_file_location(
        "probe_abstentions", ROOT / "scripts" / "probe_abstentions.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # requis par @dataclass
    spec.loader.exec_module(module)
    return module


def _verse(ref: str, words: list[int], t: list[float], partial: bool) -> dict:
    return {"kind": "verse", "ref": ref, "words": words, "t": t, "partial": partial}


def _abst(t: list[float], reason: str = "below_threshold", score: float | None = 0.5) -> dict:
    return {"kind": "abstention", "reason": reason, "t": t, "best_score": score}


def test_une_abstention_qui_suit_de_pres_un_verset_partiel_est_toujours_sondee() -> None:
    probe = _probe_module()
    intervals = [
        _verse("2:266", [1, 9], [0.0, 10.0], partial=True),
        _abst([12.0, 20.0]),
        _verse("2:267", [1, 20], [21.0, 40.0], partial=False),
        _abst([41.0, 50.0]),
    ]
    picked = probe.pick_probes(intervals, sample=0)
    assert [(p.start_s, p.after_partial) for p in picked] == [(12.0, ("2:266", 1, 9))]
    assert picked[0].selected == "after_partial"


def test_trop_loin_ou_apres_un_verset_entier_ce_n_est_pas_une_suite() -> None:
    probe = _probe_module()
    intervals = [
        _verse("2:266", [1, 9], [0.0, 10.0], partial=True),
        _abst([30.0, 40.0]),
        _verse("2:267", [1, 20], [41.0, 60.0], partial=False),
        _abst([61.0, 70.0]),
    ]
    assert probe.pick_probes(intervals, sample=0) == []
    assert all(p.after_partial is None for p in probe.pick_probes(intervals, sample=5))


def test_l_echantillon_est_reparti_par_raison_deterministe_et_ignore_le_silence() -> None:
    probe = _probe_module()
    intervals = [_abst([float(i), i + 0.5]) for i in range(10)]
    intervals += [_abst([100.0 + i, 100.5 + i], "no_candidate", None) for i in range(10)]
    intervals += [_abst([200.0, 201.0], "silence", None)]
    picked = probe.pick_probes(intervals, sample=4)
    assert [p.reason for p in picked].count("below_threshold") == 2
    assert [p.reason for p in picked].count("no_candidate") == 2
    assert picked == probe.pick_probes(intervals, sample=4)
    assert {p.selected for p in picked} == {"random"}
    assert picked == sorted(picked, key=lambda p: p.start_s)


def test_suite_du_verset_meme_verset_apres_l_arret_ou_debut_du_verset_suivant() -> None:
    probe = _probe_module()
    partial = ("2:266", 1, 9)
    assert probe.continues(partial, "2:266", 10)
    assert probe.continues(partial, "2:266", 8)  # un mot de recouvrement à la reprise
    assert not probe.continues(partial, "2:266", 3)
    assert probe.continues(partial, "2:267", 1)
    assert not probe.continues(partial, "2:267", 10)
    assert not probe.continues(partial, "3:1", 1)


def test_les_abstentions_les_mieux_notees_sont_ajoutees_sans_doublon() -> None:
    probe = _probe_module()
    intervals = [_abst([float(i), i + 0.5], score=i / 10) for i in range(10)]
    picked = probe.pick_probes(intervals, sample=0, top_scores=3)
    assert [p.best_score for p in picked] == [0.7, 0.8, 0.9]
    assert {p.selected for p in picked} == {"top_score"}
    both = probe.pick_probes(intervals, sample=10, top_scores=3)
    assert len(both) == len({p.start_s for p in both}) == 10
