"""Similarité de mots arabes normalisés, partagée par le matcher (B6) et les formules (pipeline)."""

from __future__ import annotations


def word_similarity(a: str, b: str, threshold: float) -> float:
    """1,0 si identiques ; sinon `1 - distance/longueur_max` si ≥ `threshold`, sinon 0,0.

    Un mot de ≤ 3 lettres n'admet aucune distance à `threshold`=0,7 (seul le mot identique
    compte), ce qui évite la plupart des calculs.
    """
    if a == b:
        return 1.0
    longest = max(len(a), len(b))
    allowed = int((1 - threshold) * longest + 1e-9)
    if not allowed or abs(len(a) - len(b)) > allowed:
        return 0.0
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    similarity = 1 - previous[-1] / longest
    return similarity if similarity >= threshold else 0.0
