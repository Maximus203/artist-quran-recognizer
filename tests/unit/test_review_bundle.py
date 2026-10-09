"""Un pack de revue conserve les octets du moteur et le média, hors Git ; le vérificateur
refuse tout pack dont une entrée, une empreinte ou le manifeste est altéré."""

from __future__ import annotations

import hashlib
import json
import tracemalloc
import zipfile
import zlib
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from scripts import verify_review_bundle
from scripts.export_review_bundle import build_bundle
from scripts.verify_review_bundle import verify_bundle

AUDIO = b"audio original"
AUDIO_SHA = hashlib.sha256(AUDIO).hexdigest()
PREDICTION_PATH = "predictions/original.recognition.json"


def _prediction(source_sha: str = AUDIO_SHA) -> bytes:
    return json.dumps(
        {
            "schema": "aqr.recognition/1",
            "source": {"file": "original.mp3", "sha256": source_sha, "duration_s": 3.0},
            "engine": {"asr": "whisper@pin", "segmenter": "segmenter@pin"},
        }
    ).encode()


def _make_session(root: Path, *, prediction: bytes | None) -> Path:
    session = root / "session"
    session.mkdir()
    (session / "source.mp3").write_bytes(AUDIO)
    meta: dict[str, Any] = {
        "id": "case-id",
        "name": "original.mp3",
        "extension": ".mp3",
        "audio_sha256": AUDIO_SHA,
        "source_kind": "microphone",
    }
    if prediction is not None:
        (session / "prediction.recognition.json").write_bytes(prediction)
        meta["prediction_sha256"] = hashlib.sha256(prediction).hexdigest()
    (session / "review.json").write_text('{"schema":"aqr.review/1"}', encoding="utf-8")
    revisions = session / "revisions"
    revisions.mkdir()
    (revisions / "r0001.review.json").write_text("{}", encoding="utf-8")
    (session / "session.json").write_text(json.dumps(meta), encoding="utf-8")
    return session


@dataclass
class Pack:
    zip: Path
    reference: Path  # fichier source indépendant, jamais lu depuis le pack
    rewrite: Callable[..., Path]


def _rewrite(
    source: Path,
    target: Path,
    *,
    replace: dict[str, bytes] | None = None,
    drop: tuple[str, ...] = (),
    add: dict[str, bytes] | None = None,
) -> Path:
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(target, "w") as out:
        for info in original.infolist():
            if info.filename in drop:
                continue
            data = (replace or {}).get(info.filename, original.read(info.filename))
            out.writestr(info.filename, data, compress_type=zipfile.ZIP_DEFLATED)
        for name, data in (add or {}).items():
            out.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)
    return target


def _edit_manifest(source: Path, target: Path, edit: Callable[[dict[str, Any]], None]) -> Path:
    with zipfile.ZipFile(source) as archive:
        manifest = json.loads(archive.read("manifest.json"))
    edit(manifest)
    return _rewrite(source, target, replace={"manifest.json": json.dumps(manifest).encode("utf-8")})


@pytest.fixture()
def pack(tmp_path: Path) -> Pack:
    session = _make_session(tmp_path, prediction=_prediction())
    target = tmp_path / "pack.zip"
    build_bundle(session, target)
    reference = tmp_path / "reference.mp3"
    reference.write_bytes(AUDIO)
    return Pack(
        zip=target,
        reference=reference,
        rewrite=lambda **kw: _rewrite(target, tmp_path / "altered.zip", **kw),
    )


def test_bundle_keeps_original_bytes_and_revisions(tmp_path: Path) -> None:
    prediction = _prediction()
    session = _make_session(tmp_path, prediction=prediction)
    target = tmp_path / "pack.zip"
    build_bundle(session, target)
    with zipfile.ZipFile(target) as archive:
        assert archive.read("audio/source.mp3") == AUDIO
        assert archive.read(PREDICTION_PATH) == prediction
        assert archive.read("reviews/r0001.review.json") == b"{}"
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["files"]["audio/source.mp3"] == AUDIO_SHA
        assert manifest["source_kind"] == "microphone"
        assert manifest["engine"]["asr"] == "whisper@pin"
        assert (
            manifest["files"]["reviews/current.review.json"]
            == hashlib.sha256(b'{"schema":"aqr.review/1"}').hexdigest()
        )


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


# --- vérificateur -----------------------------------------------------------------------------


def test_a_valid_bundle_passes_against_an_independent_reference(pack: Pack) -> None:
    summary = verify_bundle(pack.zip, source=pack.reference)
    assert summary["session_id"] == "case-id"
    assert summary["audio_sha256"] == AUDIO_SHA
    assert summary["entries"] == [
        "audio/source.mp3",
        PREDICTION_PATH,
        "reviews/current.review.json",
        "reviews/r0001.review.json",
    ]


def test_the_reference_is_optional(pack: Pack) -> None:
    assert verify_bundle(pack.zip)["audio_sha256"] == AUDIO_SHA


def test_one_changed_byte_in_the_prediction_is_refused(pack: Pack) -> None:
    changed = _prediction().replace(b"whisper@pin", b"whisper@pi_")
    altered = pack.rewrite(replace={PREDICTION_PATH: changed})
    with pytest.raises(ValueError, match=r"empreinte.*predictions/original"):
        verify_bundle(altered, source=pack.reference)


@pytest.mark.parametrize(
    "missing", [PREDICTION_PATH, "audio/source.mp3", "reviews/r0001.review.json"]
)
def test_a_listed_entry_that_is_missing_is_refused(pack: Pack, missing: str) -> None:
    with pytest.raises(ValueError, match=f"manquante.*{missing}"):
        verify_bundle(pack.rewrite(drop=(missing,)), source=pack.reference)


def test_an_entry_absent_from_the_manifest_is_refused(pack: Pack) -> None:
    altered = pack.rewrite(add={"reviews/extra.review.json": b"{}"})
    with pytest.raises(ValueError, match=r"non listée.*reviews/extra\.review\.json"):
        verify_bundle(altered, source=pack.reference)


@pytest.mark.parametrize("name", ["notes.txt", "../evil.review.json", "/abs.review.json"])
def test_unexpected_or_unsafe_entry_names_are_refused(
    pack: Pack, tmp_path: Path, name: str
) -> None:
    with_entry = pack.rewrite(add={name: b"x"})
    altered = _edit_manifest(
        with_entry,
        tmp_path / "listed.zip",
        lambda m: m["files"].__setitem__(name, hashlib.sha256(b"x").hexdigest()),
    )
    with pytest.raises(ValueError, match="entrée inattendue"):
        verify_bundle(altered, source=pack.reference)


@pytest.mark.parametrize(
    ("edit", "expected"),
    [
        (lambda m: m["files"].__setitem__("audio/source.mp3", "0" * 64), "empreinte.*audio/source"),
        (lambda m: m.__setitem__("audio_sha256", "0" * 64), "audio_sha256"),
        (lambda m: m.__setitem__("prediction_sha256", "0" * 64), "prediction_sha256"),
        (lambda m: m.__setitem__("prediction_sha256", None), "prediction_sha256"),
        (lambda m: m["files"].__setitem__(PREDICTION_PATH, "f" * 64), "empreinte.*predictions"),
        (lambda m: m.__setitem__("schema", "aqr.review-bundle/9"), "schéma"),
        (lambda m: m.__setitem__("session_id", ""), "session_id"),
        (lambda m: m.__setitem__("files", ["audio/source.mp3"]), "files"),
    ],
    ids=[
        "files.audio",
        "audio_sha256",
        "prediction_sha256",
        "prediction_sha256-null",
        "files.prediction",
        "schema",
        "session_id",
        "files-not-a-dict",
    ],
)
def test_a_wrong_manifest_value_is_refused(
    pack: Pack, tmp_path: Path, edit: Callable[[dict[str, Any]], None], expected: str
) -> None:
    altered = _edit_manifest(pack.zip, tmp_path / "manifest-edited.zip", edit)
    with pytest.raises(ValueError, match=expected):
        verify_bundle(altered, source=pack.reference)


def test_the_audio_must_match_the_independent_reference(pack: Pack) -> None:
    pack.reference.write_bytes(b"autre audio")
    with pytest.raises(ValueError, match="référence"):
        verify_bundle(pack.zip, source=pack.reference)


def test_an_unreadable_reference_is_a_clear_error(pack: Pack, tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="référence illisible"):
        verify_bundle(pack.zip, source=tmp_path / "absent.wav")
    with pytest.raises(ValueError, match="référence illisible"):
        verify_bundle(pack.zip, source=tmp_path)  # un dossier


def test_the_prediction_must_describe_the_bundled_audio(tmp_path: Path) -> None:
    session = _make_session(tmp_path, prediction=_prediction("a" * 64))
    target = tmp_path / "pack.zip"
    build_bundle(session, target)  # l'export ne lit pas la prédiction : seul le vérificateur
    with pytest.raises(ValueError, match=r"source\.sha256"):
        verify_bundle(target)


def test_a_bundle_without_prediction_needs_an_explicit_allowance(tmp_path: Path) -> None:
    session = _make_session(tmp_path, prediction=None)
    target = tmp_path / "pack.zip"
    build_bundle(session, target)
    with pytest.raises(ValueError, match="prédiction"):
        verify_bundle(target)
    assert verify_bundle(target, require_prediction=False)["prediction_sha256"] is None


def test_a_dropped_prediction_is_refused_even_when_not_required(pack: Pack) -> None:
    # le manifeste annonce encore la prédiction : l'autoriser à manquer ne doit pas l'excuser
    with pytest.raises(ValueError, match="manquante"):
        verify_bundle(pack.rewrite(drop=(PREDICTION_PATH,)), require_prediction=False)


def test_a_corrupted_or_manifestless_archive_is_refused(pack: Pack, tmp_path: Path) -> None:
    garbage = tmp_path / "garbage.zip"
    garbage.write_bytes(b"PK pas un zip")
    with pytest.raises(ValueError, match="illisible"):
        verify_bundle(garbage)
    with pytest.raises(ValueError, match=r"manifest\.json"):
        verify_bundle(pack.rewrite(drop=("manifest.json",)))
    with pytest.raises(ValueError, match="illisible"):
        verify_bundle(tmp_path / "absent.zip")


def test_cli_exit_codes_and_messages(
    pack: Pack, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    assert verify_review_bundle.main([str(pack.zip), "--source", str(pack.reference)]) == 0
    assert "OK pack" in capsys.readouterr().out
    altered = pack.rewrite(drop=(PREDICTION_PATH,))
    assert verify_review_bundle.main([str(altered), "--source", str(pack.reference)]) == 1
    assert "manquante" in capsys.readouterr().err


# --- archives hostiles : jamais de MemoryError, toujours une ValueError ------------------------

MIB = 1 << 20


def _stream_zero_entry(archive: zipfile.ZipFile, name: str, size: int) -> str:
    """Écrit `size` octets nuls en flux (le ZIP reste petit) ; renvoie leur SHA-256."""
    digest = hashlib.sha256()
    block = bytes(MIB)
    with archive.open(name, "w", force_zip64=True) as stream:
        for _ in range(size // MIB):
            stream.write(block)
            digest.update(block)
    return digest.hexdigest()


def _with_streamed_entry(
    pack: Pack, name: str, size: int, target: Path, *, replace_audio: bool = False
) -> Path:
    """Copie le pack valide et y ajoute `name` (octets nuls, en flux) listé dans le manifeste.
    `replace_audio` : cette entrée devient l'audio du pack (prédiction retirée)."""
    with (
        zipfile.ZipFile(pack.zip) as original,
        zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as out,
    ):
        manifest = json.loads(original.read("manifest.json"))
        for info in original.infolist():
            dropped = replace_audio and info.filename.startswith(("audio/", "predictions/"))
            if dropped:
                manifest["files"].pop(info.filename)
            elif info.filename != "manifest.json":
                out.writestr(info.filename, original.read(info.filename))
        sha = _stream_zero_entry(out, name, size)
        manifest["files"][name] = sha
        if replace_audio:
            manifest.update(audio_sha256=sha, prediction_sha256=None)
        out.writestr("manifest.json", json.dumps(manifest))
    return target


def test_a_huge_declared_json_entry_is_refused_without_being_read(
    pack: Pack, tmp_path: Path
) -> None:
    # Un ZIP de quelques centaines de Ko qui annonce 600 Mo décompressés (bombe de compression).
    bomb = _with_streamed_entry(pack, "reviews/bomb.review.json", 600 * MIB, tmp_path / "bomb.zip")
    assert bomb.stat().st_size < 5 * MIB
    tracemalloc.start()
    try:
        with pytest.raises(ValueError, match=r"trop volumineu.*reviews/bomb\.review\.json"):
            verify_bundle(bomb, source=pack.reference)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert peak < 50 * MIB, f"{peak / MIB:.0f} Mio alloués pour refuser l'entrée"


def test_the_manifest_size_is_capped(pack: Pack, tmp_path: Path) -> None:
    padded = (json.dumps({"schema": "aqr.review-bundle/1"}) + " " * (2 * MIB)).encode()
    with pytest.raises(ValueError, match=r"trop volumineuse.*manifest\.json"):
        verify_bundle(pack.rewrite(replace={"manifest.json": padded}))


def test_a_large_audio_entry_is_hashed_as_a_stream(pack: Pack, tmp_path: Path) -> None:
    # 200 Mio d'audio : plus que n'importe quelle limite JSON, mais haché par blocs.
    big = _with_streamed_entry(
        pack, "audio/source.bin", 200 * MIB, tmp_path / "big.zip", replace_audio=True
    )
    tracemalloc.start()
    try:
        summary = verify_bundle(big, require_prediction=False)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert summary["audio_sha256"] == hashlib.sha256(bytes(200 * MIB)).hexdigest()
    assert peak < 50 * MIB, f"{peak / MIB:.0f} Mio alloués pour hacher l'audio"


@pytest.mark.parametrize(
    "error",
    [
        MemoryError(),
        NotImplementedError("That compression method is not supported"),
        zlib.error("Error -3 while decompressing data"),
        zipfile.BadZipFile("Bad CRC-32 for file"),
        RuntimeError("File is encrypted, password required for extraction"),
    ],
    ids=lambda e: type(e).__name__,
)
def test_low_level_zip_errors_become_value_errors(
    pack: Pack, monkeypatch: pytest.MonkeyPatch, error: Exception
) -> None:
    def broken(self: zipfile.ZipFile, *args: object, **kwargs: object) -> None:
        raise error

    monkeypatch.setattr(zipfile.ZipFile, "open", broken)
    with pytest.raises(ValueError, match=r"illisible|corrompu"):
        verify_bundle(pack.zip, source=pack.reference)


def test_a_flipped_byte_in_a_stored_entry_is_a_value_error(pack: Pack, tmp_path: Path) -> None:
    raw = bytearray(pack.zip.read_bytes())
    at = bytes(raw).index(AUDIO)  # l'audio est ZIP_STORED : ses octets sont lisibles tels quels
    raw[at] ^= 0x01
    corrupted = tmp_path / "flipped.zip"
    corrupted.write_bytes(bytes(raw))
    with pytest.raises(ValueError, match=r"CRC|corrompu|empreinte"):
        verify_bundle(corrupted, source=pack.reference)
