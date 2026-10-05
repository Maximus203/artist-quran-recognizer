"""B4 FastConformerQuranASR : logique d'adaptation testée avec un faux modèle NeMo (sans GPU)."""

from __future__ import annotations

from array import array
from types import SimpleNamespace

import pytest

from aqr.adapters.fastconformer import FastConformerConfig, FastConformerQuranASR
from aqr.domain.models import Riwaya, TimeSpan
from aqr.domain.ports import AudioClip

RATE = 16000


def clip(seconds: float, value: float = 0.1) -> AudioClip:
    return AudioClip(
        samples=array("f", [value] * round(seconds * RATE)), sample_rate=RATE, source="test"
    )


def hyp(words: list[tuple[str, float, float]], conf: list[float] | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        text=" ".join(w for w, _a, _b in words),
        timestamp={"word": [{"word": w, "start": a, "end": b} for w, a, b in words]},
        word_confidence=conf,
    )


class FakeNemo:
    def __init__(self, outputs: list[SimpleNamespace]) -> None:
        self.outputs = outputs
        self.calls: list[dict] = []

    def transcribe(self, audios, **kwargs):  # type: ignore[no-untyped-def]
        self.calls.append({"n": len(audios), "lengths": [len(a) for a in audios], **kwargs})
        return self.outputs[: len(audios)]


def asr(model: FakeNemo, **config) -> FastConformerQuranASR:
    config.setdefault("context_pad_s", 0.0)  # les tests de base isolent l'adaptation, sans marge
    return FastConformerQuranASR(
        FastConformerConfig(**config), model=model, revision="abc123def456"
    )


def test_les_temps_sont_decales_de_l_origine_du_segment():
    model = FakeNemo([hyp([("قُلْ", 0.0, 0.4), ("هُوَ", 0.4, 0.9)], [0.9, 0.8])])
    transcript = asr(model).transcribe(clip(10.0), TimeSpan(5.0, 7.0))
    assert [(w.text, w.time.start_s, w.time.end_s) for w in transcript.words] == [
        ("قُلْ", 5.0, 5.4),
        ("هُوَ", 5.4, 5.9),
    ]
    assert [w.confidence for w in transcript.words] == [0.9, 0.8]


def test_seul_le_segment_est_envoye_au_modele():
    model = FakeNemo([hyp([("الصمد", 0.0, 0.5)])])
    asr(model).transcribe(clip(10.0), TimeSpan(5.0, 7.0))
    assert model.calls[0]["lengths"] == [2 * RATE]
    assert model.calls[0]["timestamps"] is True


def test_texte_brut_du_modele_jamais_modifie():
    # I1 : l'ASR localise, il ne « corrige » rien ; la normalisation est le travail du matcher.
    model = FakeNemo([hyp([("اللَّهُ", 0.0, 0.5)])])
    transcript = asr(model).transcribe(clip(2.0), TimeSpan(0.0, 1.0))
    assert transcript.words[0].text == "اللَّهُ"


def test_engine_porte_le_modele_la_revision_et_le_decodeur():
    transcript = asr(FakeNemo([hyp([])]), decoder_type="ctc").transcribe(clip(2.0), TimeSpan(0, 1))
    assert transcript.engine == "fastconformer-quran@abc123def456/ctc"


def test_aucun_mot_donne_un_transcript_vide():
    transcript = asr(FakeNemo([hyp([])])).transcribe(clip(2.0), TimeSpan(0.0, 1.0))
    assert transcript.words == ()


def test_confiance_absente_devient_zero_et_non_inventee():
    transcript = asr(FakeNemo([hyp([("قُلْ", 0.0, 0.4)], None)])).transcribe(
        clip(2.0), TimeSpan(0.0, 1.0)
    )
    assert transcript.words[0].confidence == 0.0


def test_mot_de_duree_nulle_recoit_une_duree_minimale_configuree():
    model = FakeNemo([hyp([("قُلْ", 1.0, 1.0)])])
    word = asr(model, min_word_s=0.08).transcribe(clip(3.0), TimeSpan(0.0, 3.0)).words[0]
    assert word.time.end_s - word.time.start_s == pytest.approx(0.08)


def test_les_mots_restent_dans_le_segment():
    model = FakeNemo([hyp([("قُلْ", 0.9, 1.3)])])  # déborde de 0.3 s sur un segment de 1 s
    word = asr(model).transcribe(clip(3.0), TimeSpan(0.0, 1.0)).words[0]
    assert word.time.end_s <= 1.0 and word.time.start_s < word.time.end_s


def test_segment_hors_du_clip_est_une_erreur():
    with pytest.raises(ValueError, match="hors"):
        asr(FakeNemo([hyp([])])).transcribe(clip(2.0), TimeSpan(1.0, 5.0))


def test_segment_plus_court_qu_une_trame_ne_sollicite_pas_le_modele():
    model = FakeNemo([hyp([("x", 0, 1)])])
    transcript = asr(model).transcribe(clip(2.0), TimeSpan(0.0, 0.01))
    assert transcript.words == () and model.calls == []


def test_batch_envoie_tous_les_segments_en_un_appel():
    model = FakeNemo([hyp([("أ", 0.0, 0.4)]), hyp([("ب", 0.1, 0.5)])])
    spans = [TimeSpan(0.0, 1.0), TimeSpan(2.0, 3.0)]
    result = asr(model).transcribe_batch(clip(5.0), spans)
    assert len(model.calls) == 1 and model.calls[0]["n"] == 2
    assert [t.words[0].time.start_s for t in result] == [0.0, 2.1]


def test_riwaya_est_hafs():
    assert asr(FakeNemo([])).riwaya is Riwaya.HAFS


def test_configuration_sans_chemin_en_dur():
    cfg = FastConformerConfig()
    assert cfg.decoder_type in {"ctc", "rnnt"} and cfg.batch_size >= 1 and cfg.min_word_s > 0


def test_silence_numerique_n_est_jamais_envoye_au_modele():
    # Constat réel : le modèle hallucine « الم » sur du silence absolu.
    model = FakeNemo([hyp([("الم", 0.0, 0.08)])])
    transcript = asr(model).transcribe(clip(3.0, value=0.0), TimeSpan(0.0, 3.0))
    assert transcript.words == () and model.calls == []


def test_seuil_d_energie_configurable():
    model = FakeNemo([hyp([("قُلْ", 0.0, 0.4)])])
    quiet = clip(3.0, value=0.001)  # RMS 1e-3
    assert asr(model, silence_rms=0.01).transcribe(quiet, TimeSpan(0.0, 3.0)).words == ()
    assert asr(model, silence_rms=1e-4).transcribe(quiet, TimeSpan(0.0, 3.0)).words


# --- marge de contexte (optionnelle : voir FastConformerConfig.context_pad_s) ------------------


def test_marge_reelle_de_part_et_d_autre_quand_le_clip_la_fournit():
    model = FakeNemo([hyp([("قُلْ", 0.5, 0.9)])])  # temps dans l'audio envoyé (marge de 0.5 s)
    transcript = asr(model, context_pad_s=0.5).transcribe(clip(10.0), TimeSpan(5.0, 7.0))
    assert model.calls[0]["lengths"] == [3 * RATE]  # 0.5 + 2.0 + 0.5 s
    word = transcript.words[0]
    assert (word.time.start_s, word.time.end_s) == (5.0, 5.4)  # ramené à l'origine du segment


def test_marge_completee_par_du_silence_aux_bords_du_clip():
    model = FakeNemo([hyp([("قُلْ", 0.5, 0.9)])])
    asr(model, context_pad_s=0.5).transcribe(clip(10.0), TimeSpan(0.0, 2.0))
    assert model.calls[0]["lengths"] == [3 * RATE]  # 0.5 s de silence ajouté à gauche


def test_mots_entierement_dans_la_marge_sont_ecartes():
    model = FakeNemo(
        [hyp([("avant", 0.1, 0.4), ("قُلْ", 0.6, 1.0), ("après", 2.6, 2.9)])]
    )  # segment utile : 0.5 -> 2.5 s de l'audio envoyé
    transcript = asr(model, context_pad_s=0.5).transcribe(clip(10.0), TimeSpan(5.0, 7.0))
    assert [w.text for w in transcript.words] == ["قُلْ"]


def test_mot_a_cheval_sur_le_bord_est_borne_au_segment():
    model = FakeNemo([hyp([("قُلْ", 0.3, 0.8)])])  # commence 0.2 s avant le segment
    word = asr(model, context_pad_s=0.5).transcribe(clip(10.0), TimeSpan(5.0, 7.0)).words[0]
    assert word.time.start_s == 5.0 and word.time.end_s == pytest.approx(5.3)


def test_la_garde_de_silence_ne_regarde_que_le_segment_pas_la_marge():
    # un segment muet entouré de parole ne doit pas être transcrit (la marge contient du signal)
    loud = clip(10.0, value=0.2)
    for i in range(round(5.0 * RATE), round(7.0 * RATE)):
        loud.samples[i] = 0.0  # type: ignore[index]
    model = FakeNemo([hyp([("الم", 0.5, 0.6)])])
    assert asr(model, context_pad_s=0.5).transcribe(loud, TimeSpan(5.0, 7.0)).words == ()
    assert model.calls == []


def test_marge_desactivee_par_defaut_car_mesuree_defavorable():
    cfg = FastConformerConfig()
    assert cfg.context_pad_s == 0.0 and cfg.pad_noise == 0.0
