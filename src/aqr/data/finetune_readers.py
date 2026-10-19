"""Lecture des sources de fine-tuning et décodage audio (dépendances `[finetune]`, importées
paresseusement : pyarrow, soundfile, soxr, numpy)."""

from __future__ import annotations

import csv
import io
import json
import tarfile
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from aqr.data.finetune import Utterance, tadabur_ref, tadabur_speaker
from aqr.domain.models import VerseRef

_BATCH_ROWS = 32
"""Lignes Parquet converties à la fois. La lecture garde malgré tout la colonne audio du shard en
mémoire (mesuré : 3,0 Go au plus pour le shard Tadabur de 1,08 Go, lecture sans pré-chargement ;
4,1 Go avec) : compter ~7 Go pour un shard de 2,4 Go."""
_CV_SPEAKER_CHARS = 16
"""Préfixe du `client_id` Common Voice (empreinte pseudonyme) gardé comme identifiant de voix."""


@dataclass(frozen=True)
class Pcm:
    samples: Any
    """numpy float32, mono, à `rate`."""
    rate: int

    @property
    def duration(self) -> float:
        return float(len(self.samples)) / self.rate

    def save(self, path: Path) -> None:
        import soundfile as sf

        path.parent.mkdir(parents=True, exist_ok=True)
        part = path.with_name(path.name + ".part")
        sf.write(str(part), self.samples, self.rate, format="WAV", subtype="PCM_16")
        part.replace(path)


def decode_audio(data: bytes, rate: int) -> Pcm:
    """Octets audio (WAV, FLAC, MP3…) → mono float32 à `rate`. ValueError si illisible."""
    import numpy as np
    import soundfile as sf
    import soxr

    try:
        samples, source_rate = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    except (sf.LibsndfileError, RuntimeError, TypeError) as exc:
        raise ValueError(f"audio illisible : {exc}") from exc
    mono = samples.mean(axis=1)
    if source_rate != rate:
        mono = soxr.resample(mono, source_rate, rate)
    return Pcm(np.ascontiguousarray(mono, dtype=np.float32), rate)


def _batches(path: Path, columns: list[str]) -> Iterator[dict[str, list[Any]]]:
    import pyarrow.parquet as pq

    parquet = pq.ParquetFile(path, pre_buffer=False, buffer_size=1 << 20)
    present = [c for c in columns if c in parquet.schema_arrow.names]
    for batch in parquet.iter_batches(batch_size=_BATCH_ROWS, columns=present):
        yield batch.to_pydict()


def iter_tadabur(path: Path) -> Iterator[Utterance]:
    columns = ["audio", "reciter_id", "surah_id", "ayah_id", "text_ar_simple", "ayah_duration_s"]
    row = 0
    for batch in _batches(path, [*columns, "metadata"]):
        for i, reciter in enumerate(batch["reciter_id"]):
            row += 1
            surah, ayah = batch["surah_id"][i], batch["ayah_id"][i]
            ref: VerseRef | None
            try:
                ref = tadabur_ref(surah, ayah)
            except ValueError:
                ref = None
            meta = json.loads(batch["metadata"][i] or "{}") if "metadata" in batch else {}
            filename = meta.get("audio_filename")
            utt_id = (
                PurePosixPath(filename).stem
                if filename
                else f"{tadabur_speaker(reciter)}-{surah}-{ayah}-{row}"
            )
            yield Utterance(
                speaker=tadabur_speaker(reciter),
                utt_id=utt_id,
                text=batch["text_ar_simple"][i] or "",
                ref=ref,
                split=None,
                audio=batch["audio"][i]["bytes"],
                declared_duration=batch["ayah_duration_s"][i],
            )


def iter_fleurs(path: Path, split: str) -> Iterator[Utterance]:
    # FLEURS ne publie pas d'identifiant de locuteur : un pseudo-locuteur par jeu officiel
    # (train/validation/test disjoints), pour que le contrôle « un locuteur d'un seul côté » tienne.
    for batch in _batches(path, ["audio", "path", "transcription"]):
        for i, audio in enumerate(batch["audio"]):
            name = audio.get("path") or batch["path"][i]
            yield Utterance(
                speaker=f"fleurs-ar-{split}",
                utt_id=PurePosixPath(name.replace("\\", "/")).stem,
                text=batch["transcription"][i] or "",
                ref=None,
                split=split,
                audio=audio["bytes"],
            )


def iter_common_voice(archive: Path, transcript: Path, split: str) -> Iterator[Utterance]:
    """Clips de l'archive listés dans le TSV (les autres sont ignorés), dans son ordre."""
    with transcript.open(encoding="utf-8", newline="") as handle:
        rows = {
            row["path"]: row
            for row in csv.DictReader(handle, delimiter="\t", quoting=csv.QUOTE_NONE)
        }
    with tarfile.open(archive, "r") as tar:
        for member in tar:
            name = PurePosixPath(member.name).name
            row = rows.get(name)
            if not member.isfile() or row is None:
                continue
            handle_bytes = tar.extractfile(member)
            if handle_bytes is None:
                continue
            yield Utterance(
                speaker=f"cv-{row['client_id'][:_CV_SPEAKER_CHARS]}",
                utt_id=PurePosixPath(name).stem,
                text=row["sentence"],
                ref=None,
                split=split,
                audio=handle_bytes.read(),
            )
