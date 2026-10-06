"""Fenêtres ASR : découpe des segments plus longs que la limite du modèle (30 s pour Whisper).

Un segment est coupé au creux d'énergie le plus proche de la coupe idéale (morceaux de durée
égale), pas à intervalle fixe : une coupe au milieu d'un mot fait halluciner l'ASR. Les morceaux
sont contigus (rien n'est perdu) ; deux moitiés d'un même verset sont ensuite refusionnées par le
décodeur si l'écart ≤ `merge_max_gap_s` (zéro ici).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from itertools import pairwise

from aqr.domain.models import TimeSpan


def _quietest_cut(
    samples: Sequence[float], rate: int, ideal_s: float, search_s: float, frame_s: float
) -> float:
    frame = max(1, round(frame_s * rate))
    first = max(0, round((ideal_s - search_s) * rate))
    last = min(len(samples) - frame, round((ideal_s + search_s) * rate))
    best_energy, best_start = math.inf, round(ideal_s * rate) - frame // 2
    step = max(1, frame // 2)
    for start in range(first, max(first, last) + 1, step):
        window = samples[start : start + frame]
        if not window:
            continue
        energy = sum(x * x for x in window) / len(window)
        # À énergie égale (plateau), la coupe la plus proche de l'idéale gagne.
        distance = abs(start + frame / 2 - ideal_s * rate)
        if energy < best_energy - 1e-12 or (
            abs(energy - best_energy) <= 1e-12
            and distance < abs(best_start + frame / 2 - ideal_s * rate)
        ):
            best_energy, best_start = energy, start
    return (best_start + frame / 2) / rate


def split_long_spans(
    spans: Sequence[TimeSpan],
    samples: Sequence[float],
    rate: int,
    max_len_s: float,
    search_s: float = 2.0,
    frame_s: float = 0.05,
) -> list[TimeSpan]:
    if max_len_s <= 0:
        raise ValueError("max_len_s doit être > 0")
    pieces: list[TimeSpan] = []
    for span in spans:
        if span.duration_s <= max_len_s:
            pieces.append(span)
            continue
        count = math.ceil(span.duration_s / max_len_s)
        step = span.duration_s / count
        cuts = [span.start_s]
        for i in range(1, count):
            ideal = span.start_s + i * step
            cuts.append(_quietest_cut(samples, rate, ideal, min(search_s, step / 4), frame_s))
        cuts.append(span.end_s)
        ok = all(b > a and b - a <= max_len_s + 1e-6 for a, b in pairwise(cuts))
        if not ok:  # creux trop excentrés : repli sur la coupe idéale, toujours valide
            cuts = [span.start_s + i * step for i in range(count)] + [span.end_s]
        pieces.extend(TimeSpan(a, b) for a, b in pairwise(cuts))
    return pieces
