"""Script du banc du moteur incrémental (scripts/measure_live_engine.py) : logique pure."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

from aqr.live.events import Candidates, DegradationChanged, Locked, PartialTranscript
from aqr.live.pipeline import Emission
from tests.support.live_toy import ref
from tests.support.streaming_fakes import FakeStreamingASR

ROOT = Path(__file__).resolve().parents[1]


def _module():
    spec = importlib.util.spec_from_file_location(
        "measure_live_engine", ROOT / "scripts" / "measure_live_engine.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # requis par @dataclass
    spec.loader.exec_module(module)
    return module


m = _module()


def _emission(event, at: float) -> Emission:
    return Emission(event, emitted_at_s=at, lag_s=0.0)


def test_la_dispersion_donne_mediane_p90_p99_et_maximum() -> None:
    values = [float(i) for i in range(1, 101)]
    out = m.spread(values)
    assert out == {"count": 100, "median": 50.5, "p90": 90.0, "p99": 99.0, "max": 100.0}


def test_une_dispersion_vide_n_invente_rien() -> None:
    assert m.spread([]) == {"count": 0, "median": None, "p90": None, "p99": None, "max": None}


def test_la_memoire_est_un_nombre_positif_et_le_pic_n_est_pas_sous_l_actuel() -> None:
    current, peak = m.memory_mb()
    assert current > 10 and peak >= current - 1


def test_l_echantillonneur_de_memoire_garde_au_moins_le_debut_et_la_fin() -> None:
    with m.MemorySampler(every_s=0.01) as sampler:
        pass
    assert len(sampler.samples) >= 2


def test_les_evenements_sont_redates_de_leur_sortie_sans_le_provisoire() -> None:
    locked = Locked(
        t=3.0, ref=ref("114:2"), status=None, identity_basis="words", words_heard=3,
        first_word=1, posterior=0.99, start_s=0.0, end_s=2.0, repetition=False,
    )  # fmt: skip
    emissions = [
        _emission(PartialTranscript(1.0, 0.5, 1.0, "x"), 1.2),
        _emission(locked, 3.4),
        _emission(DegradationChanged(3.0, 1, False, 0.4, (), "tier", 4, 0.99), 3.4),
    ]
    stream = m.tracker_events(emissions)
    emit = m.reclock(emissions)
    assert [type(e) for e in stream] == [Locked] == [type(e) for e in emit]
    assert stream[0].t == 3.0 and emit[0].t == 3.4
    assert emit[0].ref == locked.ref  # seul le temps change


def test_un_lot_hors_du_split_dev_est_refuse(tmp_path: Path) -> None:
    entry = {"id": "real-recitation-lot9-99", "kind": "real-recitation", "audio": "x", "truth": {}}
    (tmp_path / "a.json").write_text(json.dumps(entry), encoding="utf-8")
    with pytest.raises(SystemExit):
        m.load_entries(tmp_path)


def test_un_dossier_sans_entree_est_refuse(tmp_path: Path) -> None:
    with pytest.raises(SystemExit):
        m.load_entries(tmp_path)


def test_l_enregistreur_garde_les_mots_normalises_sans_changer_le_flux() -> None:
    from array import array

    fake = FakeStreamingASR([("AA", 0.1, 0.4), ("--", 0.5, 0.8), ("BB", 0.9, 1.2)], delay_s=0.0)
    recorder = m.RecordingAsr(fake, lambda w: "" if w == "--" else w.lower())
    session = recorder.open()
    update = session.feed(array("f", [0.3] * 24000))
    update_end = session.finish()
    assert [w.word.text for w in (*update.stable, *update_end.stable)] == ["AA", "--", "BB"]
    assert [w.text for w in recorder.heard] == ["aa", "bb"]


def test_un_evenement_redate_garde_son_type() -> None:
    # evaluate s'appuie sur isinstance : le type doit survivre au redatage
    cand = Candidates(
        t=1.0, start_s=0.0, end_s=1.0, words_heard=1, count=2, items=(), leader=None,
        leader_posterior=0.5, shared_words=1, non_quran_posterior=0.0,
    )  # fmt: skip
    assert isinstance(m.reclock([_emission(cand, 2.0)])[0], Candidates)
