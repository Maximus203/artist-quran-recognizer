"""Script du banc de simulation du suivi en direct (scripts/measure_live_sim.py) : logique pure."""

import importlib.util
import json
import sys
from array import array
from pathlib import Path

import pytest

from aqr.data.manifest import ExpectedItem, NonQuranItem, WordRange
from aqr.data.mixer import Mix
from aqr.domain.models import NonQuranKind, Status, VerseRef

ROOT = Path(__file__).resolve().parents[1]


def _module():
    spec = importlib.util.spec_from_file_location(
        "measure_live_sim", ROOT / "scripts" / "measure_live_sim.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # requis par @dataclass
    spec.loader.exec_module(module)
    return module


m = _module()


def test_les_montages_couvrent_les_situations_du_suivi() -> None:
    plans = m.recipes()
    assert {"full-112", "jump-surah", "jump-back", "jump-skip", "repeat", "mid-67"} <= set(plans)
    assert plans["full-1"][0].kind == "basmala"  # 1:1 est la basmala, pas un verset à nommer
    assert all(
        step.ref is None or step.ref.surah != 1 or step.ref.ayah > 1 for step in plans["full-1"]
    )
    assert [str(s.ref) for s in plans["jump-skip"] if s.ref] == ["112:1", "112:3", "112:4"]


def test_les_montages_ne_nomment_que_des_versets_qui_existent() -> None:
    for steps in m.recipes().values():
        for step in steps:
            if step.kind == "verse":
                assert isinstance(step.ref, VerseRef)


def _mix(expected: list[ExpectedItem], non_quran: list[NonQuranItem]) -> Mix:
    return Mix(
        id="x",
        scenario="test",
        seed=1,
        reciter="Alafasy_128kbps",
        categorie=("C01",),
        langues=("ar",),
        samples=array("h", [0] * 16000),
        expected=tuple(expected),
        non_quran=tuple(non_quran),
    )


def test_la_verite_d_un_mixage_decale_le_verset_1_dit_avec_sa_basmala() -> None:
    mix = _mix(
        [
            ExpectedItem((0.0, 10.0), VerseRef(112, 1), WordRange.all(), Status.RECOGNIZED),
            ExpectedItem((11.0, 14.0), VerseRef(112, 2), WordRange.all(), Status.RECOGNIZED),
        ],
        [NonQuranItem((20.0, 25.0), NonQuranKind.FRENCH)],
    )
    verses, zones = m.mix_truth(mix, bismillah_s=4.0)
    assert [(str(v.ref), v.start_s, v.end_s) for v in verses] == [
        ("112:1", 4.0, 10.0),
        ("112:2", 11.0, 14.0),
    ]
    assert [(z.kind, z.start_s, z.end_s) for z in zones] == [
        ("basmala", 0.0, 4.0),
        ("french", 20.0, 25.0),
    ]


def test_un_verset_sans_basmala_ou_partiel_garde_son_debut() -> None:
    mix = _mix(
        [
            ExpectedItem((0.0, 5.0), VerseRef(112, 1), WordRange(2, 4), Status.RECOGNIZED),
            ExpectedItem((6.0, 9.0), VerseRef(2, 255), WordRange.all(), Status.RECOGNIZED),
        ],
        [],
    )
    verses, zones = m.mix_truth(mix, bismillah_s=4.0)
    assert [v.start_s for v in verses] == [0.0, 6.0]
    assert zones == []


def test_un_verset_brouille_est_du_bruit_pas_un_verset() -> None:
    mix = _mix([ExpectedItem((3.0, 6.0), VerseRef(112, 2), WordRange.all(), Status.INFERRED)], [])
    verses, zones = m.mix_truth(mix, bismillah_s=4.0)
    assert verses == []
    assert [(z.kind, z.start_s) for z in zones] == [("noise", 3.0)]


def test_les_fenetres_calmes_evitent_les_versets_et_les_formules() -> None:
    intervals = [
        {"kind": "abstention", "t": [0.0, 400.0]},
        {"kind": "verse", "t": [200.0, 205.0]},
        {"kind": "non_quran", "t": [330.0, 332.0]},
        {"kind": "abstention", "t": [405.0, 900.0]},
    ]
    windows = m.quiet_windows(intervals, length_s=50.0, spacing_s=10.0)
    assert windows
    for start, end in windows:
        assert start >= 120.0
        assert not (start <= 205.0 and end >= 200.0)
        assert not (start <= 332.0 and end >= 330.0)


def test_la_reference_d_un_lot_ne_garde_que_les_versets_de_la_fenetre(tmp_path: Path) -> None:
    document = {
        "intervals": [
            {"kind": "verse", "ref": "112:1", "status": "recognized", "t": [10.0, 14.0]},
            {"kind": "verse", "ref": "112:2", "status": "uncertain", "t": [15.0, 18.0]},
            {"kind": "verse", "ref": "112:3", "status": "inferred", "t": [20.0, 22.0]},
            {"kind": "verse", "ref": "112:4", "status": "recognized", "t": [700.0, 704.0]},
            {"kind": "abstention", "t": [30.0, 40.0]},
        ]
    }
    path = tmp_path / "x.recognition.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    reference = m.batch_intervals(path, 5.0, 600.0)
    assert reference["verses"] == [["112:1", 5.0, 9.0], ["112:3", 15.0, 17.0]]
    assert reference["zones"] == []


def test_le_balayage_couvre_l_a_priori_le_minimum_de_mots_et_le_seuil() -> None:
    grid = m.sweep_grid()
    core = [c for family, c in grid if family == "core"]
    guards = [c for family, c in grid if family == "guards"]
    assert len(core) == 3 * 4 * 3 and len(guards) == 2 * 5 * 3
    assert {c.prior for c in core} == {0.8, 0.9, 0.95}
    assert {c.min_words_lock for c in core} == {2, 3, 4, 5}
    assert len({(c.prior, c.min_words_lock, c.tau_lock) for c in core}) == len(core)
    assert {c.min_lock_confidence for c in guards} == {0.0, 0.5, 0.6, 0.7, 0.8}
    assert {c.min_exact_share for c in guards} == {0.0, 0.67, 1.0}
    assert all(c.prior == 0.9 for c in guards)  # les garde-fous se jugent à a priori constant


def test_le_groupe_d_une_entree_suit_son_type() -> None:
    assert m.group_name({"kind": "sequence", "id": "seq-full-112-alafasy"}) == "sequence:full"
    assert (
        m.group_name({"kind": "sequence", "id": "seq-jump-surah-husary"}) == "sequence:jump-surah"
    )
    assert m.group_name({"kind": "mix", "scenario": "priere", "id": "x"}) == "mix:priere"
    assert m.group_name({"kind": "real-speech", "id": "y"}) == "real-speech"


@pytest.mark.parametrize("name", ["full-112", "jump-surah"])
def test_chaque_montage_a_un_nom_stable(name: str) -> None:
    assert name in m.recipes()


def _run(index, label: str, truth_ref: str, text: str):
    from aqr.live.config import LiveConfig
    from aqr.live.simulation import Scenario, TruthVerse, evaluate, run_stream
    from tests.support.live_toy import Clock, ref

    words = tuple(Clock().say(text))
    scenario = Scenario(label, "sequence", words, 6.0, (TruthVerse(ref(truth_ref), 0.0, 2.0),), ())
    events = run_stream(index, LiveConfig(), scenario.words, scenario.duration_s)
    result = evaluate(scenario, events, index)
    return {"kind": "sequence", "id": label}, scenario, events, result


def test_la_confiance_des_verrous_separe_les_confirmes_des_non_confirmes() -> None:
    from tests.support.live_toy import toy_index

    index = toy_index()
    runs = [
        _run(index, "ok", "113:2", "nn oo pp qq"),
        _run(index, "faux", "113:3", "nn oo pp qq"),
    ]
    report = m.lock_confidence_report(runs)
    assert report["truth:confirmed"]["locks"] == 1
    assert report["truth:unconfirmed"]["locks"] == 1
    assert report["truth:confirmed"]["mean_confidence"]["median"] == 1.0
    assert report["truth:confirmed"]["exact_words"]["median"] == 3.0


def test_la_preuve_d_un_verrou_non_confirme_compte_mots_exacts_et_suite_commune() -> None:
    from tests.support.live_toy import toy_index

    index = toy_index()
    _entry, scenario, events, result = _run(index, "t", "113:3", "nn oo x9999999 qq")
    evidence = m.lock_evidence(index, scenario, events, result.false_locks[0])
    assert evidence["ref"] == "113:2" and evidence["verse_words"] == 4
    assert evidence["words_in_verse"] == 3 and evidence["longest_exact_run"] == 2
