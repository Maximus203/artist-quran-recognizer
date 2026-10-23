"""Verrou de fichier et pic mémoire portables (Linux, macOS, Windows)."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from aqr.eval.portable import LockBusy, lock_exclusive_nonblocking, peak_rss_mb


def _open(path: Path) -> int:
    return os.open(path, os.O_RDWR | os.O_CREAT, 0o666)


def test_un_second_descripteur_ne_prend_pas_le_verrou_tenu(tmp_path: Path) -> None:
    lock = tmp_path / ".lock"
    first, second = _open(lock), _open(lock)
    try:
        lock_exclusive_nonblocking(first)
        with pytest.raises(LockBusy):
            lock_exclusive_nonblocking(second)
    finally:
        os.close(second)
        os.close(first)


def test_le_verrou_est_libere_a_la_fermeture(tmp_path: Path) -> None:
    lock = tmp_path / ".lock"
    first = _open(lock)
    lock_exclusive_nonblocking(first)
    os.close(first)
    again = _open(lock)
    try:
        lock_exclusive_nonblocking(again)  # ne lève pas
    finally:
        os.close(again)


def test_le_pic_memoire_est_un_entier_positif() -> None:
    peak = peak_rss_mb()
    assert isinstance(peak, int)
    assert peak > 0  # un interpréteur Python occupe plusieurs Mio
