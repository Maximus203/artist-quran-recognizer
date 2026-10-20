"""Vérification ACOUSTIQUE des suites de versets, et temps au mot (étape B, ADR-0008).

La preuve par la suite (ADR-0007) ne lit que le texte de l'ASR : un maillon mal transcrit la coupe
(Muno ampute « عَلَّمَ » en « لَّمَ » au début d'une fenêtre : 55:2 [2-2], qualité 0,5), et une suite
dont le texte se tient est promue sans que l'audio ait été consulté. Ici, chaque suite candidate —
celles que le texte prouve, et celles dont un maillon descend jusqu'à `rescue_min_quality` — est
vérifiée en alignant le TEXTE DU CORPUS de la suite (versets intermédiaires entiers, mots perdus aux
bords des fenêtres compris) sur le treillis CTC de ses fenêtres (`PassageAligner`, ADR-0006) :

- acceptée (`llr_per_frame` ≥ `min_llr_per_frame`) : chaque maillon reçoit sa qualité pour score, au
  moins le seuil du décodeur (`floor`) ; ses mots et leurs temps sont ceux de l'alignement ;
- refusée : aucun maillon n'est promu, même si le texte prouvait la suite (I3) ; un candidat garde
  toujours au moins le score que le matcher lui a donné seul.

Un verset prouvé seul (une fenêtre, assez de mots) reçoit aussi les temps de l'alignement si l'audio
le soutient ; sinon il garde les bords de sa fenêtre. Le texte aligné vient du corpus (I1), jamais
de l'ASR ; aucun verset n'est inventé : seuls des candidats du matcher sont promus.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Protocol

from aqr.alignment.forced import AlignedWord, AlignmentConfig, PassageAligner, PassageAlignment
from aqr.corpus.alignment_text import AlignmentTexts
from aqr.decoding.chains import Chain, ChainConfig, Observation, chain_spans, find_chains
from aqr.domain.models import TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import AudioClip, Candidate, CtcAcousticModel, CtcLattice


@dataclass(frozen=True)
class AcousticCheckConfig:
    min_llr_per_frame: float | None = -1.0
    """Preuve exigée d'une suite (chemin contraint au texte du corpus contre chemin libre, par
    trame). None = vérification désactivée : la preuve textuelle d'ADR-0007 décide seule.
    Provisoire : mesuré le 2026-10-19 (vraies suites −0,1 à −0,5, suite décalée d'un verset
    −1,5 à −3,8), à calibrer sur les annotations de l'étape A."""
    rescue_min_quality: float = 0.5
    """Qualité minimale d'un maillon admis dans une suite À VÉRIFIER (le texte seul exige 0,75) :
    un mot amputé par l'ASR (« لَّمَ » pour « عَلَّمَ ») vaut 0,5. Seul l'audio peut le sauver."""
    word_times: bool = True
    """Temps et mots des versets reconnus pris dans l'alignement (sinon : bords des fenêtres)."""


@dataclass(frozen=True)
class ChainCheck:
    """Trace d'une vérification : le passage, le texte du corpus aligné, la preuve, la décision."""

    time: TimeSpan
    spans: tuple[WordSpan, ...]
    llr_per_frame: float | None
    """None : le texte ne tient pas dans le passage (trop de symboles pour ses trames)."""
    accepted: bool


Link = tuple[int, int]


class _Words(Protocol):
    def words(self, ref: VerseRef) -> tuple[str, ...]: ...


class AcousticVerifier:
    def __init__(
        self,
        *,
        model: CtcAcousticModel,
        texts: AlignmentTexts,
        corpus: _Words,
        chain: ChainConfig,
        config: AcousticCheckConfig,
        alignment: AlignmentConfig,
        max_passage_s: float,
        floor: float,
    ) -> None:
        if config.min_llr_per_frame is None:
            raise ValueError("vérification acoustique désactivée (min_llr_per_frame=None)")
        self._model, self._corpus = model, corpus
        self._chain, self._config = chain, config
        self._threshold = config.min_llr_per_frame
        self._aligner = PassageAligner(texts, model.encode, alignment)
        self._max_passage_s = max_passage_s
        self._floor = floor
        self._lattices: dict[TimeSpan, CtcLattice] = {}

    @property
    def engine(self) -> str:
        return self._model.engine

    @property
    def config(self) -> AcousticCheckConfig:
        return self._config

    def verify(
        self, clip: AudioClip, observations: Sequence[Observation]
    ) -> tuple[list[Observation], tuple[ChainCheck, ...]]:
        """Observations (avant toute promotion) -> observations décidées, et la trace."""
        self._lattices = {}  # un treillis par passage, partagé par ses candidats
        updated: dict[Link, Candidate] = {}
        checks: list[ChainCheck] = []
        for chain in self._chains(observations):
            for piece in self._pieces(chain, observations):
                check, accepted = self._check(clip, piece, observations)
                checks.append(check)
                for link, candidate in accepted.items():
                    updated.setdefault(link, candidate)
        out: list[Observation] = []
        for i, (time, candidates) in enumerate(observations):
            decided = [updated.get((i, k), c) for k, c in enumerate(candidates)]
            if self._config.word_times:
                decided = [self._timed(clip, time, c) for c in decided]
            out.append((time, decided))
        return out, tuple(checks)

    # -- Suites à vérifier ---------------------------------------------------------------------
    def _chains(self, observations: Sequence[Observation]) -> list[Chain]:
        """Suites au plancher de sauvetage, puis celles que le texte prouve : une suite longue
        refusée (un maillon faible faux) ne condamne pas la suite que le texte prouve en elle."""
        if not self._chain.enabled:
            return []
        seen: set[tuple[Link, ...]] = set()
        chains: list[Chain] = []
        for floor in (self._config.rescue_min_quality, self._chain.min_quality):
            for chain in find_chains(observations, self._corpus, self._chain, floor):
                if chain.links not in seen:
                    seen.add(chain.links)
                    chains.append(chain)
        return chains

    def _pieces(self, chain: Chain, observations: Sequence[Observation]) -> list[Chain]:
        """Passages consécutifs d'au plus `max_passage_s` (le treillis d'un seul tenant)."""
        pieces: list[list[Link]] = [[]]
        for link in chain.links:
            current = pieces[-1]
            start = observations[current[0][0]][0].start_s if current else None
            if start is not None and observations[link[0]][0].end_s - start > self._max_passage_s:
                pieces.append([])
            pieces[-1].append(link)
        return [Chain(tuple(p), sum(observations[i][1][k].explained for i, k in p)) for p in pieces]

    def _check(
        self, clip: AudioClip, piece: Chain, observations: Sequence[Observation]
    ) -> tuple[ChainCheck, dict[Link, Candidate]]:
        spans = chain_spans(piece, observations, self._corpus)
        first, last = piece.links[0][0], piece.links[-1][0]
        passage = TimeSpan(observations[first][0].start_s, observations[last][0].end_s)
        result = self._aligner.align(self._lattice(clip, passage), spans)
        llr = None if result is None else result.evidence.llr_per_frame
        accepted = result is not None and llr is not None and llr >= self._threshold
        check = ChainCheck(passage, tuple(spans), llr, accepted)
        if not accepted or result is None:
            return check, {}
        return check, self._promoted(piece, observations, result)

    def _promoted(
        self, piece: Chain, observations: Sequence[Observation], result: PassageAlignment
    ) -> dict[Link, Candidate]:
        """Chaque maillon promu ; avec les temps au mot, il prend les mots que l'alignement a
        placés dans SA fenêtre (le plus proche si un mot tombe entre deux fenêtres)."""
        windows = [observations[i][0] for i, _k in piece.links]
        owned: list[list[AlignedWord]] = [[] for _ in piece.links]
        for aligned in result.spans:
            for word in aligned.words:
                middle = (word.time.start_s + word.time.end_s) / 2
                owner = min(
                    range(len(windows)),
                    key=lambda n: max(windows[n].start_s - middle, middle - windows[n].end_s, 0.0),
                )
                owned[owner].append(word)
        promoted: dict[Link, Candidate] = {}
        for (i, k), words in zip(piece.links, owned, strict=True):
            candidate = observations[i][1][k]
            if not words:
                continue  # l'audio de cette fenêtre n'appartient pas à la suite : pas de preuve
            score = max(candidate.score, candidate.quality or 0.0, self._floor)
            promoted[(i, k)] = replace(candidate, score=score)
            if self._config.word_times:
                promoted[(i, k)] = _with_words(promoted[(i, k)], words, observations[i][0])
        return promoted

    def _lattice(self, clip: AudioClip, passage: TimeSpan) -> CtcLattice:
        if passage not in self._lattices:
            self._lattices[passage] = self._model.lattice(clip, passage)
        return self._lattices[passage]

    # -- Temps au mot d'un verset prouvé seul ------------------------------------------------------
    def _timed(self, clip: AudioClip, window: TimeSpan, candidate: Candidate) -> Candidate:
        if candidate.times or candidate.score < self._floor:
            return candidate
        result = self._aligner.align(self._lattice(clip, window), list(candidate.spans))
        if result is None or result.evidence.llr_per_frame < self._threshold:
            return candidate
        return replace(candidate, times=tuple(aligned.time for aligned in result.spans))


def _with_words(candidate: Candidate, words: Sequence[AlignedWord], window: TimeSpan) -> Candidate:
    """Le candidat réduit aux mots alignés dans sa fenêtre, une plage (et son temps) par verset.

    Le temps reste dans la fenêtre : au-delà, le segmenteur n'a pas entendu de voix (l'énergie
    d'une pause ou d'une respiration prolongeait sinon la fin jusqu'au verset suivant : +2,7 s
    mesurés sur EveryAyah, Husary 67:4)."""
    groups: list[list[AlignedWord]] = []
    for word in words:
        if groups and groups[-1][0].ref == word.ref:
            groups[-1].append(word)
        else:
            groups.append([word])
    spans: list[WordSpan] = []
    times: list[TimeSpan] = []
    for group in groups:
        ref = group[0].ref
        assert ref is not None  # une suite ne contient que des versets
        spans.append(WordSpan(ref, group[0].word, group[-1].word))
        start = max(group[0].time.start_s, window.start_s)
        end = min(group[-1].time.end_s, window.end_s)
        if end <= start:  # mot placé hors de toute fenêtre : le temps de l'alignement fait foi
            start, end = group[0].time.start_s, group[-1].time.end_s
        times.append(TimeSpan(start, end))
    return replace(
        candidate, span=spans[0], continuation=tuple(spans[1:]), query_counts=(), times=tuple(times)
    )
