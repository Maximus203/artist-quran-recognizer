"""Dégradations audio par ffmpeg pour le corpus de référence (schéma : `aqr.data.refcorpus`).

Chaque dégradation lit un WAV et écrit un WAV mono 16 bits à `sample_rate`. Les paramètres sont
ceux du bloc `degradation.params` du manifeste : tout est reproductible (bruit graine).
La vérité terrain n'est jamais modifiée ici ; seul `silence_pad` décale le temps, et le décalage
est déclaré dans `Degradation.shift_s` (voir `refcorpus.degraded_case`).

- noise       : bruit blanc gaussien au rapport signal/bruit exact `snr_db` (RMS mesuré), `seed` ;
- telephone   : bande 300-3400 Hz via une fréquence de 8 kHz, puis retour à `sample_rate` ;
- reverb      : trois échos `aecho` à n x `delay_ms`, de gain `decay` x (1 ; 0,75 ; 0,5) ;
- mp3_low     : encodage MP3 à `kbps` puis décodage ;
- silence_pad : `pad_s` secondes de silence au début (décale la vérité de `pad_s`).
"""

from __future__ import annotations

import math
import random
import shutil
import subprocess
import tempfile
import wave
from array import array
from collections.abc import Mapping
from pathlib import Path

from aqr.data.refcorpus import Degradation, Param

TELEPHONE_RATE = 8000
TELEPHONE_BAND_HZ = (300, 3400)
DEFAULT_REVERB = {"decay": 0.4, "delay_ms": 60}


def _ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if path is None:
        raise RuntimeError("ffmpeg introuvable dans le PATH (requis pour dégrader l'audio)")
    return path


def _run(args: list[str]) -> None:
    subprocess.run([_ffmpeg(), "-nostdin", "-y", "-v", "error", *args], check=True)


def _num(params: Mapping[str, Param], key: str) -> float:
    if key not in params:
        raise ValueError(f"paramètre manquant : {key}")
    return float(params[key])


def read_samples(path: Path) -> tuple[array[int], int]:
    with wave.open(str(path), "rb") as handle:
        if handle.getsampwidth() != 2 or handle.getnchannels() != 1:
            raise ValueError(f"{path} : WAV mono 16 bits attendu")
        samples: array[int] = array("h")
        samples.frombytes(handle.readframes(handle.getnframes()))
        return samples, handle.getframerate()


def write_samples(path: Path, samples: array[int], rate: int) -> None:
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(samples.tobytes())


def rms(samples: array[int]) -> float:
    if not samples:
        return 0.0
    return math.sqrt(sum(s * s for s in samples) / len(samples))


def snr_db(signal: array[int], noisy: array[int]) -> float:
    """Rapport signal/bruit mesuré entre un signal et sa version bruitée (même longueur)."""
    n = min(len(signal), len(noisy))
    noise = array("h", (max(-32768, min(32767, noisy[i] - signal[i])) for i in range(n)))
    return 20 * math.log10(rms(signal[:n]) / rms(noise))


def gaussian_noise(length: int, target_rms: float, seed: int) -> array[int]:
    """Bruit blanc gaussien de RMS `target_rms` (sans écrêtage : borné à 16 bits)."""
    rng = random.Random(f"noise:{seed}")
    return array(
        "h", (max(-32768, min(32767, round(rng.gauss(0.0, target_rms)))) for _ in range(length))
    )


def degrade(degradation: Degradation, src: Path, dest: Path, *, sample_rate: int = 16000) -> None:
    """Écrit la version dégradée de `src` dans `dest` (WAV mono 16 bits, `sample_rate`)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    params = degradation.params
    out = ["-ac", "1", "-ar", str(sample_rate), "-c:a", "pcm_s16le", str(dest)]
    kind = degradation.kind
    if kind == "telephone":
        low, high = TELEPHONE_BAND_HZ
        chain = (
            f"aresample={TELEPHONE_RATE},highpass=f={low},lowpass=f={high},aresample={sample_rate}"
        )
        _run(["-i", str(src), "-af", chain, *out])
    elif kind == "reverb":
        decay = float(params.get("decay", DEFAULT_REVERB["decay"]))
        delay = float(params.get("delay_ms", DEFAULT_REVERB["delay_ms"]))
        delays = "|".join(f"{delay * n:g}" for n in (1, 2, 3))
        decays = "|".join(f"{decay * f:g}" for f in (1.0, 0.75, 0.5))
        _run(["-i", str(src), "-af", f"aecho=0.8:0.88:{delays}:{decays}", *out])
    elif kind == "silence_pad":
        ms = round(_num(params, "pad_s") * 1000)
        _run(["-i", str(src), "-af", f"adelay={ms}:all=1", *out])
    elif kind == "mp3_low":
        with tempfile.TemporaryDirectory() as tmp:
            coded = Path(tmp) / "coded.mp3"
            kbps = round(_num(params, "kbps"))
            _run(["-i", str(src), "-ac", "1", "-c:a", "libmp3lame", "-b:a", f"{kbps}k", str(coded)])
            _run(["-i", str(coded), *out])
    elif kind == "noise":
        samples, rate = read_samples(src)
        level = rms(samples) / (10 ** (_num(params, "snr_db") / 20))
        with tempfile.TemporaryDirectory() as tmp:
            noise_path = Path(tmp) / "noise.wav"
            write_samples(
                noise_path, gaussian_noise(len(samples), level, int(params["seed"])), rate
            )
            _run(
                [
                    "-i",
                    str(src),
                    "-i",
                    str(noise_path),
                    "-filter_complex",
                    "amix=inputs=2:duration=first:normalize=0",
                    *out,
                ]
            )
    else:  # pragma: no cover - Degradation valide déjà le type
        raise ValueError(f"dégradation inconnue : {kind}")


def make_silence(dest: Path, duration_s: float, *, sample_rate: int = 16000) -> None:
    """Silence numérique pur de `duration_s` secondes."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    _run(
        [
            "-f",
            "lavfi",
            "-i",
            f"anullsrc=r={sample_rate}:cl=mono",
            "-t",
            f"{duration_s:g}",
            "-c:a",
            "pcm_s16le",
            str(dest),
        ]
    )
