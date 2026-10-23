"""LiveConfig (ADR-0011) : tous les réglages du suivi en direct, validés, jamais en dur ailleurs."""

from __future__ import annotations

import pytest

from aqr.live.config import LiveConfig


def test_les_valeurs_de_depart_sont_celles_decidees_le_2026_10_23() -> None:
    config = LiveConfig()
    assert config.prior == 0.9
    assert config.min_words_lock == 3


def test_un_a_priori_hors_de_zero_un_est_refuse() -> None:
    for bad in (0.0, 1.0, -0.1, 1.5):
        with pytest.raises(ValueError):
            LiveConfig(prior=bad)


def test_les_parts_doivent_etre_des_proportions() -> None:
    for name in ("local_share", "mid_verse_share"):
        with pytest.raises(ValueError):
            LiveConfig(**{name: 1.2})
        with pytest.raises(ValueError):
            LiveConfig(**{name: -0.1})


def test_les_probabilites_d_erreur_de_mot_sont_des_probabilites() -> None:
    for name in ("word_error", "word_deletion", "word_insertion", "non_quran_prior"):
        with pytest.raises(ValueError):
            LiveConfig(**{name: 0.0})
        with pytest.raises(ValueError):
            LiveConfig(**{name: 1.0})


def test_le_verrou_exige_au_moins_un_mot_et_un_posterior_credible() -> None:
    with pytest.raises(ValueError):
        LiveConfig(min_words_lock=0)
    with pytest.raises(ValueError):
        LiveConfig(tau_lock=0.4)
    with pytest.raises(ValueError):
        LiveConfig(tau_lock=1.0)


def test_une_config_se_derive_sans_toucher_l_originale() -> None:
    base = LiveConfig()
    other = base.replace(prior=0.8, min_words_lock=4)
    assert (other.prior, other.min_words_lock) == (0.8, 4)
    assert (base.prior, base.min_words_lock) == (0.9, 3)
    assert other.tau_lock == base.tau_lock


def test_replace_refuse_un_champ_inconnu() -> None:
    with pytest.raises(TypeError):
        LiveConfig().replace(inconnu=1)


def test_la_config_se_serialise_pour_le_rapport() -> None:
    data = LiveConfig().as_dict()
    assert data["prior"] == 0.9
    assert LiveConfig(**data) == LiveConfig()
