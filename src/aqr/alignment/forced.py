"""Alignement forcé d'un passage CONNU sur un treillis CTC (ADR-0006).

On sait (ou on suppose) quels versets sont récités dans un passage ; l'alignement dit QUAND chaque
mot l'est, et à quel point l'audio soutient ce texte (`CtcEvidence`, ADR-0005). Sert à la vérité
terrain semi-automatique (l'humain dit quoi, l'alignement dit quand) puis à la vérification des
candidats dans la reconnaissance.

Le texte aligné est celui du corpus en graphie imla'i (`AlignmentTexts`), jamais une sortie d'ASR
(I1). Les temps rendus sont rattachés aux mots Uthmani. Pur : testable sans modèle.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from aqr.corpus.alignment_text import AlignmentTexts, AlignmentVariant
from aqr.decoding.ctc_constrained import CtcEvidence, ctc_forced_align, ctc_free_logprob
from aqr.domain.models import TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import CtcLattice


@dataclass(frozen=True)
class AlignmentConfig:
    variants: tuple[AlignmentVariant, ...] = (AlignmentVariant.VOCALIZED, AlignmentVariant.BARE)
    """Graphies essayées ; la meilleure (vraisemblance du chemin contraint) est retenue."""
    verse_end_extension_s: float = 0.0
    """Prolongation de la fin d'un verset au-delà de son dernier symbole émis (un CTC émet tôt et
    laisse la fin d'un allongement aux blancs). Jamais au-delà du verset suivant ni du passage.
    Provisoire : à régler sur des limites annotées (docs/evaluation/)."""
    energy_ratio: float | None = None
    """Affinage des limites par l'énergie (`CtcLattice.frame_rms`) : un verset s'étend autour de
    ses symboles tant que la RMS reste ≥ ratio × sa RMS maximale. None = désactivé. Provisoire :
    réglé par `scripts/measure_alignment.py`, à confirmer sur des limites annotées à l'oreille."""


@dataclass(frozen=True)
class AlignedWord:
    ref: VerseRef
    word: int
    """Indice du mot Uthmani (à partir de 1)."""
    time: TimeSpan


@dataclass(frozen=True)
class AlignedSpan:
    span: WordSpan
    time: TimeSpan
    words: tuple[AlignedWord, ...]


@dataclass(frozen=True)
class PassageAlignment:
    spans: tuple[AlignedSpan, ...]
    variant: AlignmentVariant
    evidence: CtcEvidence


class PassageAligner:
    def __init__(
        self,
        texts: AlignmentTexts,
        encode: Callable[[str], Sequence[int]],
        config: AlignmentConfig | None = None,
    ) -> None:
        self._texts = texts
        self._encode = encode
        self._config = config or AlignmentConfig()

    def align(self, lattice: CtcLattice, spans: Sequence[WordSpan]) -> PassageAlignment | None:
        """Aligne les plages, dans l'ordre, sur tout le treillis ; None si le texte n'y tient
        pas."""
        if not spans:
            raise ValueError("aucune plage à aligner")
        best: tuple[float, AlignmentVariant, list[tuple[int, int]], list[tuple[int, int]]] | None
        best = None
        for variant in self._config.variants:
            labels: list[int] = []
            owners: list[tuple[int, int]] = []  # (indice de plage, mot Uthmani) de chaque symbole
            for index, span in enumerate(spans):
                for word in self._texts.words(span, variant):
                    for symbol in self._encode(word.text):
                        labels.append(symbol)
                        owners.append((index, word.word))
            forced, frames = ctc_forced_align(lattice.log_probs, labels, lattice.blank)
            if forced > -math.inf and (best is None or forced > best[0]):
                best = (forced, variant, owners, frames)
        if best is None:
            return None
        forced, variant, owners, frames = best
        free = ctc_free_logprob(lattice.log_probs)
        evidence = CtcEvidence(
            forced_logprob=forced,
            free_logprob=free,
            llr_per_frame=(forced - free) / lattice.frames,
            frames=lattice.frames,
        )
        return PassageAlignment(
            spans=self._timed(lattice, spans, owners, frames), variant=variant, evidence=evidence
        )

    def _timed(
        self,
        lattice: CtcLattice,
        spans: Sequence[WordSpan],
        owners: list[tuple[int, int]],
        frames: list[tuple[int, int]],
    ) -> tuple[AlignedSpan, ...]:
        # Trames [première, dernière] de chaque mot Uthmani, par plage.
        word_frames: list[dict[int, list[int]]] = [{} for _ in spans]
        for (index, word), (first, last) in zip(owners, frames, strict=True):
            bounds = word_frames[index].setdefault(word, [first, last])
            bounds[0], bounds[1] = min(bounds[0], first), max(bounds[1], last)

        ordered = [sorted(w.items()) for w in word_frames]
        token_starts = [o[0][1][0] for o in ordered]
        result: list[AlignedSpan] = []
        previous_end = 0  # trame (exclue) où finit le verset précédent
        for index, span in enumerate(spans):
            words_frames = ordered[index]
            first, last = token_starts[index], words_frames[-1][1][1]
            limit = token_starts[index + 1] if index + 1 < len(spans) else lattice.frames
            word_limits = (words_frames[0][1][1], words_frames[-1][1][0] + 1)
            first, end_frame = self._voiced(
                lattice, first, last, (previous_end, limit), word_limits
            )
            end = min(
                lattice.time_of(end_frame) + self._config.verse_end_extension_s,
                lattice.time_of(limit),
            )
            previous_end = end_frame
            words: list[AlignedWord] = []
            for position, (word, (word_first, _last)) in enumerate(words_frames):
                start = lattice.time_of(first if position == 0 else word_first)
                # Dans un verset, un mot dure jusqu'au début du suivant (les blancs qui suivent
                # un symbole CTC appartiennent au son tenu) ; le dernier va jusqu'à la fin du
                # verset.
                following = position + 1 < len(words_frames)
                stop = lattice.time_of(words_frames[position + 1][1][0]) if following else end
                words.append(AlignedWord(span.ref, word, TimeSpan(start, stop)))
            result.append(
                AlignedSpan(
                    span=span, time=TimeSpan(words[0].time.start_s, end), words=tuple(words)
                )
            )
        return tuple(result)

    def _voiced(
        self,
        lattice: CtcLattice,
        first: int,
        last: int,
        room: tuple[int, int],
        bounds: tuple[int, int],
    ) -> tuple[int, int]:
        """Trames [début, fin exclue] d'un verset, ajustées à sa voix par l'énergie.

        Un CTC émet ses symboles tôt (le son tenu part dans les blancs) et peut en poser un sur le
        silence voisin. La voix s'arrête où la RMS passe sous `energy_ratio` × la RMS maximale des
        symboles du verset : on étend jusque-là dans `room` (fin du verset précédent, début du
        suivant), ou on recule jusqu'à la dernière trame voisée, sans retirer son premier symbole
        au premier ou au dernier mot (`bounds` : début au plus tard, fin au plus tôt)."""
        rms, ratio = lattice.frame_rms, self._config.energy_ratio
        end = last + 1
        if rms is None or ratio is None:
            return first, end
        floor, limit = room
        latest_start, earliest_end = bounds
        threshold = ratio * max(rms[first : last + 1])
        while end < limit and rms[end] >= threshold:
            end += 1
        while end > earliest_end and rms[end - 1] < threshold:
            end -= 1
        while first - 1 >= floor and rms[first - 1] >= threshold:
            first -= 1
        while first < latest_start and rms[first] < threshold:
            first += 1
        return first, end
