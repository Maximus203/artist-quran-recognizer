from __future__ import annotations

import pytest

from aqr.corpus.fetch import SOURCES, build_lock, count_verses, source_url


def test_count_verses_ignore_commentaires_et_lignes_vides():
    raw = "# comment\n1|1|a\n1|2|b\n\n# trailer\n"
    assert count_verses(raw) == 2


def test_source_url_contient_le_bon_type():
    assert "quranType=uthmani" in source_url("uthmani")
    assert "quranType=simple-clean" in source_url("simple_clean")


def test_build_lock_epingle_checksums_et_compte_les_versets():
    raw_by_key = {
        "uthmani": b"1|1|a\n1|2|b\n",
        "simple_clean": b"1|1|aa\n1|2|bb\n",
    }
    lock = build_lock(raw_by_key, fetched_at="2026-09-25T00:00:00+00:00")
    assert lock.riwaya == "hafs"
    assert lock.verse_count == 2
    assert lock.files.keys() == SOURCES.keys()
    assert len(lock.files["uthmani"].sha256) == 64
    assert lock.files["uthmani"].sha256 != lock.files["simple_clean"].sha256


def test_build_lock_sources_incompletes_leve_erreur():
    with pytest.raises(ValueError, match="sources"):
        build_lock({"uthmani": b"1|1|a"})


# --- fetch_and_lock : le lock épinglé fait foi -----------------------------------------------
from aqr.corpus.checksums import CorpusChecksumError  # noqa: E402
from aqr.corpus.fetch import fetch_and_lock  # noqa: E402

REMOTE = {
    "uthmani": b"1|1|a\n1|2|b\n",
    "simple_clean": b"1|1|aa\n1|2|bb\n",
}


def _fetcher(remote: dict[str, bytes]):
    from aqr.corpus.fetch import source_url

    by_url = {source_url(key): data for key, data in remote.items()}
    return lambda url: by_url[url]


def test_premier_telechargement_epingle(tmp_path):
    lock = fetch_and_lock(tmp_path, fetch=_fetcher(REMOTE))
    assert (tmp_path / "LOCK.json").exists() and lock.verse_count == 2


def test_relance_identique_ne_reecrit_pas_le_lock(tmp_path):
    fetch_and_lock(tmp_path, fetch=_fetcher(REMOTE))
    before = (tmp_path / "LOCK.json").read_bytes()
    again = fetch_and_lock(tmp_path, fetch=_fetcher(REMOTE))
    assert (tmp_path / "LOCK.json").read_bytes() == before
    assert again.fetched_at  # le lock retourné est celui, inchangé, déjà épinglé


def test_contenu_distant_modifie_est_refuse_sans_toucher_au_lock_ni_aux_fichiers(tmp_path):
    fetch_and_lock(tmp_path, fetch=_fetcher(REMOTE))
    lock_before = (tmp_path / "LOCK.json").read_bytes()
    file_before = (tmp_path / "quran-uthmani.txt").read_bytes()
    changed = {**REMOTE, "uthmani": b"1|1|CHANGE\n1|2|b\n"}
    with pytest.raises(CorpusChecksumError, match="épinglé"):
        fetch_and_lock(tmp_path, fetch=_fetcher(changed))
    assert (tmp_path / "LOCK.json").read_bytes() == lock_before
    assert (tmp_path / "quran-uthmani.txt").read_bytes() == file_before


def test_repin_explicite_accepte_le_nouveau_contenu(tmp_path):
    fetch_and_lock(tmp_path, fetch=_fetcher(REMOTE))
    changed = {**REMOTE, "uthmani": b"1|1|CHANGE\n1|2|b\n"}
    lock = fetch_and_lock(tmp_path, fetch=_fetcher(changed), repin=True)
    assert (tmp_path / "quran-uthmani.txt").read_bytes() == changed["uthmani"]
    assert (
        lock.files["uthmani"].sha256
        != fetch_and_lock(tmp_path / "autre", fetch=_fetcher(REMOTE)).files["uthmani"].sha256
    )


def test_fichier_local_manquant_est_retelecharge_et_verifie(tmp_path):
    fetch_and_lock(tmp_path, fetch=_fetcher(REMOTE))
    (tmp_path / "quran-simple-clean.txt").unlink()
    fetch_and_lock(tmp_path, fetch=_fetcher(REMOTE))
    assert (tmp_path / "quran-simple-clean.txt").read_bytes() == REMOTE["simple_clean"]
