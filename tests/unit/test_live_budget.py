"""LiveBudget (ADR-0011 §7) : le retard décide du palier ; un palier sauté durcit le verrou."""

from __future__ import annotations

import pytest

from aqr.live.budget import BudgetConfig, LiveBudget, Tier
from aqr.live.config import LiveConfig


def budget(available: Tier = Tier.RELISTEN, **changes: float) -> LiveBudget:
    return LiveBudget(BudgetConfig(**changes), available=available)


def test_a_fresh_stream_runs_every_wired_tier_and_keeps_the_base_rule() -> None:
    b = budget()
    assert b.tier is Tier.RELISTEN and not b.overloaded
    assert b.observe(0.1) is None
    rule = b.lock_rule(LiveConfig())
    assert (rule.min_words_lock, rule.tau_lock) == (3, 0.98)


def test_a_growing_lag_gives_up_the_relisten_then_the_acoustic_tier() -> None:
    b = budget()
    change = b.observe(1.0)  # au-delà de lag_relisten_s (0,5)
    assert change is not None
    assert change.tier is Tier.ACOUSTIC and change.skipped == ("relisten",)
    assert change.reason == "tier"
    change = b.observe(3.0)  # au-delà de lag_acoustic_s (2)
    assert change is not None
    assert change.tier is Tier.ESSENTIAL and change.skipped == ("acoustic", "relisten")


def test_every_skipped_tier_hardens_the_lock_rule_and_never_loosens_it() -> None:
    base = LiveConfig()
    b = budget()
    b.observe(1.0)
    skipped = b.lock_rule(base)
    assert skipped.min_words_lock == base.min_words_lock + 1
    assert skipped.tau_lock > base.tau_lock
    b.observe(9.0)
    overloaded = b.lock_rule(base)
    assert overloaded.min_words_lock >= skipped.min_words_lock
    assert overloaded.tau_lock >= skipped.tau_lock
    assert b.overloaded


def test_the_rule_is_never_below_a_base_that_is_already_stricter() -> None:
    base = LiveConfig(min_words_lock=6, tau_lock=0.999)
    b = budget()
    b.observe(1.0)
    rule = b.lock_rule(base)
    assert rule.min_words_lock == 7 and rule.tau_lock == 0.999


def test_overload_is_announced_even_when_no_other_tier_is_wired() -> None:
    b = budget(available=Tier.ESSENTIAL)
    assert b.observe(1.0) is None  # rien à sauter : le palier 1 tient
    change = b.observe(7.0)
    assert change is not None and change.overloaded and change.reason == "overload"
    assert change.skipped == ()
    assert b.lock_rule(LiveConfig()).min_words_lock == 3 + 2


def test_nothing_is_hardened_when_no_tier_above_the_first_is_wired() -> None:
    b = budget(available=Tier.ESSENTIAL)
    b.observe(3.0)
    assert b.lock_rule(LiveConfig()).min_words_lock == 3


def test_recovery_takes_several_calm_blocks_so_a_blip_does_not_flap() -> None:
    b = budget(recover_blocks=3)
    b.observe(1.0)
    assert b.observe(0.1) is None and b.observe(0.1) is None  # 2 blocs calmes : pas encore
    assert b.observe(1.0) is None  # un accroc remet le compte à zéro
    assert b.tier is Tier.ACOUSTIC
    assert b.observe(0.1) is None and b.observe(0.1) is None
    change = b.observe(0.1)
    assert change is not None and change.tier is Tier.RELISTEN and change.reason == "recovered"
    assert change.skipped == ()
    assert b.lock_rule(LiveConfig()).min_words_lock == 3  # la règle de base revient


def test_a_lag_that_keeps_growing_is_repeated_not_hidden() -> None:
    b = budget(report_step_s=5.0)
    assert b.observe(6.0) is not None  # surcharge annoncée à 6 s
    assert b.observe(8.0) is None
    again = b.observe(11.5)
    assert again is not None and again.reason == "lag_growing" and again.lag_s == 11.5
    assert b.observe(13.0) is None


def test_a_negative_or_nan_lag_is_refused() -> None:
    with pytest.raises(ValueError):
        budget().observe(-0.1)
    with pytest.raises(ValueError):
        budget().observe(float("nan"))


@pytest.mark.parametrize(
    "changes",
    [
        {"lag_relisten_s": 3.0},  # doit rester sous lag_acoustic_s
        {"lag_acoustic_s": 6.0},  # doit rester sous lag_overload_s
        {"recover_blocks": 0},
        {"skipped_tau_lock": 0.4},
        {"overload_extra_words": -1},
        {"report_step_s": 0.0},
    ],
)
def test_an_incoherent_budget_is_refused(changes: dict[str, float]) -> None:
    with pytest.raises(ValueError):
        BudgetConfig(**changes)  # type: ignore[arg-type]
