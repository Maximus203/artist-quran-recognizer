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
le soutient ; sinon il garde les bords de sa fenêtre. Les temps sont donnés mot par mot
(`Candidate.word_times`, ADR-0010) : le temps d'une plage est celui de son premier mot au dernier.

Un verset commencé est toujours récité jusqu'au bout (le récitant peut respirer, ou reprendre
quelques mots en arrière). Après un candidat retenu dont la plage s'arrête avant la fin du verset,
la SUITE attendue (reste du verset, reprise possible, puis versets suivants) est alignée, fin libre,
sur la fenêtre suivante si elle n'a rien de retenu. Deux témoins sont exigés : l'audio (preuve de
l'alignement) ET la transcription de la fenêtre (similarité avec le texte aligné) — l'audio seul
laisse passer un mot de fin de verset sur de la parole non coranique, que le modèle rend surtout en
blancs (mesuré, lot1-04). Soutenue par les deux, la suite devient un candidat avec ses mots et ses
temps ; sinon rien n'est nommé. Le texte aligné vient du corpus (I1), jamais
de l'ASR ; aucun verset n'est inventé : seuls des candidats du matcher sont promus.
"""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass, replace
from difflib import SequenceMatcher
from typing import Protocol

from aqr.alignment.forced import (
    AlignedWord,
    AlignmentConfig,
    PassageAligner,
    PassageAlignment,
    emittable_encoder,
)
from aqr.corpus.alignment_text import AlignmentTexts, recited_span
from aqr.corpus.normalize import normalize_arabic
from aqr.decoding.chains import (
    Chain,
    ChainConfig,
    Observation,
    chain_spans,
    find_chains,
    recited_start,
)
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
    continuation: bool = True
    """Prédire puis vérifier la suite d'un verset commencé dans la fenêtre suivante."""
    continuation_reprise_words: int = 3
    """Mots que le récitant peut reprendre en arrière avant de continuer (i'ada). Provisoire."""
    continuation_min_text_similarity: float = 0.6
    """Similarité (Dice des lettres normalisées) exigée entre la transcription de la fenêtre et le
    texte aligné. Provisoire : 0,6 écarte toutes les fausses suites relevées sur le lot 1 dev
    (2026-10-20), au prix de quelques reprises mal transcrites."""
    head: bool = True
    """Prédire puis vérifier le DÉBUT d'un verset dont la suite est reconnue (ADR-0010) : le
    récitant commence, fait une pause, continue ; la fenêtre d'avant la pause reste muette."""
    continuation_following_verses: int = 1
    """Versets suivants ajoutés au texte attendu (le reste du verset peut finir tôt dans la
    fenêtre) ; l'alignement à fin libre dit jusqu'où l'audio va."""


@dataclass(frozen=True)
class ChainCheck:
    """Trace d'une vérification : le passage, le texte du corpus aligné, la preuve, la décision."""

    time: TimeSpan
    spans: tuple[WordSpan, ...]
    llr_per_frame: float | None
    """None : le texte ne tient pas dans le passage (trop de symboles pour ses trames)."""
    accepted: bool
    kind: str = "chain"
    """`chain` : suite de versets vérifiée ; `continuation` : suite d'un verset commencé ;
    `neighbor` : détection `uncertain` qui prolonge un verset reconnu voisin ; `head` : début
    d'un verset dont la suite est reconnue (ADR-0010)."""
    text_similarity: float | None = None
    """Suite d'un verset : similarité entre la transcription de la fenêtre et le texte aligné."""


Link = tuple[int, int]

_EDGE_S = 0.001
"""Durée d'un mot que l'alignement place hors de la fenêtre et qu'on ramène à son bord."""


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
        self._aligner = PassageAligner(texts, emittable_encoder(model), alignment)
        self._max_passage_s = max_passage_s
        self._floor = floor
        self._lattices: dict[TimeSpan, CtcLattice] = {}

    @property
    def engine(self) -> str:
        return self._model.engine

    @property
    def config(self) -> AcousticCheckConfig:
        return self._config

    @property
    def threshold(self) -> float:
        return self._threshold

    def supports(
        self, clip: AudioClip, window: TimeSpan, spans: Sequence[WordSpan]
    ) -> float | None:
        """Preuve qu'apporte l'audio de la fenêtre au texte du corpus de `spans` (arbitre de la
        cascade) ; None si le texte ne tient pas dans la fenêtre."""
        result = self._aligner.align(self._lattice(clip, window), list(spans))
        return None if result is None else result.evidence.llr_per_frame

    def verify_alone(
        self, clip: AudioClip, window: TimeSpan, candidate: Candidate
    ) -> tuple[ChainCheck, Candidate | None]:
        """Un candidat de la fenêtre, soutenu ou non par l'audio (promotion par le voisin reconnu,
        ADR-0010). Soutenu (même seuil que toute suite) : le candidat prend au moins le seuil du
        décodeur, avec les mots et les temps de l'alignement du texte du corpus (I1) ; sinon None,
        rien n'est promu (I3)."""
        result = self._aligner.align(self._lattice(clip, window), list(candidate.spans))
        llr = None if result is None else result.evidence.llr_per_frame
        accepted = result is not None and llr is not None and llr >= self._threshold
        check = ChainCheck(window, candidate.spans, llr, accepted, kind="neighbor")
        if not accepted or result is None:
            return check, None
        confirmed = replace(
            candidate, score=max(candidate.score, candidate.quality or 0.0, self._floor)
        )
        if not self._config.word_times:
            return check, confirmed
        return check, _with_words(confirmed, [w for a in result.spans for w in a.words], window)

    def verify(
        self,
        clip: AudioClip,
        observations: Sequence[Observation],
        blocked: Collection[int] = (),
        heard: Sequence[str] | None = None,
    ) -> tuple[list[Observation], tuple[ChainCheck, ...]]:
        """Observations (avant toute promotion) -> observations décidées, et la trace. `blocked` :
        fenêtres non coraniques (formules) qu'aucune suite ne peut occuper ; `heard` : transcription
        de chaque fenêtre, second témoin de la suite d'un verset (sans elle, aucune suite)."""
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
        if self._config.continuation and heard is not None:
            checks.extend(self._continue(clip, out, set(blocked), heard))
        if self._config.head and heard is not None:
            checks.extend(self._precede(clip, out, set(blocked), heard))
        return out, tuple(checks)

    # -- Début d'un verset dont la suite est reconnue ---------------------------------------------
    def _precede(
        self,
        clip: AudioClip,
        observations: list[Observation],
        blocked: set[int],
        heard: Sequence[str],
    ) -> list[ChainCheck]:
        """Fenêtre sans verset retenu JUSTE AVANT un candidat retenu qui ne commence pas son
        verset : le début manquant (récitant qui s'arrête au milieu du verset) est prédit puis
        vérifié sur l'audio ET la transcription de la fenêtre, comme la suite d'un verset commencé.
        Sans soutien (autre riwaya, parole non coranique), l'abstention reste."""
        checks: list[ChainCheck] = []
        for i in range(1, len(observations)):
            prior = i - 1
            window, candidates = observations[prior]
            if prior in blocked or any(c.score >= self._floor for c in candidates):
                continue
            found: list[Candidate] = []
            for candidate in observations[i][1]:
                first = candidate.span
                if candidate.score < self._floor or first.first_word <= recited_start(first.ref):
                    continue
                before = self._known_before(observations, prior, first)
                check, head = self._head(clip, window, first, before, heard[prior])
                if check is not None:
                    checks.append(check)
                if head is not None:
                    found.append(head)
            if found:
                observations[prior] = (window, [*found, *candidates])
        return checks

    def _known_before(
        self, observations: Sequence[Observation], prior: int, after: WordSpan
    ) -> int:
        """Dernier mot du même verset déjà retenu dans la fenêtre qui précède celle à prédire (le
        trou est alors au milieu du verset, pas à son début) ; 0 s'il n'y en a pas."""
        if prior < 1:
            return 0
        lasts = [
            c.spans[-1].last_word
            for c in observations[prior - 1][1]
            if c.score >= self._floor
            and c.spans[-1].ref == after.ref
            and c.spans[-1].last_word < after.first_word
        ]
        return max(lasts, default=0)

    def _head(
        self, clip: AudioClip, window: TimeSpan, begun: WordSpan, known: int, heard: str
    ) -> tuple[ChainCheck | None, Candidate | None]:
        """Le début du verset (ou, si `known` mots en sont déjà retenus dans la fenêtre d'avant, le
        trou qui sépare les deux morceaux), repris de `continuation_reprise_words` mots en arrière
        et poussé jusqu'à autant de mots après la coupure : la suite peut les reprendre. Aligné,
        fin libre, sur la fenêtre. Il doit atteindre le mot qui précède la suite (à `word_slack`
        près) : sinon le milieu du verset n'a aucune preuve."""
        total = len(self._corpus.words(begun.ref))
        reprise = self._config.continuation_reprise_words
        first = recited_start(begun.ref)
        end = min(total, begun.first_word - 1 + reprise)
        starts = [first]
        if known:  # le récitant a pu reprendre quelques mots avant la coupure : le meilleur départ
            starts = list(range(known + 1, max(first, known + 1 - reprise) - 1, -1))
        lattice = self._lattice(clip, window)
        best: tuple[float, PassageAlignment, WordSpan] | None = None
        for start in (s for s in starts if s <= end):
            span = WordSpan(begun.ref, start, end)
            tried = self._aligner.align(lattice, [span], free_end=True)
            if tried is not None and (best is None or tried.evidence.llr_per_frame > best[0]):
                best = (tried.evidence.llr_per_frame, tried, span)
        if best is None:
            if all(s > end for s in starts):
                return None, None
            return ChainCheck(
                window, (WordSpan(begun.ref, starts[-1], end),), None, False, kind="head"
            ), None
        _llr, result, _span = best
        aligned = tuple(a.span for a in result.spans if isinstance(a.span, WordSpan))
        llr = result.evidence.llr_per_frame
        similarity = self._similarity(aligned, heard)
        reaches = aligned[-1].last_word >= begun.first_word - 1 - self._chain.word_slack
        accepted = (
            reaches
            and llr >= self._threshold
            and similarity >= self._config.continuation_min_text_similarity
        )
        check = ChainCheck(window, aligned, llr, accepted, "head", round(similarity, 4))
        if not accepted:
            return check, None
        words = [w for a in result.spans for w in a.words]
        seed = Candidate(span=aligned[0], score=self._floor, explained=float(len(words)))
        if not self._config.word_times:
            return check, seed
        return check, _with_words(seed, words, window)

    # -- Suite d'un verset commencé ---------------------------------------------------------------
    def _continue(
        self,
        clip: AudioClip,
        observations: list[Observation],
        blocked: set[int],
        heard: Sequence[str],
    ) -> list[ChainCheck]:
        """De fenêtre en fenêtre (une suite acceptée peut elle-même finir avant la fin d'un verset,
        le récitant ayant repris son souffle)."""
        checks: list[ChainCheck] = []
        for i in range(len(observations) - 1):
            following = i + 1
            window, candidates = observations[following]
            if following in blocked or any(c.score >= self._floor for c in candidates):
                continue
            found: list[Candidate] = []
            for candidate in observations[i][1]:
                last = candidate.spans[-1]
                if candidate.score < self._floor or last.last_word >= len(
                    self._corpus.words(last.ref)
                ):
                    continue
                check, rest = self._rest(clip, window, last, heard[following])
                checks.append(check)
                if rest is not None:
                    found.append(rest)
            if found:
                observations[following] = (window, [*found, *candidates])
        return checks

    def _rest(
        self, clip: AudioClip, window: TimeSpan, begun: WordSpan, heard: str
    ) -> tuple[ChainCheck, Candidate | None]:
        """Meilleure suite (départ avec ou sans reprise) alignée à fin libre sur la fenêtre."""
        lattice = self._lattice(clip, window)
        total = len(self._corpus.words(begun.ref))
        following: list[WordSpan] = []
        ref = begun.ref.next()
        while ref is not None and len(following) < self._config.continuation_following_verses:
            following.append(recited_span(ref, len(self._corpus.words(ref))))
            ref = ref.next()
        best: tuple[float, PassageAlignment] | None = None
        earliest = max(1, begun.last_word + 1 - self._config.continuation_reprise_words)
        for start in range(begun.last_word + 1, earliest - 1, -1):
            spans = [WordSpan(begun.ref, start, total), *following]
            result = self._aligner.align(lattice, spans, free_end=True)
            if result is not None and (best is None or result.evidence.llr_per_frame > best[0]):
                best = (result.evidence.llr_per_frame, result)
        if best is None:
            rest = (WordSpan(begun.ref, begun.last_word + 1, total),)
            return ChainCheck(window, rest, None, False, kind="continuation"), None
        llr, result = best
        aligned = tuple(a.span for a in result.spans if isinstance(a.span, WordSpan))
        similarity = self._similarity(aligned, heard)
        accepted = llr >= self._threshold and (
            similarity >= self._config.continuation_min_text_similarity
        )
        check = ChainCheck(window, aligned, llr, accepted, "continuation", round(similarity, 4))
        if not accepted:
            return check, None
        words = [w for a in result.spans for w in a.words]
        seed = Candidate(span=aligned[0], score=self._floor, explained=float(len(words)))
        if not self._config.word_times:
            return check, replace(seed, continuation=aligned[1:])
        return check, _with_words(seed, words, window)

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

    def _similarity(self, spans: Sequence[WordSpan], heard: str) -> float:
        """Dice des lettres normalisées (sans espaces) : symétrique, une transcription faite
        d'autre chose que le texte aligné le fait baisser autant qu'un texte absent."""
        expected = "".join(
            normalize_arabic(word).replace(" ", "")
            for span in spans
            for word in self._corpus.words(span.ref)[span.first_word - 1 : span.last_word]
        )
        got = normalize_arabic(heard).replace(" ", "")
        if not expected or not got:
            return 0.0
        return SequenceMatcher(None, expected, got, autojunk=False).ratio()

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
        words = tuple(tuple(w.time for w in aligned.words) for aligned in result.spans)
        complete = all(
            len(group) == span.last_word - span.first_word + 1
            for group, span in zip(words, candidate.spans, strict=True)
        )
        return replace(
            candidate,
            times=tuple(aligned.time for aligned in result.spans),
            word_times=words if complete else (),
        )


def _with_words(candidate: Candidate, words: Sequence[AlignedWord], window: TimeSpan) -> Candidate:
    """Le candidat réduit aux mots alignés dans sa fenêtre, une plage (et son temps) par verset.

    Le temps reste dans la fenêtre : au-delà, le segmenteur n'a pas entendu de voix (l'énergie
    d'une pause ou d'une respiration prolongeait sinon la fin jusqu'au verset suivant : +2,7 s
    mesurés sur EveryAyah, Husary 67:4). Le temps de chaque mot est borné de la même façon, si bien
    que le temps d'une plage est exactement celui de son premier mot au dernier (ADR-0010)."""
    groups: list[list[AlignedWord]] = []
    for word in words:
        if groups and groups[-1][0].ref == word.ref:
            groups[-1].append(word)
        else:
            groups.append([word])
    spans: list[WordSpan] = []
    times: list[TimeSpan] = []
    per_word: list[tuple[TimeSpan, ...]] = []
    complete = True
    for group in groups:
        ref = group[0].ref
        assert ref is not None  # une suite ne contient que des versets
        spans.append(WordSpan(ref, group[0].word, group[-1].word))
        inside = _within(group, window)
        times.append(TimeSpan(inside[0].start_s, inside[-1].end_s))
        per_word.append(tuple(inside))
        complete = complete and [w.word for w in group] == list(
            range(group[0].word, group[-1].word + 1)
        )
    return replace(
        candidate,
        span=spans[0],
        continuation=tuple(spans[1:]),
        query_counts=(),
        times=tuple(times),
        word_times=tuple(per_word) if complete else (),
    )


def _within(group: Sequence[AlignedWord], window: TimeSpan) -> list[TimeSpan]:
    """Temps des mots d'un verset bornés à la fenêtre. Un mot entièrement hors de la fenêtre y est
    ramené à son bord (durée `_EDGE_S`) ; si tous le sont, le temps de l'alignement fait foi."""
    clamped = [
        (max(w.time.start_s, window.start_s), min(w.time.end_s, window.end_s)) for w in group
    ]
    if all(end <= start for start, end in clamped):
        return [w.time for w in group]
    out: list[TimeSpan] = []
    for w, (start, end) in zip(group, clamped, strict=True):
        if end > start:
            out.append(TimeSpan(start, end))
        elif w.time.start_s >= window.end_s:
            out.append(TimeSpan(window.end_s - _EDGE_S, window.end_s))
        else:
            out.append(TimeSpan(window.start_s, window.start_s + _EDGE_S))
    return out
