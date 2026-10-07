"""Décodage contraint au corpus : preuve acoustique d'un texte candidat (ADR-0005).

Le matcher (B6) propose des versets à partir du TEXTE libre de l'ASR ; ce module vérifie, sur le
treillis CTC (log-probabilités par trame), que l'**audio** soutient bien le texte du corpus :
- `forced_logprob` : meilleur chemin CTC contraint à produire EXACTEMENT le texte candidat (le
  chemin « Coran exact ») ;
- `free_logprob` : meilleur chemin non contraint (somme des maxima par trame), borne supérieure
  qui joue le rôle du **chemin « poubelle »** : si la parole est autre chose que le candidat, le
  chemin libre est bien meilleur que le chemin contraint ;
- `llr_per_frame = (forced - free) / trames` ≤ 0 : proche de 0, l'audio soutient le candidat ; très
  négatif, le texte candidat n'explique pas l'audio (hallucination de l'ASR, parole non coranique).

Pur Python (aucune dépendance) : testable sans GPU. Le seuil de la porte est une CONFIGURATION
(`AcousticGate.min_llr_per_frame`, désactivée par défaut) à calibrer sur des annotations humaines
(phase 6) ; rien n'est mesuré sur de l'audio réel tant que le modèle CTC n'a pas tourné.
L'alignement forcé donne aussi les trames de chaque symbole (temps de mots).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from aqr.domain.ports import Candidate

LogProbs = Sequence[Sequence[float]]  # [trame][symbole], log-probabilités normalisées


@dataclass(frozen=True)
class CtcEvidence:
    forced_logprob: float
    free_logprob: float
    llr_per_frame: float
    frames: int


@dataclass(frozen=True)
class AcousticGate:
    min_llr_per_frame: float | None = None
    """Seuil sur `llr_per_frame` (négatif). None = porte désactivée : rien n'est filtré."""

    def accepts(self, evidence: CtcEvidence) -> bool:
        if self.min_llr_per_frame is None:
            return True
        return evidence.llr_per_frame >= self.min_llr_per_frame


def _validate(log_probs: LogProbs, labels: Sequence[int], blank: int) -> int:
    if not log_probs:
        raise ValueError("aucune trame")
    if not labels:
        raise ValueError("texte candidat vide")
    vocab = len(log_probs[0])
    for symbol in (*labels, blank):
        if not 0 <= symbol < vocab:
            raise ValueError(f"symbole hors du vocabulaire : {symbol} (taille {vocab})")
    return vocab


def ctc_free_logprob(log_probs: LogProbs) -> float:
    """Meilleur chemin sans contrainte : somme des maxima par trame."""
    return sum(max(frame) for frame in log_probs)


def ctc_forced_align(
    log_probs: LogProbs, labels: Sequence[int], blank: int
) -> tuple[float, list[tuple[int, int]]]:
    """Viterbi CTC contraint à `labels`. Renvoie (log-vraisemblance, intervalle de trames
    [début, fin] par symbole) ; (-inf, []) si le texte ne tient pas dans les trames."""
    _validate(log_probs, labels, blank)
    extended = [blank]
    for symbol in labels:
        extended += [symbol, blank]
    states, frames = len(extended), len(log_probs)
    neg = -math.inf
    score = [[neg] * states for _ in range(frames)]
    back = [[0] * states for _ in range(frames)]
    score[0][0] = log_probs[0][extended[0]]
    if states > 1:
        score[0][1] = log_probs[0][extended[1]]
    for t in range(1, frames):
        for s in range(states):
            candidates = [(score[t - 1][s], s)]
            if s >= 1:
                candidates.append((score[t - 1][s - 1], s - 1))
            if s >= 2 and extended[s] != blank and extended[s] != extended[s - 2]:
                candidates.append((score[t - 1][s - 2], s - 2))
            best, source = max(candidates, key=lambda c: c[0])
            if best > neg:
                score[t][s] = best + log_probs[t][extended[s]]
                back[t][s] = source
    end = max((states - 1, states - 2), key=lambda s: score[frames - 1][s] if s >= 0 else neg)
    final = score[frames - 1][end]
    if final == neg:
        return neg, []
    first: dict[int, int] = {}
    last: dict[int, int] = {}
    state = end
    for t in range(frames - 1, -1, -1):
        if extended[state] != blank:
            index = (state - 1) // 2
            first[index] = t
            last.setdefault(index, t)
        state = back[t][state]
    return final, [(first[i], last[i]) for i in range(len(labels))]


def acoustic_support(log_probs: LogProbs, labels: Sequence[int], blank: int) -> CtcEvidence:
    forced, _spans = ctc_forced_align(log_probs, labels, blank)
    free = ctc_free_logprob(log_probs)
    frames = len(log_probs)
    llr = -math.inf if forced == -math.inf else (forced - free) / frames
    return CtcEvidence(forced_logprob=forced, free_logprob=free, llr_per_frame=llr, frames=frames)


def verify_candidates(
    candidates: Sequence[Candidate],
    log_probs: LogProbs,
    blank: int,
    candidate_text: Callable[[Candidate], str],
    encode: Callable[[str], Sequence[int]],
    gate: AcousticGate,
) -> list[tuple[Candidate, CtcEvidence]]:
    """Garde les candidats que l'audio soutient (porte configurée), avec leur preuve.

    `candidate_text` rend le texte du CORPUS couvert par le candidat (jamais une sortie d'ASR) ;
    `encode` le convertit en symboles du modèle CTC. Un candidat dont le texte ne tient pas dans le
    treillis (preuve -inf) est écarté dès que la porte est active ; avec la porte désactivée, la
    preuve est seulement jointe (observabilité), rien n'est filtré."""
    kept: list[tuple[Candidate, CtcEvidence]] = []
    for candidate in candidates:
        evidence = acoustic_support(log_probs, list(encode(candidate_text(candidate))), blank)
        if gate.accepts(evidence):
            kept.append((candidate, evidence))
    return kept
