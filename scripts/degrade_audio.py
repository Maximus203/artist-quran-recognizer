#!/usr/bin/env python3
"""Dégrade un WAV avec ffmpeg (bruit à SNR donné, bande téléphonique, réverbération, MP3 bas débit,
silence en tête). Ne touche pas au manifeste : voir scripts/build_ref_corpus.py pour le corpus.

    python scripts/degrade_audio.py noise IN.wav OUT.wav --snr-db 10 --seed 1
    python scripts/degrade_audio.py telephone IN.wav OUT.wav        # 8 kHz, 300-3400 Hz
    python scripts/degrade_audio.py reverb IN.wav OUT.wav --decay 0.4 --delay-ms 60
    python scripts/degrade_audio.py mp3_low IN.wav OUT.wav --kbps 32
    python scripts/degrade_audio.py silence_pad IN.wav OUT.wav --pad-s 2   # décale la vérité de 2 s
    python scripts/degrade_audio.py silence OUT.wav --duration 30           # silence pur

Écrire hors du dépôt (ex. ~/aqr-ref) : aucun audio dans git.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from aqr.data.degrade import degrade, make_silence
from aqr.data.refcorpus import DEGRADATION_KINDS, Degradation, Param

ROOT = Path(__file__).resolve().parents[1]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("kind", choices=(*DEGRADATION_KINDS, "silence"))
    parser.add_argument("paths", nargs="+", type=Path, help="IN OUT (ou OUT seul pour silence)")
    parser.add_argument("--snr-db", type=float)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--decay", type=float, default=0.4)
    parser.add_argument("--delay-ms", type=float, default=60)
    parser.add_argument("--kbps", type=int, default=32)
    parser.add_argument("--pad-s", type=float, default=2.0)
    parser.add_argument("--duration", type=float, default=30.0)
    parser.add_argument("--sample-rate", type=int, default=16000)
    args = parser.parse_args(argv)

    if args.kind == "silence":
        if len(args.paths) != 1:
            parser.error("silence : un seul chemin de sortie")
        out = args.paths[0]
    else:
        if len(args.paths) != 2:
            parser.error(f"{args.kind} : IN OUT attendus")
        src, out = args.paths
    resolved = out.expanduser().resolve()
    if resolved == ROOT or ROOT in resolved.parents:
        parser.error("sortie dans le dépôt refusée : l'audio reste hors de git (ex. ~/aqr-ref)")

    if args.kind == "silence":
        make_silence(out, args.duration, sample_rate=args.sample_rate)
        print(f"silence {args.duration:g} s -> {out}")
        return 0

    params: dict[str, Param]
    shift = 0.0
    if args.kind == "noise":
        if args.snr_db is None:
            parser.error("noise : --snr-db requis")
        params = {"snr_db": args.snr_db, "seed": args.seed}
    elif args.kind == "reverb":
        params = {"decay": args.decay, "delay_ms": args.delay_ms}
    elif args.kind == "mp3_low":
        params = {"kbps": args.kbps}
    elif args.kind == "silence_pad":
        params, shift = {"pad_s": args.pad_s}, args.pad_s
    else:
        params = {}
    degradation = Degradation(args.kind, params, shift)
    degrade(degradation, src, out, sample_rate=args.sample_rate)
    suffix = f" (vérité décalée de {shift:g} s)" if shift else ""
    print(f"{degradation.label} : {src} -> {out}{suffix}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
