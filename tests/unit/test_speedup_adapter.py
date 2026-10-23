"""Oreille accélérée (`aqr.adapters.speedup`) : l'audio d'une fenêtre est accéléré, le moteur
principal l'écoute, les temps reviennent à l'échelle de l'audio d'origine."""

from __future__ import annotations

import shutil
import subprocess
from array import array
from collections.abc import Sequence

import pytest

from aqr.adapters.speedup import FfmpegTimeStretcher, SpeedUpASR
from aqr.domain.models import Riwaya, TimeSpan
from aqr.domain.ports import AudioClip, TranscribedWord, Transcript

RATE = 16000


def clip(seconds: float) -> AudioClip:
    return AudioClip(array("f", [0.5] * round(seconds * RATE)), RATE, "mem")


class DecimatingStretcher:
    """Accélère d'un facteur entier en gardant un échantillon sur `factor`."""

    def __init__(self) -> None:
        self.calls: list[tuple[int, float]] = []

    def stretch(self, samples: Sequence[float], sample_rate: int, factor: float) -> Sequence[float]:
        self.calls.append((len(samples), factor))
        return array("f", samples[:: int(factor)])


class RecordingASR:
    riwaya = Riwaya.HAFS
    engine = "inner@test"

    def __init__(self, words_by_call: list[list[tuple[float, float]]]) -> None:
        self.words_by_call = words_by_call
        self.clips: list[AudioClip] = []
        self.spans: list[list[TimeSpan]] = []

    def transcribe_batch(self, clip: AudioClip, spans: Sequence[TimeSpan]) -> list[Transcript]:
        self.clips.append(clip)
        self.spans.append(list(spans))
        out = []
        for offset, span in enumerate(spans):
            relative = self.words_by_call[offset] if offset < len(self.words_by_call) else []
            out.append(
                Transcript(
                    words=tuple(
                        TranscribedWord("w", TimeSpan(span.start_s + a, span.start_s + b), 0.9)
                        for a, b in relative
                    ),
                    engine=self.engine,
                )
            )
        return out


def test_les_fenetres_sont_acceleree_puis_ecoutees_d_un_seul_tenant() -> None:
    inner, stretcher = RecordingASR([[(0.5, 1.0)], [(0.5, 1.0)]]), DecimatingStretcher()
    ear = SpeedUpASR(inner, stretcher, factor=2.0)
    out = ear.transcribe_batch(clip(20.0), [TimeSpan(2.0, 6.0), TimeSpan(8.0, 12.0)])
    assert len(out) == 2
    (heard_clip,) = inner.clips
    assert len(heard_clip.samples) / RATE == pytest.approx(4.0)  # 2 s + 2 s accélérées
    assert inner.spans[0] == [TimeSpan(0.0, 2.0), TimeSpan(2.0, 4.0)]
    assert [call[1] for call in stretcher.calls] == [2.0, 2.0]


def test_les_temps_reviennent_a_l_echelle_de_l_audio_d_origine() -> None:
    inner = RecordingASR([[(0.5, 1.0)], [(0.5, 1.0)]])
    ear = SpeedUpASR(inner, DecimatingStretcher(), factor=2.0)
    first, second = ear.transcribe_batch(clip(20.0), [TimeSpan(2.0, 6.0), TimeSpan(8.0, 12.0)])
    assert first.words[0].time == TimeSpan(3.0, 4.0)  # 2 + 0,5 x 2 ; 2 + 1,0 x 2
    assert second.words[0].time == TimeSpan(9.0, 10.0)
    assert first.words[0].confidence == 0.9 and first.words[0].text == "w"


def test_un_mot_qui_depasse_la_fenetre_est_ramene_dans_la_fenetre() -> None:
    inner = RecordingASR([[(1.5, 2.4)]])  # la fenêtre accélérée dure 2 s
    ear = SpeedUpASR(inner, DecimatingStretcher(), factor=2.0)
    (out,) = ear.transcribe_batch(clip(20.0), [TimeSpan(2.0, 6.0)])
    assert out.words[0].time == TimeSpan(5.0, 6.0)


def test_une_fenetre_trop_courte_donne_une_transcription_vide_sans_perdre_l_ordre() -> None:
    inner = RecordingASR([[(0.1, 0.4)]])
    ear = SpeedUpASR(inner, DecimatingStretcher(), factor=2.0, min_span_s=0.5)
    short, normal = ear.transcribe_batch(clip(20.0), [TimeSpan(1.0, 1.2), TimeSpan(5.0, 9.0)])
    assert short.words == ()
    assert normal.words[0].time == TimeSpan(5.2, 5.8)
    assert inner.spans[0] == [TimeSpan(0.0, 2.0)]  # seule la fenêtre normale est envoyée


def test_aucune_fenetre_exploitable_n_appelle_pas_le_moteur() -> None:
    inner = RecordingASR([])
    ear = SpeedUpASR(inner, DecimatingStretcher(), factor=2.0)
    (out,) = ear.transcribe_batch(clip(5.0), [TimeSpan(1.0, 1.1)])
    assert out.words == () and inner.clips == []


def test_le_facteur_doit_accelerer() -> None:
    for factor in (1.0, 0.8, 0.0):
        with pytest.raises(ValueError):
            SpeedUpASR(RecordingASR([]), DecimatingStretcher(), factor=factor)


def test_l_oreille_se_presente_comme_son_moteur_avec_le_facteur() -> None:
    ear = SpeedUpASR(RecordingASR([]), DecimatingStretcher(), factor=2.5)
    assert ear.riwaya is Riwaya.HAFS
    assert ear.engine == "inner@test+vitesse x2.5"
    assert ear.factor == 2.5


def test_transcribe_unitaire_passe_par_le_meme_chemin() -> None:
    inner = RecordingASR([[(0.5, 1.0)]])
    ear = SpeedUpASR(inner, DecimatingStretcher(), factor=2.0)
    transcript = ear.transcribe(clip(20.0), TimeSpan(2.0, 6.0))
    assert transcript.words[0].time == TimeSpan(3.0, 4.0)


# --- ffmpeg ---------------------------------------------------------------------------------------


def test_le_stretcher_ffmpeg_construit_la_commande_atempo(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, object] = {}

    def fake_run(command, **kwargs):  # type: ignore[no-untyped-def]
        seen["command"], seen["input"] = command, kwargs["input"]
        return subprocess.CompletedProcess(command, 0, array("f", [0.25] * 8).tobytes(), b"")

    monkeypatch.setattr(shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(subprocess, "run", fake_run)
    out = FfmpegTimeStretcher().stretch(array("f", [0.1] * 16), RATE, 2.0)
    assert "atempo=2" in seen["command"]  # type: ignore[operator]
    assert len(seen["input"]) == 16 * 4  # type: ignore[arg-type]
    assert list(out) == [0.25] * 8


def test_le_stretcher_ffmpeg_signale_un_echec(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda command, **kw: subprocess.CompletedProcess(command, 1, b"", b"boom\n"),
    )
    with pytest.raises(RuntimeError, match="boom"):
        FfmpegTimeStretcher().stretch(array("f", [0.1] * 16), RATE, 2.0)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg absent")
def test_le_vrai_ffmpeg_accelere_sans_changer_le_nombre_d_echantillons_a_la_hauteur() -> None:
    import math

    tone = array("f", [0.4 * math.sin(2 * math.pi * 440 * i / RATE) for i in range(RATE * 2)])
    fast = FfmpegTimeStretcher().stretch(tone, RATE, 2.0)
    assert len(fast) / RATE == pytest.approx(1.0, abs=0.1)
    assert max(abs(x) for x in fast) > 0.2  # le signal n'est pas détruit
