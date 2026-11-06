"""`aqr free-speech` : lit un résultat, écrit `aqr.free-speech/1`, ne touche pas au résultat."""

from __future__ import annotations

import io
import json
from array import array
from pathlib import Path

from aqr.cli import main
from aqr.domain.ports import AudioClip
from aqr.freespeech.command import FreeSpeechEngine, FreeSpeechOptions, FreeSpeechUnavailable
from aqr.freespeech.config import FreeSpeechConfig
from aqr.freespeech.guard import CorpusGuard
from aqr.freespeech.ports import FrenchText, SpeechTranscript
from aqr.freespeech.sidecar import validate_document

FREE = "اليوم نتحدث عن اهمية الصبر في حياتنا اليومية"


class Asr:
    def transcribe(self, clip, span):  # type: ignore[no-untyped-def]
        return SpeechTranscript(FREE, "ar", 0.97, 0.9, "fake-asr")


class Mt:
    def translate(self, arabic: str) -> FrenchText:
        return FrenchText("Aujourd'hui nous parlons de l'importance de la patience.", "fake-mt")


def engine(_options: FreeSpeechOptions, _env: object) -> FreeSpeechEngine:
    return FreeSpeechEngine(
        Asr(),
        Mt(),
        CorpusGuard([("هذا", "كتاب", "لا", "ريب")], FreeSpeechConfig()),
        lambda _path: AudioClip(array("f", [0.1] * 16000 * 20), 16000, "fake"),
        "fake-asr",
        "fake-mt",
    )


def unavailable(_options: FreeSpeechOptions, _env: object) -> FreeSpeechEngine:
    raise FreeSpeechUnavailable("modèle de traduction absent")


def write_inputs(tmp_path: Path, intervals: list[dict[str, object]]) -> tuple[Path, Path]:
    recognition = tmp_path / "rec.recognition.json"
    recognition.write_text(
        json.dumps({"schema": "aqr.recognition/1", "intervals": intervals}), encoding="utf-8"
    )
    audio = tmp_path / "rec.wav"
    audio.write_bytes(b"x")
    return recognition, audio


def run(tmp_path: Path, intervals, factory=engine, extra=()):  # type: ignore[no-untyped-def]
    recognition, audio = write_inputs(tmp_path, intervals)
    out, err = io.StringIO(), io.StringIO()
    code = main(
        ["free-speech", str(recognition), str(audio), "--out-dir", str(tmp_path / "o"), *extra],
        env={},
        out=out,
        err=err,
        free_speech_factory=factory,
    )
    return code, out.getvalue(), err.getvalue(), recognition


SPEECH = {"kind": "non_quran", "label": "arabic_speech", "t": [1.0, 9.0]}


def test_ecrit_le_fichier_et_laisse_le_resultat_intact(tmp_path: Path) -> None:
    code, out, _err, recognition = run(tmp_path, [SPEECH])
    before = recognition.read_text(encoding="utf-8")
    assert code == 0 and "1 traduit(s)" in out
    document = json.loads((tmp_path / "o" / "rec.free-speech.json").read_text(encoding="utf-8"))
    validate_document(document)
    assert document["items"][0]["status"] == "translated"
    assert document["items"][0]["review"] == "pending"
    assert recognition.read_text(encoding="utf-8") == before


def test_rien_d_eligible_ne_charge_aucun_modele(tmp_path: Path) -> None:
    code, out, _err, _ = run(
        tmp_path, [{"kind": "non_quran", "label": "french", "t": [0, 5]}], factory=unavailable
    )
    assert code == 0 and "rien à faire" in out


def test_modele_absent_dit_clairement_et_sort_en_2(tmp_path: Path) -> None:
    code, _out, err, _ = run(tmp_path, [SPEECH], factory=unavailable)
    assert code == 2 and "modèle de traduction absent" in err


def test_ne_remplace_pas_sans_force(tmp_path: Path) -> None:
    assert run(tmp_path, [SPEECH])[0] == 0
    recognition = tmp_path / "rec.recognition.json"
    out, err = io.StringIO(), io.StringIO()
    code = main(
        [
            "free-speech",
            str(recognition),
            str(tmp_path / "rec.wav"),
            "--out-dir",
            str(tmp_path / "o"),
        ],
        env={},
        out=out,
        err=err,
        free_speech_factory=engine,
    )
    assert code == 1 and "--force" in err.getvalue()


def test_fichier_introuvable(tmp_path: Path) -> None:
    out, err = io.StringIO(), io.StringIO()
    code = main(
        ["free-speech", str(tmp_path / "absent.json"), str(tmp_path / "a.wav")],
        env={},
        out=out,
        err=err,
        free_speech_factory=engine,
    )
    assert code == 1 and "introuvable" in err.getvalue()


def test_le_choix_du_traducteur_est_transmis(tmp_path: Path) -> None:
    seen: list[str] = []

    def spy(options: FreeSpeechOptions, env: object) -> FreeSpeechEngine:
        seen.append(options.translator)
        return engine(options, env)

    run(tmp_path, [SPEECH], factory=spy, extra=("--translator", "nllb"))
    run(tmp_path, [SPEECH], factory=spy, extra=("--force",))
    assert seen == ["nllb", "marian"]
