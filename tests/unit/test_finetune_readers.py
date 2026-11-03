"""Lecteurs des sources (Parquet Tadabur/FLEURS, tar+TSV Common Voice) et décodage audio."""

from __future__ import annotations

import io
import json
import tarfile
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
pa = pytest.importorskip("pyarrow")
pq = pytest.importorskip("pyarrow.parquet")
sf = pytest.importorskip("soundfile")
pytest.importorskip("soxr")

from aqr.data.finetune_readers import (  # noqa: E402
    decode_audio,
    iter_common_voice,
    iter_fleurs,
    iter_tadabur,
)
from aqr.domain.models import VerseRef  # noqa: E402


def wav_bytes(seconds: float, rate: int, channels: int) -> bytes:
    frames = int(seconds * rate)
    data = np.zeros((frames, channels), dtype="float32") + 0.1
    buffer = io.BytesIO()
    sf.write(buffer, data, rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


def test_decodage_reechantillonne_en_mono_16k(tmp_path: Path) -> None:
    audio = decode_audio(wav_bytes(1.5, 44100, 2), 16000)
    assert audio.duration == pytest.approx(1.5, abs=1e-3)
    out = tmp_path / "x" / "a.wav"
    audio.save(out)
    info = sf.info(str(out))
    assert (info.samplerate, info.channels, info.subtype) == (16000, 1, "PCM_16")
    assert info.duration == pytest.approx(1.5, abs=1e-3)


def test_audio_illisible_leve_value_error() -> None:
    with pytest.raises(ValueError):
        decode_audio(b"pas un wav", 16000)


def test_lecteur_tadabur(tmp_path: Path) -> None:
    meta = {"audio_filename": "tadabur_spk0041_S18_A95_7b537dd3_000073.wav"}
    table = pa.table(
        {
            "audio": [{"bytes": wav_bytes(0.2, 16000, 1), "path": None}],
            "reciter_id": pa.array([41], pa.int32()),
            "surah_id": pa.array([18], pa.int32()),
            "ayah_id": pa.array([95], pa.int32()),
            "text_ar_simple": ["وكلهم اتيه يوم القيامة فردا"],
            "text_ar_uthmani": ["x"],
            "ayah_duration_s": pa.array([0.2], pa.float32()),
            "metadata": [json.dumps(meta)],
        }
    )
    path = tmp_path / "train-00000.parquet"
    pq.write_table(table, path)
    (utt,) = list(iter_tadabur(path))
    assert utt.speaker == "tadabur-41" and utt.ref == VerseRef(19, 95)
    assert utt.utt_id == "tadabur_spk0041_S18_A95_7b537dd3_000073" and utt.split is None
    assert utt.declared_duration == pytest.approx(0.2)
    assert decode_audio(utt.audio, 16000).duration == pytest.approx(0.2, abs=1e-3)


def test_lecteur_tadabur_reference_invalide_conservee_a_none(tmp_path: Path) -> None:
    table = pa.table(
        {
            "audio": [{"bytes": b"x", "path": None}],
            "reciter_id": pa.array([1], pa.int32()),
            "surah_id": pa.array([200], pa.int32()),
            "ayah_id": pa.array([1], pa.int32()),
            "text_ar_simple": ["x"],
            "ayah_duration_s": pa.array([1.0], pa.float32()),
            "metadata": ["{}"],
        }
    )
    pq.write_table(table, tmp_path / "t.parquet")
    (utt,) = list(iter_tadabur(tmp_path / "t.parquet"))
    assert utt.ref is None and utt.utt_id == "tadabur-1-200-1-1"


def test_lecteur_fleurs(tmp_path: Path) -> None:
    table = pa.table(
        {
            "id": pa.array([1606], pa.int32()),
            "path": ["/root/cache/10013199422658976283.wav"],
            "audio": [{"bytes": wav_bytes(0.3, 16000, 1), "path": "10013199422658976283.wav"}],
            "transcription": ["قام البرتغاليون بتدميرها"],
        }
    )
    pq.write_table(table, tmp_path / "validation.parquet")
    (utt,) = list(iter_fleurs(tmp_path / "validation.parquet", "val"))
    assert utt.utt_id == "10013199422658976283" and utt.split == "val"
    assert utt.text == "قام البرتغاليون بتدميرها" and utt.ref is None
    assert utt.speaker == "fleurs-ar-val"


def test_lecteur_common_voice(tmp_path: Path) -> None:
    tsv = tmp_path / "train.tsv"
    tsv.write_text(
        "client_id\tpath\tsentence\n"
        'abc\tcommon_voice_ar_1.mp3\tأقدر "تعاونك" معنا.\n'
        "def\tcommon_voice_ar_2.mp3\tلمن هذا الكتاب؟\n",
        encoding="utf-8",
    )
    archive = tmp_path / "ar_train_0.tar"
    with tarfile.open(archive, "w") as tar:
        for name in ("ar_train_0/common_voice_ar_1.mp3", "ar_train_0/inconnu.mp3"):
            data = wav_bytes(0.25, 48000, 1)
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    utts = list(iter_common_voice(archive, tsv, "train"))
    assert [u.utt_id for u in utts] == ["common_voice_ar_1"]
    assert utts[0].text == 'أقدر "تعاونك" معنا.' and utts[0].speaker == "cv-abc"
    assert decode_audio(utts[0].audio, 16000).duration == pytest.approx(0.25, abs=1e-3)
