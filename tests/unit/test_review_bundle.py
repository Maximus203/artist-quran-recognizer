"""Un pack de revue conserve les octets du moteur et le média, hors Git."""

import hashlib
import json
import zipfile
from pathlib import Path

import pytest
from scripts.export_review_bundle import build_bundle


def test_bundle_keeps_original_bytes_and_revisions(tmp_path: Path) -> None:
    session = tmp_path / "session"
    session.mkdir()
    audio = b"audio original"
    prediction = b'{"schema":"aqr.recognition/1"}\n'
    (session / "source.mp3").write_bytes(audio)
    (session / "prediction.recognition.json").write_bytes(prediction)
    (session / "review.json").write_text('{"schema":"aqr.review/1"}', encoding="utf-8")
    revisions = session / "revisions"
    revisions.mkdir()
    (revisions / "r0001.review.json").write_text("{}", encoding="utf-8")
    (session / "session.json").write_text(
        json.dumps(
            {
                "id": "case-id",
                "name": "original.mp3",
                "extension": ".mp3",
                "audio_sha256": hashlib.sha256(audio).hexdigest(),
                "prediction_sha256": hashlib.sha256(prediction).hexdigest(),
            }
        ),
        encoding="utf-8",
    )
    target = tmp_path / "pack.zip"
    build_bundle(session, target)
    with zipfile.ZipFile(target) as archive:
        assert archive.read("audio/source.mp3") == audio
        assert archive.read("predictions/original.recognition.json") == prediction
        assert archive.read("reviews/r0001.review.json") == b"{}"
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["files"]["audio/source.mp3"] == hashlib.sha256(audio).hexdigest()


def test_bundle_refuses_changed_audio(tmp_path: Path) -> None:
    session = tmp_path / "session"
    session.mkdir()
    (session / "source.mp3").write_bytes(b"changed")
    (session / "session.json").write_text(
        json.dumps({"id": "case-id", "extension": ".mp3", "audio_sha256": "0" * 64}),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="audio"):
        build_bundle(session, tmp_path / "pack.zip")
