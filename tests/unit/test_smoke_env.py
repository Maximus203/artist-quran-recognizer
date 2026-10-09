"""Ressources des smokes e2e : `find_missing` dit précisément ce qui manque (avec la raison),
`unavailable` en fait un échec en mode strict et un skip net sinon."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from tests.support import smoke_env
from tests.support.smoke_env import ROOT, find_missing, strict, unavailable


def _models_lock(path: Path, sizes: dict[str, dict[str, int]]) -> None:
    models = {
        key: {
            "repo_id": "x/y",
            "revision": "r",
            "license": "mit",
            "files": {name: {"sha256": "0" * 64, "size": size} for name, size in files.items()},
        }
        for key, files in sizes.items()
    }
    path.write_text(json.dumps({"schema": 1, "models": models}), encoding="utf-8")


class Setup:
    """Une installation complète et valide, dans un dossier temporaire."""

    def __init__(self, root: Path) -> None:
        self.audio = root / "audio"
        clips = self.audio / "everyayah" / "Alafasy_128kbps"
        clips.mkdir(parents=True)
        for ayah in range(1, 5):
            (clips / f"112{ayah:03d}.mp3").write_bytes(b"mp3")
        self.models = root / "models"
        for key, name in (("whisper-base-quran", "w.bin"), ("recitation-segmenter", "s.bin")):
            (self.models / key).mkdir(parents=True)
            (self.models / key / name).write_bytes(b"12345")
        self.lock = root / "models-LOCK.json"
        _models_lock(
            self.lock,
            {"whisper-base-quran": {"w.bin": 5}, "recitation-segmenter": {"s.bin": 5}},
        )
        self.corpus = root / "corpus"
        self.corpus.mkdir()
        text = b"1|1|x\n"
        (self.corpus / "u.txt").write_bytes(text)
        (self.corpus / "LOCK.json").write_text(
            json.dumps(
                {
                    "riwaya": "hafs",
                    "source": "tanzil.net",
                    "fetched_at": "t",
                    "verse_count": 1,
                    "files": {
                        "uthmani": {
                            "path": "u.txt",
                            "url": "u",
                            "sha256": hashlib.sha256(text).hexdigest(),
                            "quran_type": "uthmani",
                            "purpose": "test",
                        }
                    },
                }
            ),
            encoding="utf-8",
        )
        self.env = {
            "AQR_AUDIO_DIR": str(self.audio),
            "AQR_MODELS_DIR": str(self.models),
            "AQR_CORPUS_DIR": str(self.corpus),
        }

    def missing(self, env: dict[str, str] | None = None, ffmpeg: bool = True) -> dict[str, str]:
        found = find_missing(
            self.env if env is None else env,
            which=lambda name: "/usr/bin/ffmpeg" if ffmpeg else None,
            models_lock=self.lock,
        )
        return {m.resource: m.reason for m in found}


@pytest.fixture()
def setup(tmp_path: Path) -> Setup:
    return Setup(tmp_path)


def test_a_complete_installation_misses_nothing(setup: Setup) -> None:
    assert setup.missing() == {}


def test_unset_audio_dir_and_missing_clips_are_named(setup: Setup) -> None:
    assert "AQR_AUDIO_DIR absent" in setup.missing({})["audio"]
    (setup.audio / "everyayah" / "Alafasy_128kbps" / "112003.mp3").unlink()
    assert "clip EveryAyah absent" in setup.missing()["audio"]
    assert "112003.mp3" in setup.missing()["audio"]
    assert "n'existe pas" in setup.missing({**setup.env, "AQR_AUDIO_DIR": "/nonexistent"})["audio"]


def test_missing_ffmpeg_is_named(setup: Setup) -> None:
    assert setup.missing(ffmpeg=False) == {"ffmpeg": "ffmpeg absent du PATH"}


def test_models_dir_unset_missing_file_and_wrong_size(setup: Setup) -> None:
    assert "AQR_MODELS_DIR absent" in setup.missing({"AQR_AUDIO_DIR": str(setup.audio)})["models"]
    (setup.models / "recitation-segmenter" / "s.bin").write_bytes(b"123")  # tronqué
    assert "recitation-segmenter/s.bin" in setup.missing()["models"]
    assert "taille" in setup.missing()["models"]
    (setup.models / "recitation-segmenter" / "s.bin").unlink()
    assert "recitation-segmenter/s.bin" in setup.missing()["models"]


def test_a_model_absent_from_the_lock_is_named(setup: Setup) -> None:
    _models_lock(setup.lock, {"whisper-base-quran": {"w.bin": 5}})
    assert "recitation-segmenter" in setup.missing()["models"]


def test_the_corpus_is_verified_against_its_lock_not_just_present(setup: Setup) -> None:
    (setup.corpus / "u.txt").write_bytes(b"corrompu")
    assert "checksum invalide" in setup.missing()["corpus"]
    (setup.corpus / "u.txt").unlink()
    assert "manquant" in setup.missing()["corpus"]
    (setup.corpus / "LOCK.json").unlink()
    assert "LOCK.json introuvable" in setup.missing()["corpus"]


def test_everything_missing_is_reported_at_once(tmp_path: Path) -> None:
    found = find_missing(
        {"AQR_CORPUS_DIR": str(tmp_path / "no-corpus")},
        which=lambda _name: None,
        models_lock=tmp_path / "none.json",
    )
    assert {m.resource for m in found} == {"audio", "ffmpeg", "models", "corpus"}


def test_needs_restricts_the_checks(setup: Setup) -> None:
    only = find_missing({}, needs=("ffmpeg",), which=lambda _name: None)
    assert [m.resource for m in only] == ["ffmpeg"]


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("1", True),
        ("true", True),
        ("YES", True),
        ("", True),  # vide = non défini = strict
        ("0", False),
        (" 0 ", False),
        ("false", False),
        ("No", False),
        ("off", False),
    ],
)
def test_strict_flag(value: str, expected: bool) -> None:
    assert strict({"AQR_SMOKE_STRICT": value}) is expected


def test_strict_is_the_default() -> None:
    assert strict({}) is True


def test_unavailable_fails_by_default_and_skips_only_on_explicit_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    missing = [smoke_env.Missing("audio", "AQR_AUDIO_DIR absent")]
    monkeypatch.delenv("AQR_SMOKE_STRICT", raising=False)
    with pytest.raises(pytest.fail.Exception, match=r"AQR_SMOKE_STRICT=0.*audio.*AQR_AUDIO_DIR"):
        unavailable(missing)
    monkeypatch.setenv("AQR_SMOKE_STRICT", "0")
    with pytest.raises(pytest.skip.Exception, match=r"audio.*AQR_AUDIO_DIR absent"):
        unavailable(missing)


def test_the_command_line_prints_json_for_the_browser_smoke(
    setup: Setup, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    for key, value in setup.env.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(smoke_env.shutil, "which", lambda _name: None)
    assert smoke_env.main(["--needs", "ffmpeg,audio"]) == 0
    printed = json.loads(capsys.readouterr().out)
    assert [item["resource"] for item in printed] == ["ffmpeg"]


def test_the_required_models_follow_the_chosen_asr(setup: Setup) -> None:
    (setup.models / "fastconformer-quran").mkdir()
    (setup.models / "fastconformer-quran" / "f.nemo").write_bytes(b"12345")
    _models_lock(
        setup.lock,
        {"fastconformer-quran": {"f.nemo": 5}, "recitation-segmenter": {"s.bin": 5}},
    )
    found = find_missing(setup.env, ("models",), models_lock=setup.lock, asr="fastconformer")
    assert found == []
    whisper = find_missing(setup.env, ("models",), models_lock=setup.lock, asr="whisper")
    assert "whisper-base-quran" in whisper[0].reason
    with pytest.raises(ValueError, match="asr inconnu"):
        find_missing(setup.env, ("models",), asr="vosk")


def test_the_command_line_needs_no_pytest(tmp_path: Path) -> None:
    # AQR_PYTHON est l'interpréteur du moteur (ex. venv FastConformer), pas forcément celui de dev.
    code = (
        "import sys; sys.modules['pytest'] = None; "
        "from tests.support import smoke_env, corpus_check; print('ok')"
    )
    done = subprocess.run(
        [sys.executable, "-c", code],
        cwd=ROOT,
        env={**os.environ, "PYTHONPATH": str(ROOT / "src")},
        capture_output=True,
        text=True,
        check=False,
    )
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() == "ok"
