"""Propositions françaises candidates : où la traduction PEUT être coupée.

Une coupure candidate est un début de tranche : le premier caractère visible après la ponctuation
(avec son guillemet fermant et sa marque de note `[n]` restés sur la tranche précédente), jamais
dans une parenthèse. Le texte n'est pas modifié : on ne calcule que des positions (I2).
"""

from __future__ import annotations

import itertools
import re

from aqr.translation_align.config import TranslationAlignmentConfig
from aqr.translation_align.tokens import french_tokens

_CLOSING_QUOTES = '"”»'
_NOTE_AT = re.compile(r"\[\d+\]")


def _raw_starts(text: str, cut_chars: str) -> list[int]:
    starts: list[int] = []
    depth = 0
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        elif ch in cut_chars and depth == 0:
            j = i + 1
            while j < n and text[j] in _CLOSING_QUOTES:
                j += 1
            note = _NOTE_AT.match(text, j)
            if note:
                j = note.end()
            while j < n and text[j] in _CLOSING_QUOTES:
                j += 1
            if j < n and text[j].isspace():
                k = j
                while k < n and text[k].isspace():
                    k += 1
                if k < n:
                    starts.append(k)
                i = k
                continue
        i += 1
    return starts


def clause_starts(text: str, config: TranslationAlignmentConfig) -> list[int]:
    """Offsets de caractères où une proposition peut commencer (hors le début du texte)."""
    starts = _raw_starts(text, config.cut_chars)
    while starts:
        bounds = [0, *starts, len(text)]
        counts = [len(french_tokens(text[a:b], config)) for a, b in itertools.pairwise(bounds)]
        small = next((k for k, c in enumerate(counts) if c < config.min_clause_tokens), None)
        if small is None or len(counts) == 1:
            break
        # fusion avec la voisine : on retire la coupure qui suit (ou celle qui précède la dernière)
        starts.pop(small if small < len(starts) else small - 1)
    return starts
