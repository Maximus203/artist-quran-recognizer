"""Dégradations de la campagne de robustesse (`scripts/measure_degradation.py`).

Complète `aqr.data.degrade` (bruit blanc, MP3, bande téléphonique : réutilisés tels quels) avec ce
dont la courbe de dégradation a besoin et que le corpus de référence n'a pas :

- bruit rose à SNR exact (graine `seed`, `anoisesrc` de ffmpeg, mis à l'échelle sur le RMS mesuré) ;
- réverbération de salle : réponse impulsionnelle synthétique (bruit gaussien à décroissance
  exponentielle, RT60 et rapport direct/réverbéré réglés, énergie unitaire), appliquée par `afir`.
  Le son direct est l'impulsion du temps 0 : rien n'est décalé, la vérité terrain ne bouge pas ;
  `aecho` (kind `reverb` de `degrade.py`) n'est que trois échos, pas une salle ;
- téléphone : bande 300-3400 Hz à 8 kHz puis un VRAI codec (G.711 µ-law, AMR-NB), retour à 16 kHz ;
- étirement temporel sans changement de hauteur (`atempo`) : la vérité terrain suit (÷ vitesse) ;
- combinaison réverbération puis bruit blanc.

`apply_condition` renvoie les commandes ffmpeg exécutées (arguments après `ffmpeg -nostdin -y -v
error`) : la table de la méthode du rapport est écrite à partir de ces commandes, pas de mémoire.
Le résultat est toujours un WAV mono 16 bits à `sample_rate`. Rien n'est écrit dans le dépôt.
"""

from __future__ import annotations

import math
import random
import shutil
import sys
import tempfile
from array import array
from pathlib import Path
from typing import Final

from aqr.data import degrade as base
from aqr.data.refcorpus import Degradation
from aqr.eval.degradation_curve import Condition, resolve_step

PINK_AMPLITUDE = 0.5
IR_EXTRA_S = 0.05
"""Marge de la réponse impulsionnelle au-delà du RT60 (la queue y est à -60 dB et moins)."""
FFMPEG_PREFIX = "ffmpeg -nostdin -y -v error"


def _scale(samples: array[int], target_rms: float) -> array[int]:
    """Bruit ramené au RMS `target_rms` (borné à 16 bits)."""
    current = base.rms(samples)
    if current == 0:
        raise ValueError("bruit nul : impossible de le mettre à l'échelle")
    gain = target_rms / current
    return array("h", (max(-32768, min(32767, round(s * gain))) for s in samples))


def pink_noise(
    duration_s: float, sample_rate: int, seed: int, *, run: base.Runner | None = None
) -> array[int]:
    """Bruit rose (ffmpeg `anoisesrc`, graine fixée) de `duration_s` secondes, WAV 16 bits lu."""
    runner = run or base._run
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "pink.wav"
        runner(
            [
                "-f",
                "lavfi",
                "-i",
                f"anoisesrc=color=pink:seed={seed}:sample_rate={sample_rate}"
                f":duration={duration_s:.3f}:amplitude={PINK_AMPLITUDE}",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(path),
            ]
        )
        return base.read_samples(path)[0]


def room_impulse_response(
    rt60_s: float, drr_db: float, sample_rate: int, seed: int
) -> array[float]:
    """Réponse impulsionnelle de salle : son direct (impulsion en 0) + queue diffuse.

    La queue est un bruit gaussien multiplié par exp(-6,908 t / RT60) (-60 dB à t = RT60) ; son
    énergie est réglée pour que direct/réverbéré = `drr_db` ; l'ensemble est normalisé à une
    énergie de 1 (le signal garde son niveau efficace)."""
    length = round((rt60_s + IR_EXTRA_S) * sample_rate)
    rng = random.Random(f"ir:{seed}:{rt60_s}")
    tail = [
        rng.gauss(0.0, 1.0) * math.exp(-6.907755 * (i / sample_rate) / rt60_s)
        for i in range(1, length)
    ]
    tail_energy = sum(x * x for x in tail)
    wanted = 10 ** (-drr_db / 10)  # énergie de la queue, le direct valant 1
    gain = math.sqrt(wanted / tail_energy)
    total = math.sqrt(1.0 + wanted)
    return array("f", [1.0 / total, *(x * gain / total for x in tail)])


def _write_f32(path: Path, values: array[float]) -> None:
    if sys.byteorder != "little":  # pragma: no cover - ffmpeg lit f32le
        values = array("f", values)
        values.byteswap()
    path.write_bytes(values.tobytes())


def _reverb(
    src: Path, dest: Path, params: dict[str, float | int | str], rate: int, run: base.Runner
) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        ir_path = Path(tmp) / "ir.f32"
        _write_f32(
            ir_path,
            room_impulse_response(
                float(params["rt60_s"]), float(params["drr_db"]), rate, int(params["seed"])
            ),
        )
        run(
            [
                "-i",
                str(src),
                "-f",
                "f32le",
                "-ar",
                str(rate),
                "-ac",
                "1",
                "-i",
                str(ir_path),
                "-filter_complex",
                "[0:a][1:a]afir=gtype=none:irnorm=-1",
                "-ac",
                "1",
                "-ar",
                str(rate),
                "-c:a",
                "pcm_s16le",
                str(dest),
            ]
        )


def _noise(
    kind: str, src: Path, dest: Path, snr: float, seed: int, rate: int, run: base.Runner
) -> None:
    samples, _src_rate = base.read_samples(src)
    level = base.rms(samples) / (10 ** (snr / 20))
    if kind == "noise_white":
        noise = base.gaussian_noise(len(samples), level, seed)
    else:
        noise = _scale(pink_noise(len(samples) / rate, rate, seed, run=run), level)
        noise = noise[: len(samples)] + array("h", [0] * max(0, len(samples) - len(noise)))
    base.mix_with_noise(src, noise, dest, sample_rate=rate, run=run)


def _telephone(
    src: Path, dest: Path, params: dict[str, float | int | str], rate: int, run: base.Runner
) -> None:
    low, high = base.TELEPHONE_BAND_HZ
    codec, bitrate = str(params["codec"]), str(params["bitrate"])
    with tempfile.TemporaryDirectory() as tmp:
        band = Path(tmp) / "band.wav"
        coded = Path(tmp) / ("coded.wav" if codec == "pcm_mulaw" else "coded.amr")
        run(
            [
                "-i",
                str(src),
                "-af",
                f"aresample={base.TELEPHONE_RATE},highpass=f={low},lowpass=f={high}",
                "-ac",
                "1",
                "-ar",
                str(base.TELEPHONE_RATE),
                "-c:a",
                "pcm_s16le",
                str(band),
            ]
        )
        encode = ["-i", str(band), "-ac", "1", "-ar", str(base.TELEPHONE_RATE), "-c:a", codec]
        if bitrate:
            encode += ["-b:a", bitrate]
        run([*encode, str(coded)])
        run(["-i", str(coded), "-ac", "1", "-ar", str(rate), "-c:a", "pcm_s16le", str(dest)])


ATEMPO_MIN: Final = 0.5
"""`atempo` n'accepte pas moins de 0,5 par instance : au-delà, on enchaîne."""


def tempo_filters(tempo: float) -> list[str]:
    """Chaîne de filtres `atempo` dont le produit vaut `tempo` (0,3 -> 0,5 puis 0,6)."""
    if tempo <= 0:
        raise ValueError(f"vitesse invalide : {tempo}")
    factors: list[float] = []
    remaining = tempo
    while remaining < ATEMPO_MIN:
        factors.append(ATEMPO_MIN)
        remaining /= ATEMPO_MIN
    factors.append(remaining)
    return [f"atempo={factor:g}" for factor in factors]


def apply_condition(
    condition: Condition,
    src: Path,
    dest: Path,
    *,
    seed_offset: int = 0,
    sample_rate: int = 16000,
) -> list[list[str]]:
    """Écrit la version de `src` dégradée selon `condition` ; renvoie les commandes ffmpeg lancées.

    `seed_offset` rend le bruit (et la réponse impulsionnelle) différents d'un fichier à l'autre
    tout en restant reproductibles."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    log: list[list[str]] = []

    def run(args: list[str]) -> None:
        log.append(args)
        base._run(args)

    params = dict(condition.params)
    if "seed" in params:
        params["seed"] = int(params["seed"]) + seed_offset
    kind = condition.kind
    if kind == "clean":
        shutil.copyfile(src, dest)
    elif kind in ("noise_white", "noise_pink"):
        _noise(kind, src, dest, float(params["snr_db"]), int(params["seed"]), sample_rate, run)
    elif kind == "reverb_room":
        _reverb(src, dest, params, sample_rate, run)
    elif kind == "telephone":
        _telephone(src, dest, params, sample_rate, run)
    elif kind == "mp3":
        base.degrade(
            Degradation("mp3_low", {"kbps": int(params["kbps"])}),
            src,
            dest,
            sample_rate=sample_rate,
            run=run,
        )
    elif kind == "chain":
        steps = [resolve_step(step) for step in str(params["steps"]).split(">")]
        with tempfile.TemporaryDirectory() as tmp:
            current = src
            for index, step in enumerate(steps):
                last = index == len(steps) - 1
                target = dest if last else Path(tmp) / f"step{index}.wav"
                log.extend(
                    apply_condition(
                        step, current, target, seed_offset=seed_offset, sample_rate=sample_rate
                    )
                )
                current = target
    elif kind == "denoise":
        run(
            [
                "-i",
                str(src),
                "-af",
                f"afftdn=nr={int(params['nr'])}:nf={int(params['nf'])}:tn=1",
                "-ac",
                "1",
                "-ar",
                str(sample_rate),
                "-c:a",
                "pcm_s16le",
                str(dest),
            ]
        )
    elif kind == "lowpass":
        cutoff = round(float(params["hz"]))
        run(
            [
                "-i",
                str(src),
                "-af",
                f"aresample={2 * cutoff},aresample={sample_rate}",
                "-ac",
                "1",
                "-ar",
                str(sample_rate),
                "-c:a",
                "pcm_s16le",
                str(dest),
            ]
        )
    elif kind == "tempo":
        run(
            [
                "-i",
                str(src),
                "-af",
                ",".join(tempo_filters(float(params["tempo"]))),
                "-ac",
                "1",
                "-ar",
                str(sample_rate),
                "-c:a",
                "pcm_s16le",
                str(dest),
            ]
        )
    elif kind == "combo":
        with tempfile.TemporaryDirectory() as tmp:
            room = Path(tmp) / "room.wav"
            _reverb(src, room, params, sample_rate, run)
            _noise(
                "noise_white",
                room,
                dest,
                float(params["snr_db"]),
                int(params["seed"]),
                sample_rate,
                run,
            )
    else:
        raise ValueError(f"condition inconnue : {kind}")
    return log


def format_command(args: list[str], src: Path, dest: Path) -> str:
    """Ligne de commande lisible : `IN.wav` / `OUT.wav` pour la source et la sortie, nom de fichier
    seul pour les intermédiaires (jamais un chemin local)."""
    shown: list[str] = []
    for arg in args:
        if arg == str(src):
            shown.append("IN.wav")
        elif arg == str(dest):
            shown.append("OUT.wav")
        elif Path(arg).is_absolute():
            shown.append(Path(arg).name)
        else:
            shown.append(arg)
    return f"{FFMPEG_PREFIX} {' '.join(shown)}"
