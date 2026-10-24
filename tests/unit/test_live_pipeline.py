"""LivePipeline (ADR-0011, étape 2) : blocs audio -> ASR incrémental -> suivi -> événements."""

from __future__ import annotations

import math
from array import array
from collections.abc import Sequence

import pytest
from tests.support.live_toy import ref, toy_index
from tests.support.streaming_fakes import FakeStreamingASR

from aqr.domain.models import Status, VerseRef
from aqr.domain.ports import HeardWord
from aqr.live.budget import BudgetConfig, CheckVerdict, Tier
from aqr.live.clocks import ManualClock
from aqr.live.config import LiveConfig
from aqr.live.events import (
    Candidates,
    Continue,
    DegradationChanged,
    LiveEvent,
    Locked,
    Lost,
    PartialTranscript,
    Revision,
)
from aqr.live.pipeline import Emission, LivePipeline
from aqr.live.simulation import run_stream

RATE = 16000
BLOCK = RATE // 10  # 100 ms


def loud(seconds: float) -> array[float]:
    return array("f", [0.3] * round(seconds * RATE))


def script(words: str, step: float = 0.5, start: float = 0.2) -> list[tuple[str, float, float]]:
    return [
        (w, start + i * step, start + (i + 1) * step - 0.05) for i, w in enumerate(words.split())
    ]


def make(
    words: str,
    *,
    clock: ManualClock | None = None,
    cost_s: float = 0.0,
    delay_s: float = 0.2,
    **kwargs: object,
) -> tuple[LivePipeline, ManualClock]:
    clock = clock or ManualClock()
    asr = FakeStreamingASR(script(words), delay_s=delay_s, on_feed=lambda _t: clock.advance(cost_s))
    pipeline = LivePipeline(asr, toy_index(), lambda w: w, clock=clock, **kwargs)  # type: ignore[arg-type]
    return pipeline, clock


def run(
    pipeline: LivePipeline, seconds: float, *, clock: ManualClock | None = None
) -> list[Emission]:
    out: list[Emission] = []
    audio = loud(seconds)
    for k, i in enumerate(range(0, len(audio), BLOCK)):
        if clock is not None:
            clock.begin(max(clock(), (k + 1) * BLOCK / RATE))
        out.extend(pipeline.feed(audio[i : i + BLOCK], received_at_s=(k + 1) * BLOCK / RATE))
    out.extend(pipeline.finish(received_at_s=seconds))
    return out


def events(emissions: Sequence[Emission]) -> list[LiveEvent]:
    return [e.event for e in emissions]


def of(emissions: Sequence[Emission], kind: type) -> list:  # type: ignore[type-arg]
    return [e for e in events(emissions) if isinstance(e, kind)]


# --------------------------------------------------------------------------- flux nominal
def test_un_flux_de_blocs_donne_candidats_puis_verrou_puis_cloture() -> None:
    pipeline, clock = make("m1 m2 m3 m4 m5 m6 m7 m8")
    out = run(pipeline, 5.0, clock=clock)
    kinds = [type(e).__name__ for e in events(out)]
    assert kinds.index("Candidates") < kinds.index("Locked") < kinds.index("Continue")
    locked = of(out, Locked)[0]
    assert locked.ref == ref("114:2") and locked.status is Status.RECOGNIZED
    assert locked.words_heard == 3


def test_le_verrou_arrive_apres_le_troisieme_mot_pas_avant() -> None:
    pipeline, clock = make("m1 m2 m3 m4 m5 m6 m7 m8")
    out = run(pipeline, 5.0, clock=clock)
    third_word_end = 0.2 + 3 * 0.5 - 0.05
    assert of(out, Locked)[0].t >= third_word_end
    assert all(not isinstance(e.event, Locked) for e in out if e.event.t < third_word_end)


def test_chaque_evenement_porte_le_moment_de_son_emission_apres_le_calcul() -> None:
    pipeline, clock = make("m1 m2 m3 m4", cost_s=0.03)
    out = run(pipeline, 3.0, clock=clock)
    assert out
    for emission in out:
        assert emission.emitted_at_s >= emission.event.t - 1e-9
        assert emission.lag_s >= 0.03 - 1e-9


def _arrivals(words: list[tuple[str, float, float]], delay: float = 0.2) -> list[float]:
    """Le faux ASR livre un mot au premier bloc de 100 ms qui est `delay` après sa fin."""
    return [math.ceil((end + delay) * 10 - 1e-9) / 10 for _text, _start, end in words]


def _shape(evs: Sequence[LiveEvent]) -> list[tuple[str, object, object]]:
    return [
        (type(e).__name__, getattr(e, "ref", None), getattr(e, "words_heard", None))
        for e in evs
        if isinstance(e, Candidates | Locked | Continue)
    ]


def test_les_evenements_du_suivi_sont_ceux_du_rejeu_par_lots_sur_les_memes_mots() -> None:
    spoken = script("m1 m2 m3 m4 m5 m6 m7 m8")
    pipeline, clock = make("m1 m2 m3 m4 m5 m6 m7 m8")
    live = events(run(pipeline, 5.0, clock=clock))
    heard = [
        HeardWord(text=t, start_s=a, end_s=b, arrival_s=arrival)
        for (t, a, b), arrival in zip(spoken, _arrivals(spoken), strict=True)
    ]
    batch = run_stream(toy_index(), LiveConfig(), heard, 5.0)
    assert _shape(live) == _shape(batch)


def test_le_texte_provisoire_est_un_evenement_a_part_jamais_un_verrou() -> None:
    pipeline, clock = make("m1 m2 m3")
    out = run(pipeline, 3.0, clock=clock)
    partials = of(out, PartialTranscript)
    assert partials and all(p.text for p in partials)
    assert all(
        p.t <= e.emitted_at_s
        for e in out
        if isinstance(e.event, PartialTranscript)
        for p in [e.event]
    )


def test_un_texte_provisoire_inchange_n_est_pas_redit() -> None:
    pipeline, _ = make("m1 m2 m3")
    pipeline.feed(loud(0.4))
    first = [e for e in pipeline.feed(loud(0.1)) if isinstance(e.event, PartialTranscript)]
    again = [e for e in pipeline.feed([]) if isinstance(e.event, PartialTranscript)]
    assert first and again == []


def test_les_mots_sont_normalises_comme_le_flux_du_coran_avant_le_suivi() -> None:
    clock = ManualClock()
    asr = FakeStreamingASR(
        [(w.upper(), 0.2 + i * 0.5, 0.65 + i * 0.5) for i, w in enumerate(["m1", "m2", "m3", "m4"])]
    )
    pipeline = LivePipeline(asr, toy_index(), lambda w: w.lower(), clock=clock)
    out = run(pipeline, 3.0, clock=clock)
    assert of(out, Locked)[0].ref == ref("114:2")


def test_un_mot_vide_apres_normalisation_est_ecarte() -> None:
    clock = ManualClock()
    words = [("-", 0.2, 0.6), *script("m1 m2 m3", start=0.7)]
    asr = FakeStreamingASR(words)
    pipeline = LivePipeline(asr, toy_index(), lambda w: "" if w == "-" else w, clock=clock)
    out = run(pipeline, 3.0, clock=clock)
    assert of(out, Locked)[0].words_heard == 3


def test_la_parole_etrangere_ne_nomme_aucun_verset() -> None:
    pipeline, clock = make("zzzz yyyy xxxx wwww vvvv")
    out = run(pipeline, 4.0, clock=clock)
    assert not of(out, Locked)
    assert not of(out, Candidates)


def test_le_silence_perd_le_passage_une_seule_fois() -> None:
    pipeline, _ = make("m1 m2")
    audio = loud(1.5)
    out: list[Emission] = []
    for k, i in enumerate(range(0, len(audio), BLOCK)):
        out.extend(pipeline.feed(audio[i : i + BLOCK], received_at_s=(k + 1) * 0.1))
    quiet = array("f", [0.0] * RATE)
    for k in range(12):  # 12 s de silence
        out.extend(pipeline.feed(quiet, received_at_s=1.5 + (k + 1)))
    assert len(of(out, Lost)) == 1


def test_apres_la_fin_plus_rien_n_est_accepte() -> None:
    pipeline, _ = make("m1")
    pipeline.finish()
    with pytest.raises(ValueError):
        pipeline.feed(loud(0.1))
    assert pipeline.finish() == []


def test_la_fin_du_flux_clot_le_passage_ouvert() -> None:
    pipeline, clock = make("m1 m2 m3 m4")
    out = run(pipeline, 2.6, clock=clock)
    closed = of(out, Continue)
    assert closed and closed[-1].ref == ref("114:2") and not closed[-1].complete


# --------------------------------------------------------------------------- budget et dégradation
def test_un_calcul_plus_rapide_que_le_temps_reel_ne_degrade_rien() -> None:
    pipeline, clock = make("m1 m2 m3 m4 m5 m6 m7 m8", cost_s=0.02)
    out = run(pipeline, 5.0, clock=clock)
    assert not of(out, DegradationChanged)
    stats = pipeline.stats
    assert stats.degraded_blocks == 0
    assert stats.realtime_factor == pytest.approx(0.02 * stats.blocks / 5.0, rel=0.2)


def test_un_calcul_plus_lent_que_le_temps_reel_le_dit_et_ne_l_accumule_pas_en_silence() -> None:
    pipeline, clock = make("m1 m2 m3 m4 m5 m6 m7 m8", cost_s=0.25)  # 2,5x le temps réel
    out = run(pipeline, 5.0, clock=clock)
    changes = of(out, DegradationChanged)
    assert changes, "un retard qui s'installe doit être annoncé"
    assert changes[0].overloaded or changes[0].tier is not Tier.RELISTEN
    assert changes[-1].lag_s > 5.0
    assert pipeline.stats.max_lag_s > 5.0
    assert pipeline.stats.degraded_blocks > 0


def test_en_surcharge_le_verrou_exige_plus_de_mots_que_le_reglage_de_depart() -> None:
    pipeline, clock = make("m1 m2 m3 m4 m5 m6 m7 m8", cost_s=1.0)
    out = run(pipeline, 6.0, clock=clock)
    locked = of(out, Locked)
    assert locked, "le verset finit par être nommé, mais plus tard"
    assert locked[0].words_heard >= 3 + BudgetConfig().overload_extra_words


def test_la_regle_durcie_est_dite_dans_l_evenement_de_degradation() -> None:
    pipeline, clock = make("m1 m2 m3 m4 m5 m6 m7 m8", cost_s=0.25)
    out = run(pipeline, 5.0, clock=clock)
    change = of(out, DegradationChanged)[0]
    assert change.min_words_lock > 3 and change.tau_lock > 0.98


def test_le_retour_a_la_normale_est_dit_et_la_regle_de_base_revient() -> None:
    clock = ManualClock()
    costs = {"now": 0.4}
    asr = FakeStreamingASR(script("m1 m2"), on_feed=lambda _t: clock.advance(costs["now"]))
    pipeline = LivePipeline(asr, toy_index(), lambda w: w, clock=clock)
    audio = loud(8.0)
    out: list[Emission] = []
    for k, i in enumerate(range(0, len(audio), BLOCK)):
        at = (k + 1) * 0.1
        clock.begin(max(clock(), at))
        if k == 25:
            costs["now"] = 0.0  # la charge retombe : le retard se résorbe
        out.extend(pipeline.feed(audio[i : i + BLOCK], received_at_s=at))
    reasons = [c.reason for c in of(out, DegradationChanged)]
    assert "recovered" in reasons
    assert pipeline.lock_rule == (3, 0.98)


# --------------------------------------------------------------------------- contrôles par palier
class Recording:
    def __init__(self, name: str, tier: Tier, accepted: bool = True) -> None:
        self.name = name
        self.tier = tier
        self.accepted = accepted
        self.calls: list[tuple[VerseRef, float, float, int]] = []

    def check(
        self, ref: VerseRef, status: Status, samples: Sequence[float], start_s: float, end_s: float
    ) -> CheckVerdict:
        self.calls.append((ref, start_s, end_s, len(samples)))
        return CheckVerdict(self.accepted, "" if self.accepted else "audio_contradicts")


def test_un_controle_branche_s_execute_a_la_cloture_quand_le_budget_le_permet() -> None:
    acoustic = Recording("acoustic", Tier.ACOUSTIC)
    pipeline, clock = make("m1 m2 m3 m4 m5 m6 m7 m8", checks=[acoustic])
    out = run(pipeline, 6.0, clock=clock)
    assert [c[0] for c in acoustic.calls] == [ref("114:2")]
    assert acoustic.calls[0][3] > 0  # il a reçu l'audio du verset
    assert not of(out, Revision)
    assert pipeline.stats.checks_run == {"acoustic": 1}


def test_un_controle_qui_refuse_retire_le_verrou_par_une_revision_visible() -> None:
    acoustic = Recording("acoustic", Tier.ACOUSTIC, accepted=False)
    pipeline, clock = make("m1 m2 m3 m4 m5 m6 m7 m8", checks=[acoustic])
    out = run(pipeline, 6.0, clock=clock)
    revisions = of(out, Revision)
    assert len(revisions) == 1 and revisions[0].ref == ref("114:2")
    assert "acoustic" in revisions[0].reason and "audio_contradicts" in revisions[0].reason


def test_un_palier_saute_ne_lance_pas_son_controle_et_durcit_le_verrou() -> None:
    relisten = Recording("relisten", Tier.RELISTEN)
    pipeline, clock = make("m1 m2 m3 m4 m5 m6 m7 m8", checks=[relisten], cost_s=0.15)
    out = run(pipeline, 7.0, clock=clock)
    assert relisten.calls == []
    assert pipeline.stats.checks_skipped.get("relisten", 0) >= 1
    change = of(out, DegradationChanged)[0]
    assert "relisten" in change.skipped
    assert change.min_words_lock == 3 + BudgetConfig().skipped_extra_words


def test_un_controle_dont_l_audio_est_deja_sorti_de_la_memoire_est_saute_et_dit() -> None:
    acoustic = Recording("acoustic", Tier.ACOUSTIC)
    pipeline, clock = make(
        "m1 m2 m3 m4 m5 m6 m7 m8", checks=[acoustic], budget=BudgetConfig(ring_s=1.0)
    )
    run(pipeline, 6.0, clock=clock)
    assert acoustic.calls == []
    assert pipeline.stats.checks_skipped.get("acoustic", 0) == 1
    assert pipeline.stats.windows_lost == 1


def test_sans_controle_branche_l_audio_n_est_pas_garde() -> None:
    pipeline, clock = make("m1 m2 m3")
    run(pipeline, 3.0, clock=clock)
    assert pipeline.retained_audio_s == 0.0
