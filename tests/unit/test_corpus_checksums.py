from __future__ import annotations

import pytest

from aqr.corpus.checksums import CorpusChecksumError, CorpusLock, LockedFile, sha256_of


def _lock(tmp_path, content: bytes) -> tuple[CorpusLock, object]:
    corpus_dir = tmp_path / "corpus"
    corpus_dir.mkdir()
    (corpus_dir / "quran-uthmani.txt").write_bytes(content)
    locked = LockedFile(
        path="quran-uthmani.txt",
        url="https://example.test/quran-uthmani.txt",
        sha256=sha256_of(content),
        quran_type="uthmani",
        purpose="test",
    )
    lock = CorpusLock(
        riwaya="hafs",
        source="test",
        fetched_at="2026-09-25T00:00:00+00:00",
        verse_count=1,
        files={"uthmani": locked},
    )
    return lock, corpus_dir


def test_verify_ok(tmp_path):
    lock, corpus_dir = _lock(tmp_path, b"1|1|test")
    lock.verify(corpus_dir)  # ne lève rien


def test_verify_checksum_invalide(tmp_path):  # F9
    lock, corpus_dir = _lock(tmp_path, b"1|1|test")
    (corpus_dir / "quran-uthmani.txt").write_bytes(b"1|1|corrompu")
    with pytest.raises(CorpusChecksumError):
        lock.verify(corpus_dir)


def test_verify_fichier_manquant(tmp_path):  # F9
    lock, corpus_dir = _lock(tmp_path, b"1|1|test")
    (corpus_dir / "quran-uthmani.txt").unlink()
    with pytest.raises(CorpusChecksumError):
        lock.verify(corpus_dir)


def test_save_et_load_round_trip(tmp_path):
    lock, _corpus_dir = _lock(tmp_path, b"1|1|test")
    lock_path = tmp_path / "LOCK.json"
    lock.save(lock_path)
    reloaded = CorpusLock.load(lock_path)
    assert reloaded == lock
