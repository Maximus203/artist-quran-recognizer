"""EveryAyah : plan de téléchargement, sous-ensemble configurable, empreintes épinglées."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from aqr.data.everyayah import (
    DEFAULT_SUBSET,
    EveryAyahError,
    EveryAyahSubset,
    clip_filename,
    clip_url,
    parse_surahs,
    plan,
    sync,
    verse_clip_path,
)
from aqr.domain.models import VerseRef
from aqr.domain.quran_structure import ayah_count


def test_url_et_nom_de_fichier():
    ref = VerseRef(67, 4)
    assert clip_filename(ref) == "067004.mp3"
    assert clip_url("Alafasy_128kbps", "067004.mp3") == (
        "https://everyayah.com/data/Alafasy_128kbps/067004.mp3"
    )


def test_plan_couvre_tous_les_versets_et_la_basmala_de_chaque_recitant():
    subset = EveryAyahSubset(reciters=("A", "B"), surahs=(112, 114))
    clips = plan(subset)
    names = {(c.reciter, c.filename) for c in clips}
    expected_verses = ayah_count(112) + ayah_count(114)
    assert len(clips) == 2 * (expected_verses + 1)
    assert ("A", "112004.mp3") in names and ("B", "114006.mp3") in names
    assert ("A", "bismillah.mp3") in names


def test_basmala_optionnelle():
    subset = EveryAyahSubset(reciters=("A",), surahs=(112,), include_bismillah=False)
    assert all(c.filename != "bismillah.mp3" for c in plan(subset))


def test_defaut_petit_3_recitants_10_sourates():
    assert len(DEFAULT_SUBSET.reciters) == 3 and len(DEFAULT_SUBSET.surahs) == 10


def test_sourate_invalide_refusee():
    with pytest.raises(ValueError):
        EveryAyahSubset(reciters=("A",), surahs=(115,))
    with pytest.raises(ValueError):
        EveryAyahSubset(reciters=(), surahs=(1,))


def test_parse_surahs():
    assert parse_surahs("1,67,108-110") == (1, 67, 108, 109, 110)
    with pytest.raises(ValueError):
        parse_surahs("1,abc")


class FakeRemote:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.overrides: dict[str, bytes] = {}

    def __call__(self, url: str) -> bytes:
        self.calls.append(url)
        return self.overrides.get(url, f"ID3 contenu de {url}".encode())


SMALL = EveryAyahSubset(reciters=("R1",), surahs=(112,), include_bismillah=True)


def test_sync_telecharge_et_epingle(tmp_path: Path):
    remote = FakeRemote()
    report = sync(tmp_path, SMALL, fetch=remote, pause_s=0)
    assert report.downloaded == ayah_count(112) + 1 and not report.errors
    lock = json.loads((tmp_path / "LOCK.json").read_text(encoding="utf-8"))
    assert len(lock["files"]) == ayah_count(112) + 1
    assert all(len(v["sha256"]) == 64 for v in lock["files"].values())
    assert verse_clip_path(tmp_path, "R1", VerseRef(112, 1)).read_bytes().startswith(b"ID3")


def test_sync_est_idempotent_et_ne_retelecharge_pas(tmp_path: Path):
    remote = FakeRemote()
    sync(tmp_path, SMALL, fetch=remote, pause_s=0)
    remote.calls.clear()
    report = sync(tmp_path, SMALL, fetch=remote, pause_s=0)
    assert remote.calls == [] and report.downloaded == 0 and report.verified > 0


def test_fichier_local_altere_est_une_erreur(tmp_path: Path):
    sync(tmp_path, SMALL, fetch=FakeRemote(), pause_s=0)
    verse_clip_path(tmp_path, "R1", VerseRef(112, 2)).write_bytes(b"ID3 altere")
    report = sync(tmp_path, SMALL, fetch=FakeRemote(), pause_s=0)
    assert any("112002.mp3" in name for name, _ in report.errors)


def test_contenu_distant_modifie_apres_epinglage_est_une_erreur(tmp_path: Path):
    remote = FakeRemote()
    sync(tmp_path, SMALL, fetch=remote, pause_s=0)
    victim = verse_clip_path(tmp_path, "R1", VerseRef(112, 3))
    victim.unlink()
    remote.overrides[clip_url("R1", "112003.mp3")] = b"ID3 le serveur a change"
    report = sync(tmp_path, SMALL, fetch=remote, pause_s=0)
    assert any("112003.mp3" in name and "épinglé" in msg for name, msg in report.errors)
    assert not victim.exists()


def test_page_html_au_lieu_d_un_mp3_est_rejetee(tmp_path: Path):
    remote = FakeRemote()
    remote.overrides[clip_url("R1", "112001.mp3")] = b"<html>404</html>"
    report = sync(tmp_path, SMALL, fetch=remote, pause_s=0)
    assert any("112001.mp3" in name for name, _ in report.errors)
    assert not verse_clip_path(tmp_path, "R1", VerseRef(112, 1)).exists()
    assert report.downloaded == ayah_count(112)  # les autres passent


def test_echec_reseau_sur_un_fichier_n_arrete_pas_les_autres(tmp_path: Path):
    def flaky(url: str) -> bytes:
        if url.endswith("112002.mp3"):
            raise OSError("connexion coupée")
        return b"ID3 ok"

    report = sync(tmp_path, SMALL, fetch=flaky, pause_s=0)
    assert len(report.errors) == 1 and report.downloaded == ayah_count(112)


def test_erreur_typee_pour_un_dossier_invalide(tmp_path: Path):
    blocker = tmp_path / "pas_un_dossier"
    blocker.write_text("x", encoding="utf-8")
    with pytest.raises(EveryAyahError):
        sync(blocker, SMALL, fetch=FakeRemote(), pause_s=0)
