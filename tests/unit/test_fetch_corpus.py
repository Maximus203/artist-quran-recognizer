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
