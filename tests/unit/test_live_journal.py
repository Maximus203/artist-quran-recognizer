"""Journal du service du direct : jamais d'audio, de jeton ni de texte coranique (ADR-0011 §6)."""

from __future__ import annotations

import logging

import pytest

from aqr.live.journal import LiveJournal, pseudonym


@pytest.fixture()
def records(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.DEBUG, logger="aqr.live")
    return caplog


def test_an_event_is_one_readable_line_of_key_values(records: pytest.LogCaptureFixture) -> None:
    LiveJournal().info("session.open", session="abc", blocks=3, ratio=0.5, ok=True)
    assert records.messages == ["session.open blocks=3 ok=true ratio=0.5 session=abc"]


@pytest.mark.parametrize(
    "key", ["token", "audio", "pcm", "samples", "text", "translation", "payload"]
)
def test_sensitive_fields_are_never_written(records: pytest.LogCaptureFixture, key: str) -> None:
    LiveJournal().info("x", **{key: "secret-value"})
    assert "secret-value" not in records.text
    assert f"{key}=<omis>" in records.text


def test_bytes_and_long_values_are_never_written(records: pytest.LogCaptureFixture) -> None:
    LiveJournal().info("x", blob=b"\x00\x01" * 10, long="a" * 500)
    assert "\\x00" not in records.text
    assert "a" * 100 not in records.text
    assert "blob=<omis>" in records.text
    assert "long=<omis>" in records.text


def test_arabic_text_is_never_written_whatever_the_key(records: pytest.LogCaptureFixture) -> None:
    LiveJournal().info("x", note="قل هو الله أحد")
    assert "قل" not in records.text
    assert "note=<omis>" in records.text


def test_levels(records: pytest.LogCaptureFixture) -> None:
    journal = LiveJournal()
    journal.warning("w")
    journal.error("e", code="internal")
    assert [r.levelname for r in records.records] == ["WARNING", "ERROR"]


def test_an_account_is_logged_as_a_short_stable_pseudonym() -> None:
    assert pseudonym("7") == pseudonym("7")
    assert pseudonym("7") != pseudonym("8")
    assert pseudonym("7") != "7"
    assert len(pseudonym("7")) == 8


# --------------------------------------------------------------------------- journal en fichier
import json  # noqa: E402
import os  # noqa: E402
import sys  # noqa: E402
from datetime import UTC, datetime  # noqa: E402
from pathlib import Path  # noqa: E402

from aqr.live.journal import FileSink, log_dir_from_env  # noqa: E402


def _day(iso: str):
    return lambda: datetime.fromisoformat(iso).replace(tzinfo=UTC)


def _rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def test_the_file_journal_writes_one_json_line_per_event_in_a_daily_file(tmp_path: Path) -> None:
    sink = FileSink(tmp_path, now=_day("2026-10-30T10:00:00"))
    journal = LiveJournal(sink=sink)
    journal.info("session.open", session="abc", blocks=3)
    journal.warning("late.arrival", lag_s=1.5)
    rows = _rows(tmp_path / "live-2026-10-30.log")
    assert rows[0] == {
        "ts": "2026-10-30T10:00:00.000Z",
        "level": "info",
        "scope": "live",
        "msg": "session.open",
        "blocks": 3,
        "session": "abc",
    }
    assert rows[1]["level"] == "warn" and rows[1]["msg"] == "late.arrival"


def test_the_file_journal_never_writes_a_token_audio_or_quranic_text(tmp_path: Path) -> None:
    journal = LiveJournal(sink=FileSink(tmp_path, now=_day("2026-10-30T10:00:00")))
    journal.info(
        "x", token="jeton-secret", audio=b"\x00\x01", note="قل هو الله أحد", long="a" * 500
    )
    text = (tmp_path / "live-2026-10-30.log").read_text(encoding="utf-8")
    assert "jeton-secret" not in text
    assert "قل" not in text
    assert "a" * 100 not in text
    row = json.loads(text)
    assert row["token"] == "<omis>" and row["audio"] == "<omis>" and row["note"] == "<omis>"


def test_the_file_journal_changes_file_at_midnight_and_prunes_by_retention(tmp_path: Path) -> None:
    old = tmp_path / "live-2026-09-01.log"
    old.write_text("{}\n", encoding="utf-8")
    stamp = datetime(2026, 9, 1, tzinfo=UTC).timestamp()
    os.utime(old, (stamp, stamp))
    clock = {"now": "2026-10-30T23:59:59"}
    sink = FileSink(
        tmp_path,
        now=lambda: datetime.fromisoformat(clock["now"]).replace(tzinfo=UTC),
        retention_days=30,
    )
    journal = LiveJournal(sink=sink)
    journal.info("a")
    clock["now"] = "2026-10-31T00:00:01"
    journal.info("b")
    assert sink.prune() == 1
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "live-2026-10-30.log",
        "live-2026-10-31.log",
    ]


def test_the_file_journal_uses_restricted_rights_on_posix(tmp_path: Path) -> None:
    LiveJournal(sink=FileSink(tmp_path, now=_day("2026-10-30T10:00:00"))).info("x")
    if sys.platform != "win32":
        assert (tmp_path / "live-2026-10-30.log").stat().st_mode & 0o777 == 0o640


def test_an_unwritable_log_folder_never_breaks_the_service(tmp_path: Path) -> None:
    blocker = tmp_path / "pas-un-dossier"
    blocker.write_text("x", encoding="utf-8")
    LiveJournal(sink=FileSink(blocker / "logs", now=_day("2026-10-30T10:00:00"))).error("boom")


def test_the_log_folder_follows_the_atelier_convention() -> None:
    assert log_dir_from_env({"AQR_LOG_DIR": "/var/log/aqr"}) == Path("/var/log/aqr").resolve()
    assert (
        log_dir_from_env({"AQR_REVIEW_DIR": "/data/review"}) == Path("/data/review/logs").resolve()
    )
    assert log_dir_from_env({}) is None
