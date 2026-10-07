"""Téléchargement du lot public à révision épinglée : empreintes vérifiées, aucun jeton."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from aqr.data.lot_fetch import LotFetchError, LotItem, PublicLotSource, fetch_public_lot


def _item(name: str, payload: bytes) -> LotItem:
    return LotItem(id=name, sha256=hashlib.sha256(payload).hexdigest())


SOURCE = PublicLotSource(repo="user/lot", revision="a" * 40)


def test_url_epinglee_sur_la_revision_sans_jeton():
    assert (
        SOURCE.url("lot1-01")
        == f"https://huggingface.co/datasets/user/lot/resolve/{'a' * 40}/lot1-01.mp3"
    )


def test_telecharge_verifie_et_ecrit(tmp_path: Path):
    blobs = {"lot1-01": b"un", "lot1-02": b"deux"}
    calls: list[str] = []

    def fetcher(url: str) -> bytes:
        calls.append(url)
        return blobs[url.rsplit("/", 1)[1].removesuffix(".mp3")]

    items = [_item(k, v) for k, v in blobs.items()]
    report = fetch_public_lot(items, SOURCE, tmp_path, fetcher)
    assert (tmp_path / "lot1-01.mp3").read_bytes() == b"un"
    assert [r.status for r in report] == ["telecharge", "telecharge"]
    assert all(r.sha256_ok for r in report)
    assert all(f"/resolve/{'a' * 40}/" in u for u in calls)


def test_idempotent_ne_retelecharge_pas(tmp_path: Path):
    payload = b"contenu"
    item = _item("lot1-01", payload)
    fetch_public_lot([item], SOURCE, tmp_path, lambda url: payload)

    def interdit(url: str) -> bytes:
        raise AssertionError("ne doit pas retélécharger")

    report = fetch_public_lot([item], SOURCE, tmp_path, interdit)
    assert report[0].status == "deja_present"


def test_empreinte_differente_refusee_et_rien_n_est_installe(tmp_path: Path):
    item = _item("lot1-01", b"attendu")
    with pytest.raises(LotFetchError, match="lot1-01"):
        fetch_public_lot([item], SOURCE, tmp_path, lambda url: b"autre contenu")
    assert not (tmp_path / "lot1-01.mp3").exists()
    assert list(tmp_path.glob("*.part")) == []


def test_fichier_local_altere_est_une_erreur_pas_une_substitution(tmp_path: Path):
    item = _item("lot1-01", b"attendu")
    (tmp_path / "lot1-01.mp3").write_bytes(b"altere")
    with pytest.raises(LotFetchError, match="altéré"):
        fetch_public_lot([item], SOURCE, tmp_path, lambda url: b"attendu")
    assert (tmp_path / "lot1-01.mp3").read_bytes() == b"altere"  # jamais écrasé en silence


def test_echec_reseau_sur_un_fichier_n_arrete_pas_les_autres_mais_remonte(tmp_path: Path):
    good, bad = b"bon", b"mauvais"

    def fetcher(url: str) -> bytes:
        if "lot1-02" in url:
            raise OSError("coupure")
        return good

    items = [_item("lot1-01", good), _item("lot1-02", bad)]
    with pytest.raises(LotFetchError, match="lot1-02") as err:
        fetch_public_lot(items, SOURCE, tmp_path, fetcher)
    assert (tmp_path / "lot1-01.mp3").exists()
    assert "lot1-01" not in str(err.value)


def test_head_distant_different_est_signale_sans_changer_la_revision(tmp_path: Path):
    item = _item("lot1-01", b"x")
    report = fetch_public_lot(
        [item], SOURCE, tmp_path, lambda url: b"x", head_revision=lambda repo: "b" * 40
    )
    assert report[0].sha256_ok
    assert report[0].remote_head_moved is True
