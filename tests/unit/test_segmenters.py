"""B2 : conversion des intervalles, repli Silero, réglages (sans modèle ni GPU)."""

from __future__ import annotations

from array import array

import pytest

from aqr.adapters.segmenters import (
    FallbackSegmenter,
    RecitationSegmenterConfig,
    SileroVadConfig,
    SileroVadSegmenter,
    intervals_to_spans,
)
from aqr.domain.models import TimeSpan
from aqr.domain.ports import AudioClip
from aqr.models.lock import ModelLockError


def clip(seconds: float = 5.0, rate: int = 16000) -> AudioClip:
    return AudioClip(
        samples=array("f", [0.1] * round(seconds * rate)), sample_rate=rate, source="t"
    )


def test_intervalles_tries_bornes_et_vides_ecartes():
    spans = intervals_to_spans([(3.0, 4.0), (0.0, 1.0), (2.0, 2.0), (4.5, 9.0), (-1.0, 0.5)], 5.0)
    assert spans == [TimeSpan(0.0, 1.0), TimeSpan(3.0, 4.0), TimeSpan(4.5, 5.0)]


def test_chevauchements_fusionnes():
    spans = intervals_to_spans([(0.0, 2.0), (1.5, 3.0), (4.0, 5.0)], 6.0)
    assert spans == [TimeSpan(0.0, 3.0), TimeSpan(4.0, 5.0)]


def test_aucun_intervalle():
    assert intervals_to_spans([], 5.0) == []


class Boom:
    def __init__(self, error: Exception) -> None:
        self.error = error

    def segment(self, clip: AudioClip) -> list[TimeSpan]:
        raise self.error


class Fixed:
    def __init__(self, spans: list[TimeSpan]) -> None:
        self.spans = spans
        self.calls = 0

    def segment(self, clip: AudioClip) -> list[TimeSpan]:
        self.calls += 1
        return self.spans


def test_le_principal_est_utilise_quand_il_fonctionne():
    primary, fallback = Fixed([TimeSpan(0, 1)]), Fixed([TimeSpan(2, 3)])
    seg = FallbackSegmenter(primary, fallback)
    assert seg.segment(clip()) == [TimeSpan(0, 1)]
    assert fallback.calls == 0 and seg.last_used == "primary"


@pytest.mark.parametrize(
    "error", [ModelLockError("absent"), RuntimeError("CUDA out of memory"), OSError("disque")]
)
def test_repli_sur_silero_si_le_principal_echoue(error):
    fallback = Fixed([TimeSpan(2, 3)])
    seg = FallbackSegmenter(Boom(error), fallback)
    assert seg.segment(clip()) == [TimeSpan(2, 3)]
    assert seg.last_used == "fallback" and str(error) in seg.last_error


def test_une_erreur_de_logique_n_est_pas_masquee_par_le_repli():
    seg = FallbackSegmenter(Boom(ValueError("fréquence d'échantillonnage invalide")), Fixed([]))
    with pytest.raises(ValueError, match="fréquence"):
        seg.segment(clip())


def test_reglages_configurables_sans_chemin_en_dur():
    cfg, vad = RecitationSegmenterConfig(), SileroVadConfig()
    assert cfg.model_key == "recitation-segmenter" and cfg.batch_size >= 1
    assert cfg.min_silence_ms > 0 and cfg.min_speech_ms > 0
    assert 0.0 < vad.threshold < 1.0 and vad.min_speech_ms > 0


def test_frequence_non_seize_kilohertz_refusee():
    from aqr.adapters.segmenters import SileroVadSegmenter

    with pytest.raises(ValueError, match="16000"):
        SileroVadSegmenter().segment(clip(rate=8000))


def test_repli_silero_declare_publiquement_qu_il_n_est_pas_fiable_par_defaut():
    # Limite mesurée (docs/evaluation/silero-fallback.md) : à ne retirer qu'avec une nouvelle
    # mesure documentée, jamais pour faire passer un test.
    assert SileroVadSegmenter.RELIABLE_BY_DEFAULT is False
    assert FallbackSegmenter.FALLBACK_RELIABLE_BY_DEFAULT is False
    for cls in (SileroVadSegmenter, FallbackSegmenter):
        assert "silero-fallback.md" in (cls.__doc__ or "")


def test_defauts_silero_inchanges_tant_que_non_calibres_sur_verite_terrain():
    config = SileroVadConfig()
    assert (config.min_silence_ms, config.min_speech_ms) == (100, 250)
