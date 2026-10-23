"""Banc de simulation hors ligne du suivi en direct (ADR-0011, étape 1)."""

from __future__ import annotations

import pytest
from tests.support.live_toy import Clock, ref, toy_index

from aqr.domain.models import TimeSpan, VerseRef
from aqr.domain.ports import HeardWord, TranscribedWord
from aqr.live.config import LiveConfig
from aqr.live.corpus_flow import make_skeleton
from aqr.live.events import Locked
from aqr.live.replay import ArrivalModel, heard_words
from aqr.live.simulation import (
    Scenario,
    TruthVerse,
    TruthZone,
    evaluate,
    run_stream,
    summarize,
)


def words_at(texts: str, start: float, step: float = 0.5) -> list[HeardWord]:
    clock = Clock(step)
    clock.now = start
    return clock.say(texts)


def scenario(
    words: list[HeardWord],
    verses: list[TruthVerse],
    zones: list[TruthZone] | None = None,
    duration: float | None = None,
) -> Scenario:
    end = duration if duration is not None else max(w.end_s for w in words) + 1.0
    return Scenario(
        id="t",
        source="test",
        words=tuple(words),
        duration_s=end,
        verses=tuple(verses),
        zones=tuple(zones or ()),
    )


# --------------------------------------------------------------------------- arrivée des mots
def test_un_mot_n_arrive_qu_a_la_fin_du_bloc_qui_le_contient() -> None:
    model = ArrivalModel(block_s=1.0, settle_s=0.1, compute_s=0.0)
    assert model.arrival(0.5) == pytest.approx(1.0)
    assert model.arrival(0.95) == pytest.approx(2.0)  # 0,95 + 0,1 déborde du premier bloc
    assert model.arrival(2.0) == pytest.approx(3.0)


def test_le_temps_de_calcul_s_ajoute_a_l_arrivee() -> None:
    model = ArrivalModel(block_s=1.0, settle_s=0.0, compute_s=0.25)
    assert model.arrival(0.5) == pytest.approx(1.25)


def test_un_bloc_ou_un_delai_invalide_est_refuse() -> None:
    for bad in ({"block_s": 0.0}, {"settle_s": -0.1}, {"compute_s": -1.0}):
        with pytest.raises(ValueError):
            ArrivalModel(**bad)


def test_les_mots_de_l_asr_deviennent_des_mots_entendus_normalises_et_ordonnes() -> None:
    skeleton = make_skeleton({})
    raw = [
        TranscribedWord("قُلْ", TimeSpan(0.0, 0.4), 0.9),
        TranscribedWord("ـ", TimeSpan(0.4, 0.5), 0.9),  # rien après normalisation : écarté
        TranscribedWord("هُوَ", TimeSpan(0.5, 1.4), 0.9),
    ]
    heard = heard_words(raw, skeleton, ArrivalModel(block_s=1.0, settle_s=0.0))
    assert [w.text for w in heard] == [skeleton("قل"), skeleton("هو")]
    assert [w.arrival_s for w in heard] == [1.0, 2.0]
    assert heard[0].arrival_s >= heard[0].end_s


# --------------------------------------------------------------------------- rejeu
def test_le_rejeu_fait_avancer_le_silence_entre_les_mots() -> None:
    index = toy_index()
    words = words_at("aa", 0.0) + words_at("nn", 30.0)
    events = run_stream(index, LiveConfig(), words, duration_s=40.0)
    assert any(type(e).__name__ == "Lost" and e.reason == "silence" for e in events)  # type: ignore[attr-defined]


def test_le_rejeu_clot_le_flux_a_la_fin() -> None:
    index = toy_index()
    events = run_stream(index, LiveConfig(), words_at("nn oo pp", 0.0), duration_s=5.0)
    assert type(events[-1]).__name__ == "Continue"


def test_le_rejeu_est_deterministe() -> None:
    index = toy_index()
    words = words_at("nn oo pp qq rr ss tt", 0.0)
    assert run_stream(index, LiveConfig(), words, 10.0) == run_stream(
        index, LiveConfig(), words, 10.0
    )


# --------------------------------------------------------------------------- mesures
def test_les_latences_se_mesurent_depuis_le_debut_du_verset() -> None:
    index = toy_index()
    words = words_at("nn oo pp qq", 2.0)  # le verset 113:2 commence à 2,0 s
    truth = [TruthVerse(ref("113:2"), 2.0, 4.0)]
    result = evaluate(scenario(words, truth), run_stream(index, LiveConfig(), words, 6.0), index)
    verse = result.verses[0]
    assert verse.t_first_candidates == pytest.approx(0.5)  # arrivée du 1er mot : 2,5 s
    assert verse.t_locked == pytest.approx(1.5)  # 3e mot : 3,5 s
    assert verse.words_at_lock == 3
    assert verse.locked_correct is True
    assert verse.status == "recognized"
    assert verse.unique_prefix_words == 1
    assert result.false_locks == []


def test_la_liste_courte_est_la_premiere_a_contenir_le_bon_verset_en_peu_de_candidats() -> None:
    index = toy_index()
    words = words_at("aa bb xx yy zz", 0.0)
    truth = [TruthVerse(ref("113:1"), 0.0, 2.5)]
    result = evaluate(scenario(words, truth), run_stream(index, LiveConfig(), words, 5.0), index)
    verse = result.verses[0]
    assert verse.t_first_candidates == pytest.approx(0.5)
    assert verse.t_short_list == pytest.approx(0.5)  # 3 candidats d'emblée, dont le bon
    assert verse.t_locked == pytest.approx(1.5)


def test_un_verset_jamais_verrouille_n_a_pas_de_latence_de_verrou() -> None:
    index = toy_index()
    words = words_at("aa bb cc dd", 0.0)  # 112:1 et 113:5 sont des sosies
    truth = [TruthVerse(ref("112:1"), 0.0, 2.0)]
    result = evaluate(scenario(words, truth), run_stream(index, LiveConfig(), words, 5.0), index)
    verse = result.verses[0]
    assert verse.t_locked is None and verse.locked_correct is False
    assert verse.unique_prefix_words is None
    assert verse.closed_unresolved is True
    assert result.false_locks == []


def test_un_faux_verrou_est_compte_quand_la_verite_est_un_autre_verset() -> None:
    index = toy_index()
    # la vérité dit 113:5 (sosie de 112:1), le contexte attendu fait verrouiller 112:... on force
    # l'écart en annonçant la mauvaise vérité
    words = words_at("nn oo pp qq", 0.0)
    truth = [TruthVerse(ref("113:3"), 0.0, 2.0)]
    result = evaluate(scenario(words, truth), run_stream(index, LiveConfig(), words, 5.0), index)
    assert [fl.kind for fl in result.false_locks] == ["wrong_verse"]
    assert result.false_locks[0].locked == ref("113:2")
    assert result.false_locks[0].truth == ref("113:3")
    assert result.verses[0].locked_correct is False


def test_un_verrou_dans_une_zone_non_coranique_est_un_faux_verrou() -> None:
    index = toy_index()
    words = words_at("nn oo pp qq", 0.0)
    zones = [TruthZone(0.0, 2.0, "french")]
    result = evaluate(
        scenario(words, [], zones), run_stream(index, LiveConfig(), words, 5.0), index
    )
    assert [fl.kind for fl in result.false_locks] == ["non_quran"]
    assert result.zones[0].locks == 1


def test_une_zone_non_coranique_bien_ignoree_est_perdue_sans_verrou() -> None:
    index = toy_index()
    words = words_at("x1234567 x2345678 x3456789 x4567890", 0.0)
    zones = [TruthZone(0.0, 2.0, "french")]
    result = evaluate(
        scenario(words, [], zones), run_stream(index, LiveConfig(), words, 5.0), index
    )
    assert result.false_locks == []
    assert result.zones[0].locks == 0
    assert result.zones[0].lost == 1


def test_un_saut_attendu_est_detecte_et_un_saut_inattendu_est_signale() -> None:
    index = toy_index()
    clock = Clock()
    words = clock.say("nn oo pp qq")  # 113:2
    words += clock.say("ee ff")  # 112:2 : saut vers une autre sourate
    truth = [TruthVerse(ref("113:2"), 0.0, 2.0), TruthVerse(ref("112:2"), 2.0, 3.0)]
    result = evaluate(scenario(words, truth), run_stream(index, LiveConfig(), words, 6.0), index)
    assert (result.jumps_expected, result.jumps_detected, result.jumps_spurious) == (1, 1, 0)

    clock = Clock()
    words = clock.say("nn oo pp qq rr ss tt")  # la suite exacte
    truth = [TruthVerse(ref("113:2"), 0.0, 2.0), TruthVerse(ref("113:3"), 2.0, 3.5)]
    result = evaluate(scenario(words, truth), run_stream(index, LiveConfig(), words, 6.0), index)
    assert (result.jumps_expected, result.jumps_detected, result.jumps_spurious) == (0, 0, 0)


def test_la_suite_attendue_se_verrouille_plus_vite_que_sans_contexte() -> None:
    index = toy_index()
    clock = Clock()
    words = clock.say("rr ss tt") + clock.say("uu vv ww")
    truth = [TruthVerse(ref("113:3"), 0.0, 1.5), TruthVerse(ref("113:4"), 1.5, 3.0)]
    result = evaluate(scenario(words, truth), run_stream(index, LiveConfig(), words, 6.0), index)
    assert all(v.locked_correct for v in result.verses)
    assert result.verses[1].with_context is True and result.verses[0].with_context is False


def test_une_synthese_donne_la_mediane_le_p90_et_le_nombre_de_faux_verrous() -> None:
    index = toy_index()
    words = words_at("nn oo pp qq", 0.0)
    ok = evaluate(
        scenario(words, [TruthVerse(ref("113:2"), 0.0, 2.0)]),
        run_stream(index, LiveConfig(), words, 5.0),
        index,
    )
    bad = evaluate(
        scenario(words, [TruthVerse(ref("113:3"), 0.0, 2.0)]),
        run_stream(index, LiveConfig(), words, 5.0),
        index,
    )
    summary = summarize([ok, bad])
    assert summary["verses"] == 2
    assert summary["locked_correct"] == 1
    assert summary["false_locks"] == 1
    assert summary["t_locked_s"]["median"] == pytest.approx(1.5)


def test_une_synthese_vide_ne_plante_pas() -> None:
    summary = summarize([])
    assert summary["verses"] == 0 and summary["false_locks"] == 0
    assert summary["t_locked_s"]["median"] is None


def test_le_rejeu_sans_mot_ne_produit_aucun_evenement() -> None:
    index = toy_index()
    assert run_stream(index, LiveConfig(), [], duration_s=10.0) == []


def test_les_evenements_de_verrou_portent_le_temps_d_arrivee() -> None:
    index = toy_index()
    words = words_at("nn oo pp", 0.0)
    locks = [e for e in run_stream(index, LiveConfig(), words, 5.0) if isinstance(e, Locked)]
    assert locks and locks[0].t == words[-1].arrival_s
    assert VerseRef.parse("113:2") == locks[0].ref
