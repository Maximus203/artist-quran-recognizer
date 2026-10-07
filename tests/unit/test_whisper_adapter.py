"""B4 WhisperTarteelASR : logique d'adaptation testée avec un faux moteur (sans GPU)."""

from __future__ import annotations

from array import array

import pytest

from aqr.adapters.whisper_tarteel import (
    WhisperTarteelASR,
    WhisperTarteelConfig,
    strip_control_tokens,
)
from aqr.corpus.normalize import normalize_arabic
from aqr.domain.models import Riwaya, TimeSpan
from aqr.domain.ports import AudioClip

RATE = 16000


def clip(seconds: float, value: float = 0.1) -> AudioClip:
    return AudioClip(
        samples=array("f", [value] * round(seconds * RATE)), sample_rate=RATE, source="test"
    )


class FakeBackend:
    def __init__(self, outputs: list[tuple[str, float]]) -> None:
        self.outputs = outputs
        self.calls: list[list[int]] = []

    def generate(self, audios):  # type: ignore[no-untyped-def]
        self.calls.append([len(a) for a in audios])
        return self.outputs[: len(audios)]


def asr(backend: FakeBackend, **config) -> WhisperTarteelASR:
    return WhisperTarteelASR(
        WhisperTarteelConfig(**config), backend=backend, revision="5c3c53fdf927"
    )


def test_mots_du_modele_tels_quels_avec_leurs_voyelles():
    backend = FakeBackend([("قُلْ هُوَ اللَّهُ أَحَدٌ", 0.9)])
    words = asr(backend).transcribe(clip(4.0), TimeSpan(0.0, 4.0)).words
    assert [w.text for w in words] == ["قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"]


def test_temps_estimes_au_prorata_des_lettres_dans_le_segment_et_decales():
    backend = FakeBackend([("أب جدهوز", 0.8)])  # 2 lettres puis 5 lettres
    words = asr(backend).transcribe(clip(10.0), TimeSpan(3.0, 10.0)).words
    assert words[0].time.start_s == 3.0
    assert words[0].time.end_s == pytest.approx(3.0 + 7.0 * 2 / 7)
    assert words[1].time.start_s == pytest.approx(words[0].time.end_s)
    assert words[1].time.end_s == pytest.approx(10.0)


def test_poids_des_lettres_ignorent_les_voyelles():
    backend = FakeBackend([("بِسْمِ اللَّهِ", 0.9)])
    words = asr(backend).transcribe(clip(7.0), TimeSpan(0.0, 7.0)).words
    letters = [len(normalize_arabic(w.text)) for w in words]
    shares = [(w.time.end_s - w.time.start_s) / 7.0 for w in words]
    assert shares == pytest.approx([n / sum(letters) for n in letters])


def test_engine_declare_que_les_temps_sont_estimes():
    transcript = asr(FakeBackend([("قُلْ", 0.9)])).transcribe(clip(2.0), TimeSpan(0.0, 2.0))
    assert transcript.engine == "whisper-base-quran@5c3c53fdf927/times-estimated"


def test_confiance_de_sequence_appliquee_a_chaque_mot_et_bornee():
    words = asr(FakeBackend([("أ ب", 1.7)])).transcribe(clip(2.0), TimeSpan(0.0, 2.0)).words
    assert [w.confidence for w in words] == [1.0, 1.0]


def test_texte_vide_donne_un_transcript_vide():
    assert asr(FakeBackend([("   ", 0.9)])).transcribe(clip(2.0), TimeSpan(0, 2)).words == ()


def test_silence_numerique_jamais_envoye():
    backend = FakeBackend([("الم", 0.9)])
    transcript = asr(backend).transcribe(clip(3.0, value=0.0), TimeSpan(0.0, 3.0))
    assert transcript.words == () and backend.calls == []


def test_segment_plus_long_que_la_fenetre_du_modele_est_refuse():
    with pytest.raises(ValueError, match="30"):
        asr(FakeBackend([])).transcribe(clip(40.0), TimeSpan(0.0, 35.0))


def test_segment_hors_du_clip_est_refuse():
    with pytest.raises(ValueError, match="hors"):
        asr(FakeBackend([])).transcribe(clip(2.0), TimeSpan(1.0, 5.0))


def test_batch_en_un_seul_appel_et_ordre_conserve():
    backend = FakeBackend([("أ", 0.9), ("ب", 0.9)])
    result = asr(backend).transcribe_batch(clip(6.0), [TimeSpan(0.0, 1.0), TimeSpan(2.0, 4.0)])
    assert backend.calls == [[RATE, 2 * RATE]]
    assert [t.words[0].text for t in result] == ["أ", "ب"]


def test_riwaya_hafs_et_configuration_sans_chemin_en_dur():
    cfg = WhisperTarteelConfig()
    assert asr(FakeBackend([])).riwaya is Riwaya.HAFS
    assert cfg.max_segment_s == 30.0 and cfg.batch_size >= 1 and cfg.max_new_tokens > 0


PREFIX = "<|startoftranscript|><|ar|><|transcribe|><|notimestamps|>"


def test_jetons_de_controle_en_tete_retires_des_mots():
    # Défaut relevé sur le vrai checkpoint : skip_special_tokens=True ne les retire pas.
    backend = FakeBackend([(PREFIX + "فَصَلِّ لِرَبِّكَ وَانْحَرْ", 0.9)])
    words = asr(backend).transcribe(clip(4.0), TimeSpan(0.0, 4.0)).words
    assert [w.text for w in words] == ["فَصَلِّ", "لِرَبِّكَ", "وَانْحَرْ"]
    assert not any("<|" in w.text or "|>" in w.text for w in words)


def test_jeton_au_milieu_et_a_la_fin_retire_sans_toucher_au_texte():
    backend = FakeBackend([("قُلْ <|endoftext|> هُوَ<|notimestamps|> اللَّهُ <|endoftext|>", 0.9)])
    words = asr(backend).transcribe(clip(4.0), TimeSpan(0.0, 4.0)).words
    assert [w.text for w in words] == ["قُلْ", "هُوَ", "اللَّهُ"]


def test_texte_reduit_aux_seuls_jetons_donne_un_transcript_vide():
    backend = FakeBackend([(PREFIX + "<|endoftext|>", 0.9)])
    assert asr(backend).transcribe(clip(2.0), TimeSpan(0.0, 2.0)).words == ()


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("", ""),
        ("<|ar|>", ""),
        (PREFIX + "قُلْ", "قُلْ"),
        ("أ<|x|>ب", "أب"),  # jeton collé : pas d'espace inventé
        ("أ <|x|> ب", "أ  ب"),
        ("a < | b", "a < | b"),  # pas un jeton : inchangé
        ("<|", "<|"),
        ("قُلْ هُوَ اللَّهُ أَحَدٌ", "قُلْ هُوَ اللَّهُ أَحَدٌ"),  # arabe vocalisé intact
    ],
)
def test_strip_control_tokens_fonction_pure(raw, expected):
    assert strip_control_tokens(raw) == expected
