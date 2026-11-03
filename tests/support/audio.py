"""Fabrication de fichiers audio/vidéo de test (stdlib + ffmpeg) : aucune donnée réelle."""

from __future__ import annotations

import math
import shutil
import struct
import subprocess
import wave
from itertools import pairwise
from pathlib import Path

FFMPEG = shutil.which("ffmpeg")


def write_sine_wav(
    path: Path,
    seconds: float,
    *,
    freq: float = 440.0,
    rate: int = 16000,
    channels: int = 1,
    amplitude: float = 0.5,
) -> Path:
    frames = round(seconds * rate)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        data = bytearray()
        for i in range(frames):
            value = int(32767 * amplitude * math.sin(2 * math.pi * freq * i / rate))
            data += struct.pack("<h", value) * channels
        handle.writeframes(bytes(data))
    return path


def write_silence_wav(path: Path, seconds: float, *, rate: int = 16000) -> Path:
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(b"\x00\x00" * round(seconds * rate))
    return path


def ffmpeg(*args: str) -> None:
    assert FFMPEG is not None
    subprocess.run([FFMPEG, "-nostdin", "-y", "-v", "error", *args], check=True)


def make_mp3(path: Path, seconds: float, freq: float = 440.0) -> Path:
    ffmpeg("-f", "lavfi", "-i", f"sine=frequency={freq}:duration={seconds}", str(path))
    return path


def make_video_with_audio(path: Path, seconds: float, freq: float = 440.0) -> Path:
    ffmpeg(
        "-f", "lavfi", "-i", f"testsrc=duration={seconds}:size=64x48:rate=5",
        "-f", "lavfi", "-i", f"sine=frequency={freq}:duration={seconds}",
        "-shortest", "-c:v", "mpeg4", "-c:a", "aac", str(path),
    )  # fmt: skip
    return path


def make_video_without_audio(path: Path, seconds: float) -> Path:
    ffmpeg(
        "-f", "lavfi", "-i", f"testsrc=duration={seconds}:size=64x48:rate=5",
        "-c:v", "mpeg4", str(path),
    )  # fmt: skip
    return path


def zero_crossing_frequency(samples: object, rate: int) -> float:
    values = list(samples)  # type: ignore[call-overload]
    crossings = sum(1 for a, b in pairwise(values) if (a < 0) != (b < 0))
    return crossings / 2 / (len(values) / rate)
