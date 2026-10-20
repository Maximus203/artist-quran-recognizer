"""`build_finetune_manifest.py score|filter` : contrôle des étiquettes, sans vrai modèle."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pytest
from scripts import build_finetune_manifest as script
from scripts.build_finetune_manifest import ROOT, main

from aqr.data.finetune_sources import TADABUR
from aqr.data.label_qc import LabelScore, QcFlag
from aqr.domain.models import TimeSpan
from aqr.domain.ports import AudioClip, CtcLattice

CORPUS = ROOT / "data" / "corpus"


def _line(name: str, ref: str = "112:2", text: str = "اللَّهُ الصَّمَدُ") -> str:
    entry = {
        "audio_filepath": f"../../audio/tadabur/tadabur-7/{name}",
        "duration": 2.0,
        "text": text,
        "aqr_source": TADABUR,
        "aqr_speaker": "tadabur-7",
        "aqr_ref": ref,
    }
    return json.dumps(entry, ensure_ascii=False)


def _score(name: str, llr: float | None, error: QcFlag | None = None) -> LabelScore:
    return LabelScore(
        key=f"../../audio/tadabur/tadabur-7/{name}",
        split="train",
        ref="112:2",
        speaker="tadabur-7",
        duration=2.0,
        text="اللَّهُ الصَّمَدُ",
        llr_per_frame=llr,
        variant=None if llr is None else "simple",
        frames=25,
        basmala_in_text=None,
        basmala_alt_llr=None,
        error=error,
    )


def _scored_dir(tmp_path: Path, scores: list[LabelScore], names: list[str]) -> Path:
    manifests = tmp_path / "ft" / "manifests" / TADABUR
    (manifests / "qc").mkdir(parents=True)
    (manifests / "train.jsonl").write_text("".join(_line(n) + "\n" for n in names), "utf-8")
    (manifests / "qc" / "scores.jsonl").write_text(
        "".join(json.dumps(s.to_json(), ensure_ascii=False) + "\n" for s in scores), "utf-8"
    )
    (manifests / "qc" / "scores.json").write_text('{"model": "fastconformer-quran"}', "utf-8")
    return manifests


def test_filtre_manifeste_rapport_et_liste_d_ecoute(tmp_path: Path) -> None:
    names = ["ok.wav", "faux.wav", "long.wav"]
    scores = [_score("ok.wav", -0.1), _score("faux.wav", -2.5), _score("long.wav", None)]
    scores[2] = _score("long.wav", None, QcFlag.NOT_ALIGNED)
    manifests = _scored_dir(tmp_path, scores, names)
    argv = ["--data-dir", str(tmp_path / "ft"), "filter", "--source", TADABUR]

    assert main([*argv, "--min-llr", "-0.5"]) == 0

    kept = (manifests / "train.qc.jsonl").read_text("utf-8").splitlines()
    assert kept == [_line("ok.wav")]  # ligne d'origine, inchangée
    report = json.loads((manifests / "qc" / "report.json").read_text("utf-8"))
    assert report["threshold"]["min_llr_per_frame"] == -0.5
    assert report["kept"]["by_split"] == {"train": 1}
    assert report["rejected"] == {
        "preuve_faible": {"count": 1, "hours": 0.0006},
        "texte_non_aligne": {"count": 1, "hours": 0.0006},
    }
    assert report["scoring"] == {"model": "fastconformer-quran"}
    playlist = (manifests / "qc" / "rejected.m3u").read_text("utf-8").splitlines()
    assert playlist[0] == "#EXTM3U"
    assert playlist[1].startswith("#EXTINF:2,texte_non_aligne - 112:2")
    assert Path(playlist[2]).is_absolute() and playlist[2].endswith("long.wav")
    assert playlist[4].endswith("faux.wav")

    # Relancer avec un autre seuil (calibrage) ne recalcule rien et récrit le manifeste filtré.
    assert main([*argv, "--min-llr", "-3"]) == 0
    assert len((manifests / "train.qc.jsonl").read_text("utf-8").splitlines()) == 2


def test_filtre_refuse_une_ligne_sans_score(tmp_path: Path) -> None:
    _scored_dir(tmp_path, [_score("ok.wav", -0.1)], ["ok.wav", "nouveau.wav"])
    with pytest.raises(SystemExit, match="sans score"):
        main(["--data-dir", str(tmp_path / "ft"), "filter", "--min-llr", "-0.5"])


def test_controle_reserve_a_la_recitation(tmp_path: Path) -> None:
    with pytest.raises(SystemExit, match="récitation"):
        main(["--data-dir", str(tmp_path), "filter", "--source", "fleurs-ar", "--min-llr", "-1"])


class FakeModel:
    """Treillis uniforme : tout texte qui tient dans les trames est également (peu) soutenu."""

    engine = "fake"
    unknown_symbol = 0

    def __init__(self) -> None:
        self.symbols: dict[str, int] = {}
        self.clips: list[float] = []

    def encode(self, text: str) -> tuple[int, ...]:
        return tuple(self.symbols.setdefault(c, len(self.symbols) % 40 + 1) for c in text)

    def lattice(self, clip: AudioClip, span: TimeSpan) -> CtcLattice:
        self.clips.append(span.duration_s)
        rows = [[math.log(1 / 41)] * 41 for _ in range(round(span.duration_s / 0.08))]
        return CtcLattice(log_probs=rows, blank=0, start_s=span.start_s, frame_s=0.08)


@pytest.mark.skipif(not (CORPUS / "quran-simple.txt").exists(), reason="corpus non téléchargé")
def test_score_note_chaque_ligne_une_seule_fois(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    np = pytest.importorskip("numpy")
    sf = pytest.importorskip("soundfile")
    data_dir = tmp_path / "ft"
    manifests = data_dir / "manifests" / TADABUR
    manifests.mkdir(parents=True)
    wav = data_dir / "audio" / TADABUR / "tadabur-7" / "a.wav"
    wav.parent.mkdir(parents=True)
    sf.write(str(wav), np.full(16000 * 4, 0.1, "float32"), 16000, subtype="PCM_16")
    samad = next(
        line.split("|")[2]
        for line in (CORPUS / "quran-simple.txt").read_text("utf-8").splitlines()
        if line.startswith("112|2|")
    )
    (manifests / "train.jsonl").write_text(
        _line("a.wav", text=samad) + "\n" + _line("b.wav", ref="112:1", text="قُلْ") + "\n",
        "utf-8",
    )
    fake = FakeModel()
    calls: list[Any] = []

    def model(args: Any) -> FakeModel:
        calls.append(args)
        return fake

    monkeypatch.setattr(script, "acoustic_model", model)
    argv = ["--data-dir", str(data_dir), "score", "--source", TADABUR, "--corpus", str(CORPUS)]
    assert main(argv) == 0

    scores = script.load_scores(manifests / "qc" / "scores.jsonl")
    good = scores["../../audio/tadabur/tadabur-7/a.wav"]
    assert good.error is None and good.llr_per_frame == pytest.approx(0.0, abs=1e-9)
    assert fake.clips == [pytest.approx(4.0)]  # tout le WAV, lu depuis le manifeste
    # « قُلْ » seul n'est pas le texte du verset 112:1 : écarté sans calculer de treillis.
    assert scores["../../audio/tadabur/tadabur-7/b.wav"].error is QcFlag.TEXT_MISMATCH
    meta = json.loads((manifests / "qc" / "scores.json").read_text("utf-8"))
    assert meta["model"] == "fastconformer-quran" and len(meta["revision"]) == 40

    # Reprise : rien à renoter, le modèle n'est même pas chargé.
    assert main(argv) == 0
    assert len(calls) == 1
    assert len((manifests / "qc" / "scores.jsonl").read_text("utf-8").splitlines()) == 2

    # Manifeste reconstruit (même audio, texte changé) : la ligne est renotée, le dernier score
    # fait foi.
    (manifests / "train.jsonl").write_text(
        _line("a.wav", text=samad) + "\n" + _line("b.wav", ref="112:1", text="قُلْ هُوَ") + "\n",
        "utf-8",
    )
    assert main(argv) == 0
    rescored = script.load_scores(manifests / "qc" / "scores.jsonl")
    assert rescored["../../audio/tadabur/tadabur-7/b.wav"].text == "قُلْ هُوَ"
    assert len(rescored) == 2
