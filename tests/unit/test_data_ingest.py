"""aqr data ingest : fiche validée, sha256, rangement par catégorie, WAV dérivé, idempotent."""

from __future__ import annotations

import hashlib
import math
import shutil
import struct
import wave
from pathlib import Path

import pytest
import yaml

from aqr.data.config import DataConfig
from aqr.data.ingest import ffmpeg_converter, ingest
from aqr.data.manifest import Manifest

CFG = DataConfig()


def write_wav(path: Path, seconds: float, rate: int = 16000, freq: float = 220.0) -> None:
    frames = int(seconds * rate)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(
            b"".join(
                struct.pack("<h", int(8000 * math.sin(2 * math.pi * freq * i / rate)))
                for i in range(frames)
            )
        )


def fake_convert(src: Path, dest: Path, sample_rate: int) -> None:
    """Convertisseur factice : produit un WAV 16 kHz de 2 s quel que soit l'entrée."""
    write_wav(dest, 2.0, sample_rate)


def drop(inbox: Path, name: str, content: bytes, **fiche: object) -> Path:
    inbox.mkdir(parents=True, exist_ok=True)
    audio = inbox / name
    audio.write_bytes(content)
    data: dict[str, object] = {
        "fichier": name,
        "categorie": ["C09"],
        "recitant": "assise_a",
        "riwaya": "inconnu",
        "langues": ["fr", "ar"],
        "droits": "usage interne test",
    }
    data.update(fiche)
    audio.with_suffix(".yaml").write_text(
        yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8"
    )
    return audio


@pytest.fixture()
def env(tmp_path: Path):
    audio_dir = tmp_path / "aqr-audio"
    return audio_dir, audio_dir / "inbox", tmp_path / "manifest.yaml"


def run(env, **kw):
    audio_dir, _inbox, manifest = env
    return ingest(audio_dir / "inbox", audio_dir, manifest, config=CFG, convert=fake_convert, **kw)


def test_ingest_cree_le_cas_range_le_fichier_et_derive_le_wav(env):
    audio_dir, inbox, manifest_path = env
    content = b"faux mp3 octets"
    drop(inbox, "cours-1.mp3", content)

    report = run(env)

    assert report.added == ["cours-1"] and not report.errors
    case = Manifest.load(manifest_path).get("cours-1")
    assert case.sha256 == hashlib.sha256(content).hexdigest()
    assert case.statut == "a_annoter" and case.split is None
    assert case.categorie == ("C09",) and case.recitant == "assise_a"
    assert case.file == "C09/cours-1.mp3"
    assert case.duree_s == pytest.approx(2.0)
    assert (audio_dir / "C09" / "cours-1.mp3").read_bytes() == content
    assert (audio_dir / "_derived" / "cours-1.wav").exists()
    assert not (inbox / "cours-1.mp3").exists()


def test_ingest_est_idempotent(env):
    _audio_dir, inbox, manifest_path = env
    drop(inbox, "a.mp3", b"aaa")
    run(env)
    before = manifest_path.read_text(encoding="utf-8")
    again = run(env)
    assert again.added == []
    assert manifest_path.read_text(encoding="utf-8") == before


def test_meme_contenu_redepose_n_est_pas_duplique(env):
    _audio_dir, inbox, manifest_path = env
    drop(inbox, "a.mp3", b"meme contenu")
    run(env)
    drop(inbox, "copie.mp3", b"meme contenu")
    report = run(env)
    assert report.added == [] and [name for name, _ in report.duplicates] == ["copie.mp3"]
    assert len(Manifest.load(manifest_path).cases) == 1


def test_fiche_invalide_rapportee_sans_toucher_au_fichier(env):
    _audio_dir, inbox, manifest_path = env
    audio = drop(inbox, "mauvais.mp3", b"x", categorie=["C99"])
    report = run(env)
    assert report.added == []
    assert report.errors and "C99" in " ".join(report.errors[0][1])
    assert audio.exists()
    assert not manifest_path.exists() or Manifest.load(manifest_path).cases == []


def test_fiche_absente_rapportee(env):
    _audio_dir, inbox, _m = env
    inbox.mkdir(parents=True)
    (inbox / "orphelin.mp3").write_bytes(b"x")
    report = run(env)
    assert report.errors and "fiche" in report.errors[0][1][0]


def test_nom_dans_la_fiche_different_du_fichier(env):
    _audio_dir, inbox, _m = env
    drop(inbox, "a.mp3", b"x", fichier="b.mp3")
    assert run(env).errors


def test_un_fichier_en_erreur_n_empeche_pas_les_autres(env):
    _audio_dir, inbox, manifest_path = env
    drop(inbox, "ok.mp3", b"ok")
    drop(inbox, "ko.mp3", b"ko", riwaya="???")
    report = run(env)
    assert report.added == ["ok"] and len(report.errors) == 1
    assert [c.id for c in Manifest.load(manifest_path).cases] == ["ok"]


def test_collision_d_identifiant_avec_un_autre_contenu_est_une_erreur(env):
    _audio_dir, inbox, _m = env
    drop(inbox, "a.mp3", b"un")
    run(env)
    drop(inbox, "a.mp3", b"deux")
    report = run(env)
    assert report.added == [] and report.errors


def test_wav_derive_manquant_est_regenere(env):
    audio_dir, inbox, _m = env
    drop(inbox, "a.mp3", b"un")
    run(env)
    (audio_dir / "_derived" / "a.wav").unlink()
    drop(inbox, "a.mp3", b"un")
    run(env)
    assert (audio_dir / "_derived" / "a.wav").exists()


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg requis")
def test_ffmpeg_reel_produit_un_wav_16k_mono(tmp_path: Path):
    src = tmp_path / "in.wav"
    write_wav(src, 1.5, rate=44100, freq=440.0)
    dest = tmp_path / "out.wav"
    ffmpeg_converter(src, dest, 16000)
    with wave.open(str(dest), "rb") as w:
        assert (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (16000, 1, 2)
        assert w.getnframes() / w.getframerate() == pytest.approx(1.5, abs=0.05)
