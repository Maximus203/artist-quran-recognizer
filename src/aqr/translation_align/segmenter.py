"""Découpage d'un verset : associe chaque proposition française à une plage de mots arabes.

Principe (déterministe, sans modèle génératif) : les propositions françaises candidates
(`clauses.py`) sont placées dans l'ordre sur les mots arabes par programmation dynamique ; le
score d'une proposition sur une plage de mots est la vraisemblance IBM-1 de ses mots (arabe ->
français) ajoutée à celle des mots arabes de la plage (français -> arabe), avec un bonus pour une
frontière après un signe de pause du Mushaf. Un passage avant-arrière donne la probabilité a
posteriori de chaque frontière.

Précision d'abord : une frontière n'est gardée que si sa place exacte est quasi certaine ET si
les trois lectures (avant seul, arrière seul, combinée) la placent au même endroit. Sinon les
deux propositions voisines fusionnent (la moins sûre d'abord) et le calcul recommence : le repli
est un segment plus large, jamais une frontière douteuse.
"""

from __future__ import annotations

import itertools
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import numpy as np
from numpy.typing import NDArray

from aqr.translation_align.config import TranslationAlignmentConfig
from aqr.translation_align.lexicon import NULL, AlignmentModels

Matrix = NDArray[np.float64]
_NEG_INF: Final = float("-inf")


@dataclass(frozen=True)
class VerseInput:
    arabic: Sequence[int]
    """Radicaux des mots du verset (identifiants), dans l'ordre."""
    waqf: Sequence[int]
    """Pour chaque mot : +1 pause autorisée après lui, -1 « لا », 0 sinon."""
    clauses: Sequence[Sequence[int]]
    """Mots français (identifiants) de chaque proposition candidate, dans l'ordre."""
    arabic_letters: Sequence[int]
    """Nombre de lettres de chaque mot arabe."""
    french_letters: Sequence[int]
    """Nombre de lettres de chaque proposition française candidate."""


@dataclass(frozen=True)
class Cut:
    boundary: int
    """Rang de la coupure candidate (entre la proposition `boundary` et la suivante)."""
    word: int
    """Premier mot arabe (1..N) du segment qui s'ouvre ici."""
    confidence: float


def _lse(x: Matrix, axis: int) -> Matrix:
    top = np.max(x, axis=axis, keepdims=True)
    top = np.where(np.isfinite(top), top, 0.0)
    with np.errstate(divide="ignore"):
        out = np.log(np.sum(np.exp(x - top), axis=axis)) + np.squeeze(top, axis=axis)
    return np.asarray(out, dtype=np.float64)


def boundary_posteriors(
    scores: Sequence[Matrix], bonus: Matrix, temperature: float
) -> list[Matrix] | None:
    """Probabilité a posteriori de la position de chaque frontière entre groupes consécutifs.

    `scores[k][i, j]` : score du groupe k couvrant les mots (i, j] ; `bonus[j]` : bonus d'une
    frontière après le mot j. None si aucun placement n'est possible."""
    groups = len(scores)
    size = scores[0].shape[0]
    last = size - 1
    scaled = [s / temperature for s in scores]
    alpha = [np.full(size, _NEG_INF)]
    alpha[0][0] = 0.0
    for k in range(groups):
        reached = _lse(alpha[k][:, None] + scaled[k], axis=0)
        alpha.append(reached + bonus if k < groups - 1 else reached)
    log_z = alpha[groups][last]
    if not np.isfinite(log_z):
        return None
    beta = [np.full(size, _NEG_INF) for _ in range(groups + 1)]
    beta[groups][last] = 0.0
    for k in range(groups - 1, -1, -1):
        gain = bonus if k < groups - 1 else np.zeros(size)
        beta[k] = _lse(scaled[k] + (gain + beta[k + 1])[None, :], axis=1)
    return [np.exp(alpha[k + 1] + beta[k + 1] - log_z) for k in range(groups - 1)]


def locate(posterior: Matrix, tolerance: int) -> tuple[int, float]:
    """(place, confiance) d'une frontière : la place la plus probable, et la probabilité que la
    vraie frontière soit à `tolérance` mots près de celle-là."""
    place = int(np.argmax(posterior))
    mass = float(posterior[max(0, place - tolerance) : place + tolerance + 1].sum())
    return place, mass


class _Scorer:
    """Scores par groupe de propositions, calculés une fois par (première, dernière) proposition."""

    def __init__(
        self,
        verse: VerseInput,
        models: AlignmentModels,
        config: TranslationAlignmentConfig,
    ) -> None:
        self._config = config
        self._models = models
        forward, reverse = models.forward, models.reverse
        arabic = list(verse.arabic)
        self._n = len(arabic)
        french = [tok for clause in verse.clauses for tok in clause]
        self._row_start = [0]
        for clause in verse.clauses:
            self._row_start.append(self._row_start[-1] + len(clause))
        rows = len(french)
        self._fwd = np.empty((rows, self._n))
        self._fwd_null = np.empty(rows)
        self._rev = np.empty((rows, self._n))
        for r, f in enumerate(french):
            self._fwd_null[r] = forward.prob(NULL, f)
            for c, a in enumerate(arabic):
                self._fwd[r, c] = forward.prob(a, f)
                self._rev[r, c] = reverse.prob(f, a)
        self._rev_null = np.array([reverse.prob(NULL, a) for a in arabic])
        self._cache: dict[tuple[int, int], tuple[Matrix, Matrix, Matrix]] = {}
        self._letters = np.concatenate([[0.0], np.cumsum(np.asarray(verse.arabic_letters, float))])
        self._french_letters = np.concatenate(
            [[0.0], np.cumsum(np.asarray(verse.french_letters, float))]
        )
        size = self._n + 1
        self._width = np.arange(size)[None, :] - np.arange(size)[:, None]
        self._valid = self._width > 0

    def tokens(self, lo: int, hi: int) -> int:
        return self._row_start[hi + 1] - self._row_start[lo]

    def group(self, lo: int, hi: int) -> tuple[Matrix, Matrix, Matrix]:
        """(avant, arrière, longueur) : scores des mots (i, j] pour les propositions lo..hi."""
        key = (lo, hi)
        if key not in self._cache:
            self._cache[key] = (self._forward(lo, hi), self._reverse(lo, hi), self._length(lo, hi))
        return self._cache[key]

    def _length(self, lo: int, hi: int) -> Matrix:
        """Écart de longueur gaussien (Gale et Church) entre la proposition et la plage de mots."""
        arabic = self._letters[None, :] - self._letters[:, None]
        french = self._french_letters[hi + 1] - self._french_letters[lo]
        arabic = np.where(self._valid, arabic, 1.0)
        variance = self._models.length_variance * arabic
        delta = (french - self._models.length_ratio * arabic) ** 2 / variance
        score = -0.5 * delta - 0.5 * np.log(variance)
        return np.where(self._valid, score, 0.0)

    def _forward(self, lo: int, hi: int) -> Matrix:
        cfg = self._config
        a, b = self._row_start[lo], self._row_start[hi + 1]
        size = self._n + 1
        cumulative = np.zeros((b - a, size))
        cumulative[:, 1:] = np.cumsum(self._fwd[a:b], axis=1)
        span = cumulative[:, None, :] - cumulative[:, :, None]
        mean = span / np.where(self._valid, self._width, 1)
        p = cfg.null_weight * self._fwd_null[a:b, None, None] + (1 - cfg.null_weight) * mean
        score = np.log(np.maximum(p, cfg.prob_floor)).sum(axis=0)
        return np.where(self._valid, score, 0.0)

    def _reverse(self, lo: int, hi: int) -> Matrix:
        cfg = self._config
        a, b = self._row_start[lo], self._row_start[hi + 1]
        mean = self._rev[a:b].mean(axis=0)
        p = cfg.null_weight * self._rev_null + (1 - cfg.null_weight) * mean
        logp = np.log(np.maximum(p, cfg.prob_floor))
        prefix = np.concatenate([[0.0], np.cumsum(logp)])
        score = prefix[None, :] - prefix[:, None]
        return np.where(self._valid, score, 0.0)

    def masked(self, score: Matrix) -> Matrix:
        """Score combiné : -inf là où la plage de mots est vide ou à l'envers."""
        return np.where(self._valid, score, _NEG_INF)


def segment_verse(
    verse: VerseInput, models: AlignmentModels, config: TranslationAlignmentConfig
) -> list[Cut]:
    """Coupures retenues d'un verset (liste vide : un seul segment, repli sur le verset)."""
    n = len(verse.arabic)
    clause_count = len(verse.clauses)
    if clause_count < 2 or n < 2 or not any(verse.clauses):
        return []
    scorer = _Scorer(verse, models, config)
    bonus = np.zeros(n + 1)
    for j in range(1, n):
        bonus[j] = config.waqf_bonus * verse.waqf[j - 1] + config.prior_weight * models.prior.score(
            verse.arabic, j
        )
    active = list(range(clause_count - 1))  # coupures candidates encore ouvertes
    while active:
        edges = [-1, *active, clause_count - 1]
        groups = [(edges[g] + 1, edges[g + 1]) for g in range(len(edges) - 1)]
        if len(groups) > n:
            # plus de propositions que de mots arabes : la plus petite fusionne avec une voisine
            smallest = min(range(len(groups)), key=lambda g: scorer.tokens(*groups[g]))
            active.pop(smallest if smallest < len(active) else smallest - 1)
            continue
        scored = [scorer.group(lo, hi) for lo, hi in groups]
        wf, wr, wl = config.forward_weight, config.reverse_weight, config.length_weight
        combined = [scorer.masked(wf * f + wr * r + wl * ln) for f, r, ln in scored]
        main = boundary_posteriors(combined, bonus, config.temperature)
        if main is None:
            return []
        tol = config.position_tolerance
        located = [locate(p, tol) for p in main]
        place = [b for b, _c in located]
        confidence = [c for _b, c in located]
        agree = [True] * len(main)
        if config.require_direction_agreement:
            for variant in (
                [scorer.masked(wf * f + wl * ln) for f, _r, ln in scored],
                [scorer.masked(wr * r + wl * ln) for _f, r, ln in scored],
            ):
                other = boundary_posteriors(variant, bonus, config.temperature)
                if other is None:
                    agree = [False] * len(main)
                    break
                agree = [
                    ok and abs(locate(o, tol)[0] - p) <= tol
                    for ok, o, p in zip(agree, other, place, strict=True)
                ]
        weak = [
            g
            for g in range(len(main))
            if confidence[g] < config.min_boundary_confidence or not agree[g]
        ]
        if not weak and all(a < b for a, b in itertools.pairwise(place)):
            return [
                Cut(boundary=active[g], word=place[g] + 1, confidence=confidence[g])
                for g in range(len(main))
            ]
        victim = min(weak or range(len(main)), key=lambda g: confidence[g])
        active.pop(victim)
    return []
