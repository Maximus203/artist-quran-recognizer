"""Temps au mot sans chevauchement (ADR-0010).

Deux fenêtres voisines du segmenteur peuvent se recouvrir de quelques dizaines de millisecondes ;
l'alignement de chacune place alors le dernier mot de l'une et le premier mot de l'autre l'un sur
l'autre (cas réel, vitesse ×0,3, Alafasy 67:26 : le mot 5 finit à 1212,575 s, le mot 6 commence à
1212,525 s). Les temps au mot sont ordonnés, ou ils ne sont pas publiés : un fichier que le moteur
écrit doit toujours rester lisible, et l'interface s'appuie sur cet ordre.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final

from aqr.domain.models import TimeSpan

MAX_REPAIRED_OVERLAP_S: Final = 0.1
"""Chevauchement de deux mots voisins qu'on recoupe sans scrupule : la résolution de l'alignement
est de 80 ms (une trame) et deux fenêtres voisines se recouvrent de quelques dizaines de ms.
Au-delà, deux mots sont placés sur la même parole : rien n'est réparé. Provisoire (mesuré :
50 ms)."""


def without_overlap(
    times: Sequence[TimeSpan], max_overlap_s: float = MAX_REPAIRED_OVERLAP_S
) -> tuple[TimeSpan, ...] | None:
    """Mêmes temps, sans recouvrement : deux mots voisins qui se chevauchent d'au plus
    `max_overlap_s` se partagent le recouvrement par moitié (le premier début et le dernier fin ne
    bougent pas). Au-delà, ou si le recoupage viderait un mot : None, ces temps ne sont pas
    honnêtes (le producteur publie alors une estimation déclarée, ou rien)."""
    out = list(times)
    for i in range(1, len(out)):
        before, after = out[i - 1], out[i]
        overlap = before.end_s - after.start_s
        if overlap <= 0:
            continue
        cut = after.start_s + overlap / 2
        if overlap > max_overlap_s or cut <= before.start_s or cut >= after.end_s:
            return None
        out[i - 1], out[i] = TimeSpan(before.start_s, cut), TimeSpan(cut, after.end_s)
    return tuple(out)
