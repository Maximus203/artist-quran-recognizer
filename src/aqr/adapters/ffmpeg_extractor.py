"""B1 `AudioExtractor` : tout format lu par ffmpeg -> PCM float32 mono (16 kHz par défaut).

Les échantillons sont un `array('f')` normalisé dans [-1, 1] (satisfait `Sequence[float]`) :
aucune dépendance numpy ici, un enregistrement de 4 h tient en ~0,9 Go.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from array import array
from dataclasses import dataclass
from pathlib import Path

from aqr.domain.ports import AudioClip


class AudioExtractionError(RuntimeError):
    """ffmpeg absent, fichier illisible ou sans piste audio (message clair, avec le fichier)."""


@dataclass(frozen=True)
class ExtractorConfig:
    sample_rate: int = 16000
    ffmpeg_path: str | None = None
    """Chemin de l'exécutable ; None = `ffmpeg` du PATH."""
    timeout_s: float | None = None
    """None = pas de limite (un enregistrement de plusieurs heures est légitime)."""


def clamp_full_scale(samples: array[float]) -> array[float]:
    """Ramène dans [-1, 1] les dépassements de pleine échelle (MP3/AAC décodés en flottant
    dépassent 0 dBFS : mesuré jusqu'à 1,43 sur un vrai MP3 du lot 1). Le signal n'est pas
    modifié ailleurs (pas de limiteur ni de normalisation : le niveau reste celui de la source).
    Renvoie `samples` tel quel s'il n'y a rien à écrêter (pas de copie)."""
    if not samples or (max(samples) <= 1.0 and min(samples) >= -1.0):
        return samples
    try:
        import numpy as np
    except ImportError:  # repli sans numpy : correct, plus lent
        return array("f", (min(1.0, max(-1.0, x)) for x in samples))
    clipped = np.clip(np.frombuffer(samples, dtype=np.float32), -1.0, 1.0)
    out: array[float] = array("f")
    out.frombytes(clipped.tobytes())
    return out


class FfmpegAudioExtractor:
    def __init__(self, config: ExtractorConfig | None = None) -> None:
        self._config = config or ExtractorConfig()

    def _executable(self) -> str:
        wanted = self._config.ffmpeg_path or "ffmpeg"
        found = shutil.which(wanted)
        if found is None:
            raise AudioExtractionError(
                f"ffmpeg introuvable ({wanted!r}) : l'installer ou "
                "renseigner ExtractorConfig.ffmpeg_path"
            )
        return found

    def _has_no_audio_stream(self, path: Path) -> bool:
        """Vrai si ffprobe lit le fichier et n'y trouve aucune piste audio (vidéo muette)."""
        ffprobe = shutil.which(
            "ffprobe", path=str(Path(self._executable()).parent)
        ) or shutil.which("ffprobe")
        if ffprobe is None:
            return False
        probe = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
             "-of", "csv=p=0", str(path)],
            capture_output=True, check=False, timeout=self._config.timeout_s,
        )  # fmt: skip
        return probe.returncode == 0 and not probe.stdout.strip()

    def extract(self, path: Path) -> AudioClip:
        if not path.exists():
            raise FileNotFoundError(path)
        command = [
            self._executable(), "-nostdin", "-v", "error", "-i", str(path), "-vn",
            "-ac", "1", "-ar", str(self._config.sample_rate), "-f", "f32le", "pipe:1",
        ]  # fmt: skip
        try:
            result = subprocess.run(
                command, capture_output=True, check=False, timeout=self._config.timeout_s
            )
        except subprocess.TimeoutExpired as exc:
            raise AudioExtractionError(f"{path.name} : ffmpeg a dépassé le délai imparti") from exc
        if result.returncode != 0:
            if self._has_no_audio_stream(path):
                raise AudioExtractionError(
                    f"{path.name} : aucune piste audio exploitable (fichier muet ou vide)"
                )
            detail = result.stderr.decode("utf-8", errors="replace").strip().splitlines()
            reason = detail[-1] if detail else "erreur inconnue"
            raise AudioExtractionError(
                f"{path.name} : ffmpeg n'a pas pu lire ce fichier ({reason})"
            )
        if not result.stdout:
            raise AudioExtractionError(
                f"{path.name} : aucune piste audio exploitable (fichier muet ou vide)"
            )
        samples = array("f")
        samples.frombytes(result.stdout[: len(result.stdout) - len(result.stdout) % 4])
        if sys.byteorder == "big":  # ffmpeg écrit du little-endian
            samples.byteswap()
        return AudioClip(
            samples=clamp_full_scale(samples),
            sample_rate=self._config.sample_rate,
            source=str(path),
        )
