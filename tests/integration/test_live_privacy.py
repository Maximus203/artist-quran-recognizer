"""Vie privée du direct (section 12) : aucun audio ne touche le disque pendant ni après un flux."""

from __future__ import annotations

import builtins
import io
import os
from pathlib import Path

import pytest

pytest.importorskip("websockets")

from tests.support.live_service import ServiceHarness, pcm_loud

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"
pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "quran-uthmani.txt").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)

_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC


def _stream(harness: ServiceHarness) -> None:
    from aqr.adapters.ws.client import LiveClient

    client = LiveClient(harness.url).open()
    client.start(harness.token("7"))
    assert client.recv()["type"] == "READY"
    client.stream(pcm_loud(4.0))
    client.end()
    client.recv_until(lambda m: m["type"] == "FINAL")


def _record_writes(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Note tout fichier ouvert en écriture, jusqu'à `monkeypatch.undo()`."""
    opened: list[str] = []
    real_open, real_os_open = builtins.open, os.open

    def spy_open(file, mode="r", *args, **kwargs):  # type: ignore[no-untyped-def]
        if isinstance(mode, str) and any(c in mode for c in "wax+"):
            opened.append(f"open({file!s}, {mode})")
        return real_open(file, mode, *args, **kwargs)

    def spy_os_open(path, flags, *args, **kwargs):  # type: ignore[no-untyped-def]
        if flags & _WRITE_FLAGS:
            opened.append(f"os.open({path!s}, {flags})")
        return real_os_open(path, flags, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", spy_open)
    monkeypatch.setattr(io, "open", spy_open)
    monkeypatch.setattr(os, "open", spy_os_open)
    return opened


def test_the_spy_really_sees_a_file_written(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Garde-fou du test suivant : s'il ne voyait rien, « aucune écriture » ne prouverait rien."""
    opened = _record_writes(monkeypatch)
    (tmp_path / "audio.pcm").write_bytes(bytes([0, 1]))
    with open(tmp_path / "note.txt", "w", encoding="utf-8") as handle:
        handle.write("x")
    monkeypatch.undo()
    assert len(opened) >= 2


def test_a_full_stream_writes_no_file_at_all(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Pendant un flux complet, ni le service ni ses dépendances n'ouvrent un fichier en écriture :
    pas d'audio, pas de copie, pas de cache de session."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    monkeypatch.setenv("TEMP", str(tmp_path))
    monkeypatch.setenv("TMP", str(tmp_path))
    with ServiceHarness() as harness:
        opened = _record_writes(monkeypatch)
        try:
            _stream(harness)
        finally:
            monkeypatch.undo()
    assert opened == [], f"écritures de fichiers pendant le flux : {opened}"
    assert sorted(p.name for p in tmp_path.iterdir()) == [], "fichiers apparus après le flux"
