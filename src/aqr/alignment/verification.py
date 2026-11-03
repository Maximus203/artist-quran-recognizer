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

import math
from collections.abc import Collection, Sequence
from dataclasses import dataclass, replace
from difflib import SequenceMatcher
from typing import Protocol

from aqr.alignment.forced import (
    AlignedSpan,
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
from aqr.decoding.gaps import ROLE_CONTINUATION, ROLE_REPETITION, Hole, Hypothesis
from aqr.domain.models import Detection, Status, TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import AudioClip, Candidate, CtcAcousticModel, CtcLattice
from aqr.domain.word_timing import without_overlap


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
    gap: bool = True
    """Combler un trou entre deux versets reconnus par le texte que le contexte laisse attendre
    (ADR-0013). La preuve y est mesurée sur la seule parole alignée (`voiced_llr_per_frame`)."""
    gap_strong_llr_per_frame: float = -0.5
    """Preuve par trame (parole alignée) au-delà de laquelle l'audio se suffit presque à lui-même :
    il dispense de la transcription quand il n'y en a pas, et la rend moins exigeante quand elle est
    pauvre. Provisoire : mesuré le 2026-10-23 (docs/evaluation/comblement-de-trou-2026-10-23.md)."""
    gap_min_text_similarity: float = 0.6
    """Similarité exigée entre la transcription du trou et le texte aligné (comme les suites)."""
    gap_weak_text_similarity: float = 0.3
    """Similarité minimale quand l'audio est fort (`gap_strong_llr_per_frame`) : l'ASR comprend mal
    certains passages (lot3-04, 12:21 : 0,29 alors que le texte du corpus s'aligne bien)."""
    gap_min_speech_frames: int = 3
    """Trames où le modèle n'est pas à plus de 50 % sur le blanc : en dessous, le trou est muet."""
    gap_unwitnessed_max_words: int = 3
    """Mots au plus qu'on nomme sur l'audio seul, sans aucune transcription du trou (mot manquant
    d'un bord de verset). Au-delà, l'audio seul ne suffit pas (mesuré, lot1-04)."""
    gap_new_verse_min_words: int = 3
    """Mots minimaux d'un verset NOUVEAU que la suite d'un verset fini ferait nommer (le premier mot
    du verset d'après, sans contexte ni après lui : mesuré, 2:88 [1-1] et 11:91 [1-1]). En dessous,
    ce mot est écarté ; le reste de la suite est gardé."""
    gap_repetition_min_words: int = 3
    """Une répétition de moins de mots ne se distingue pas d'un bruit : jamais nommée."""
    extend: bool = True
    """Étendre de un à trois mots les bords d'un verset reconnu que l'audio contient (ADR-0013)."""
    extend_max_words: int = 3
    extend_anchor_words: int = 3
    """Mots du bord conservés dans la comparaison (le texte étendu et le texte reconnu se mesurent
    sur les mêmes trames : l'écart de preuve totale est un rapport de vraisemblance)."""
    extend_pad_s: float = 4.0
    """Audio examiné au-delà du bord reconnu (jamais au-delà du voisin)."""
    extend_min_gain_nats_per_word: float = 4.0
    """Gain de preuve totale exigé par mot ajouté. Un mot faux posé sur de la parole qui n'est
    pas la sienne gagne peu ; un mot dit gagne en moyenne bien davantage (2:87 mot 13 : +13 nats).
    Provisoire : mesuré le 2026-10-23 (docs/evaluation/comblement-de-trou-2026-10-23.md)."""
    gap_weak_word_llr_per_frame: float = -3.0
    """Preuve par trame au-dessous de laquelle UN mot n'est pas dans l'audio : la moyenne du passage
    ne le voit pas (un mot faux au bord d'une longue parole ne coûte presque rien par trame)."""
    gap_max_weak_fraction: float = 0.15
    """Part des mots d'un texte nommé qui peut être sans soutien (arrondie par défaut) : un verset
    parfaitement reconnu en compte un sur dix (prononciation, liaison : 2:87 [1-12], mot 6 à −4,8),
    un mot faux au bord d'un texte court, jamais. Provisoire : mesuré le 2026-10-23."""
    gap_variant_margin_nats: float = 2.0
    """Entre deux variantes compatibles d'un même texte (reprise de quelques mots), on garde celle
    qui explique le plus de mots tant que la preuve TOTALE du passage ne perd pas plus que cela
    (un mot absent coûte bien davantage)."""
    gap_decisive_nats: float = 3.0
    """Écart de preuve TOTALE (sur les mêmes trames : un rapport de vraisemblance) à partir duquel
    un texte en bat un autre : un concurrent qui explique mieux le trou met l'hypothèse en échec ;
    deux hypothèses différentes plus proches que cela ne se départagent pas (aucune nommée)."""


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
    d'un verset dont la suite est reconnue (ADR-0010) ; `gap` : hypothèse de texte pour un trou
    entre deux versets reconnus (ADR-0013, voir `role`)."""
    text_similarity: float | None = None
    """Suite d'un verset : similarité entre la transcription de la fenêtre et le texte aligné."""
    role: str | None = None
    """`kind="gap"` : rôle de l'hypothèse (`head`, `between`, `continuation`, `repetition`) ou
    `competitor` (texte que le matcher avait vu dans le trou, évalué pour départager)."""
    words: int = 0
    """`kind="gap"` : mots du corpus effectivement alignés."""
    passage_llr_per_frame: float | None = None
    """`kind="gap"` : preuve par trame de TOUT le passage (diluée par les blancs). `llr_per_frame`
    est alors la preuve sur la seule parole alignée, celle qui décide."""
    weak_words: int = 0
    """`kind="gap"` : mots alignés sans soutien dans l'audio (preuve du mot sous le seuil)."""
    gain_nats: float | None = None
    """`role="extension"` : gain de preuve totale du texte étendu sur le texte reconnu."""


@dataclass(frozen=True)
class GapFill:
    """Texte du corpus que l'audio d'un trou soutient (ADR-0013) : ses mots et leurs temps."""

    role: str
    candidate: Candidate
    """Plages, temps et temps au mot de l'alignement du texte du corpus (I1), dans le trou."""
    repeat: bool
    """Redit des mots déjà reconnus juste avant."""
    llr_per_frame: float
    """Preuve par trame sur la seule parole alignée."""


@dataclass(frozen=True)
class EdgeExtension:
    """Verset reconnu étendu de mots que l'audio contient (ADR-0013)."""

    span: WordSpan
    time: TimeSpan
    word_times: tuple[TimeSpan, ...]
    """Un temps par mot de `span`, ou vide si le verset n'en avait pas."""
    added_before: int
    added_after: int


@dataclass(frozen=True)
class _Edge:
    """Un bord essayé : sa trace et, s'il est retenu, l'alignement qui le fonde."""

    check: ChainCheck | None
    accepted: bool = False
    added: int = 0
    words: tuple[AlignedWord, ...] = ()
    edge_s: float = 0.0
    anchors: int = 0
    gain: float = 0.0
    passage: TimeSpan | None = None


@dataclass(frozen=True)
class _Trial:
    """Une hypothèse de trou alignée sur l'audio, avant décision."""

    role: str
    repeat: bool
    aligned: tuple[WordSpan, ...]
    llr: float | None
    passage_llr: float | None
    words: int
    similarity: float | None
    result: PassageAlignment | None
    passes: bool
    total: float = -math.inf
    """Log-vraisemblance du chemin contraint sur TOUT le passage : la parole que le texte laisse
    sans explication est comptée en blanc forcé, donc très pénalisante. Comparable entre
    hypothèses (mêmes trames) : c'est un rapport de vraisemblance."""
    weak_words: int = 0

    def check(self, passage: TimeSpan, accepted: bool) -> ChainCheck:
        return ChainCheck(
            passage,
            self.aligned,
            self.llr,
            accepted,
            kind="gap",
            text_similarity=self.similarity,
            role=self.role,
            words=self.words,
            passage_llr_per_frame=self.passage_llr,
            weak_words=self.weak_words,
        )


Link = tuple[int, int]

_HALF: float = math.log(0.5)

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

    # -- Bords d'un verset reconnu (ADR-0013) ------------------------------------------------------
    def extend(
        self,
        clip: AudioClip,
        detection: Detection,
        lower_s: float,
        upper_s: float,
        max_before: int | None = None,
        max_after: int | None = None,
    ) -> tuple[tuple[ChainCheck, ...], EdgeExtension | None]:
        """Un verset est reconnu mais l'audio contient un ou deux mots de plus à son bord (le mot
        suivant dit dans la même fenêtre mais absent du texte reconnu, le mot d'avant que l'ASR a
        perdu). Les textes (reconnu, étendu de 1 à `extend_max_words` mots) sont alignés sur les
        MÊMES trames, autour du bord seulement : l'écart de preuve totale est un rapport de
        vraisemblance, qu'une moyenne par trame cacherait. Le texte étendu n'est retenu que s'il
        gagne `extend_min_gain_nats_per_word` par mot et qu'aucun mot ajouté n'est sans soutien.
        `lower_s`, `upper_s` : bornes en temps (les voisins) ; `max_before`, `max_after` : bornes
        en mots (un voisin du même verset, dont on ne reprend pas les mots). Rien n'est tracé sans
        gain."""
        cfg = self._config
        if not cfg.extend or detection.status is not Status.RECOGNIZED or detection.time is None:
            return (), None
        span = detection.span
        total = len(self._corpus.words(span.ref))
        after = (
            self._edge(clip, detection, lower_s, upper_s, total, max_after, forward=True)
            if span.last_word < total
            else _Edge(None)
        )
        before = (
            self._edge(clip, detection, lower_s, upper_s, total, max_before, forward=False)
            if span.first_word > recited_start(span.ref)
            else _Edge(None)
        )
        checks = tuple(e.check for e in (before, after) if e.check is not None)
        if not (before.accepted or after.accepted):
            return checks, None
        return checks, self._compose(clip, detection, before, after, lower_s, upper_s)

    def _edge(
        self,
        clip: AudioClip,
        detection: Detection,
        lower_s: float,
        upper_s: float,
        total: int,
        limit: int | None,
        *,
        forward: bool,
    ) -> _Edge:
        cfg = self._config
        assert detection.time is not None
        span, time, times = detection.span, detection.time, detection.word_times
        count = span.last_word - span.first_word + 1
        anchors = min(cfg.extend_anchor_words, count)
        timed = len(times) == count
        if forward:
            start = times[count - anchors].start_s if timed else max(time.start_s, time.end_s - 3.0)
            low, high = max(lower_s, start - 0.3), min(upper_s, time.end_s + cfg.extend_pad_s)
            room = total - span.last_word
        else:
            end = times[anchors - 1].end_s if timed else min(time.end_s, time.start_s + 3.0)
            low, high = max(lower_s, time.start_s - cfg.extend_pad_s), min(upper_s, end + 0.3)
            room = span.first_word - recited_start(span.ref)
        if limit is not None:
            room = min(room, limit)
        if room < 1 or high - low < 0.5:
            return _Edge(None)
        passage = TimeSpan(low, high)
        lattice = self._model.lattice(clip, passage)  # pas de cache : un bord, un treillis
        if forward:
            kept = WordSpan(span.ref, span.last_word - anchors + 1, span.last_word)
        else:
            kept = WordSpan(span.ref, span.first_word, span.first_word + anchors - 1)
        base = self._aligner.align(lattice, [kept])
        if base is None:
            return _Edge(None)
        best: tuple[float, int, PassageAlignment] | None = None
        for k in range(1, min(cfg.extend_max_words, room) + 1):
            wider = (
                WordSpan(span.ref, kept.first_word, kept.last_word + k)
                if forward
                else WordSpan(span.ref, kept.first_word - k, kept.last_word)
            )
            result = self._aligner.align(lattice, [wider])
            if result is None:
                continue
            gain = result.evidence.forced_logprob - base.evidence.forced_logprob
            if best is None or gain > best[0]:
                best = (gain, k, result)
        if best is None or best[0] <= 0:
            return _Edge(None)
        gain, k, result = best
        words = result.spans[0].words
        added = words[-k:] if forward else words[:k]
        weak = cfg.gap_weak_word_llr_per_frame
        accepted = gain >= cfg.extend_min_gain_nats_per_word * k and not any(
            w.llr_per_frame is not None and w.llr_per_frame < weak for w in added
        )
        new_span = (
            WordSpan(span.ref, span.last_word + 1, span.last_word + k)
            if forward
            else WordSpan(span.ref, span.first_word - k, span.first_word - 1)
        )
        check = ChainCheck(
            passage,
            (new_span,),
            result.evidence.voiced_llr_per_frame,
            accepted,
            kind="gap",
            role="extension",
            words=k,
            passage_llr_per_frame=result.evidence.llr_per_frame,
            weak_words=sum(1 for w in added if (w.llr_per_frame or 0.0) < weak),
            gain_nats=round(gain, 3),
        )
        edge = result.spans[0].time.end_s if forward else result.spans[0].time.start_s
        return _Edge(check, accepted, k, words, edge, anchors, gain, passage)

    def _compose(
        self,
        clip: AudioClip,
        detection: Detection,
        before: _Edge,
        after: _Edge,
        lower_s: float,
        upper_s: float,
    ) -> EdgeExtension | None:
        assert detection.time is not None
        span, time, times = detection.span, detection.time, detection.word_times
        count = span.last_word - span.first_word + 1
        added_before = before.added if before.accepted else 0
        added_after = after.added if after.accepted else 0
        wider = WordSpan(span.ref, span.first_word - added_before, span.last_word + added_after)
        timed = len(times) == count
        if before.accepted and after.accepted:
            # Les deux bords à la fois : un alignement commun des deux passages, pour des temps
            # cohérents (les mots d'ancrage des deux côtés peuvent être les mêmes).
            assert before.passage is not None and after.passage is not None
            joint = TimeSpan(before.passage.start_s, after.passage.end_s)
            result = self._aligner.align(self._model.lattice(clip, joint), [wider])
            if result is None:
                return None
            words = [w.time for w in result.spans[0].words]
            start, end = result.spans[0].time.start_s, result.spans[0].time.end_s
            return EdgeExtension(
                wider, TimeSpan(start, end), tuple(words), added_before, added_after
            )
        start, end = time.start_s, time.end_s
        new_times: list[TimeSpan] | None = list(times) if timed else None
        if after.accepted:
            tail = [w.time for w in after.words]
            end = min(max(after.edge_s, time.end_s), upper_s)
            new_times = _splice(new_times, tail[-(after.added + 1) :], forward=True)
        if before.accepted:
            head = [w.time for w in before.words]
            start = max(min(before.edge_s, time.start_s), lower_s)
            new_times = _splice(new_times, head[: before.added + 1], forward=False)
        if end <= start:
            return None
        return EdgeExtension(
            wider, TimeSpan(start, end), tuple(new_times or ()), added_before, added_after
        )

    # -- Trou entre deux versets reconnus (ADR-0013) ----------------------------------------------
    def verify_gap(
        self,
        clip: AudioClip,
        hole: Hole,
        hypotheses: Sequence[Hypothesis],
        heard: str | None = None,
        competitors: Sequence[Sequence[WordSpan]] = (),
    ) -> tuple[tuple[ChainCheck, ...], GapFill | None]:
        """Aligne chaque hypothèse de texte du corpus sur l'audio du trou et garde la meilleure si
        la parole la soutient. Preuve par trame mesurée sur la SEULE parole alignée (un mauvais
        texte posé sur quelques trames ne se dilue pas dans les blancs), au même seuil que toute
        suite ; plus la transcription du trou (`heard`) comme second témoin, sauf audio fort. Le
        trou est refusé s'il est mieux expliqué par autre chose (`competitors` : textes que le
        matcher y avait vus) ou si deux textes différents se valent. Trou muet : rien, pas même une
        trace."""
        if not self._config.gap or not hypotheses:
            return (), None
        lattice = self._model.lattice(clip, hole.passage)  # pas de cache : un trou, un treillis
        speech = sum(1 for row in lattice.log_probs if row[lattice.blank] < _HALF)
        if speech < self._config.gap_min_speech_frames:
            return (), None
        trials = [self._trial(lattice, h, heard) for h in hypotheses]
        rivals = [self._rival(lattice, tuple(spans)) for spans in competitors]
        best = self._best_trial(trials, rivals)
        kept = [] if best is None else self._without_short_new_verse(hole, best)
        if not kept:
            best = None  # rien de retenu : la trace dit que l'hypothèse est refusée
        checks = [t.check(hole.passage, t is best) for t in trials]
        checks += [t.check(hole.passage, False) for t in rivals]
        if best is None or best.result is None or best.llr is None:
            return tuple(checks), None
        kept_spans = tuple(a.span for a in kept if isinstance(a.span, WordSpan))
        if kept_spans != best.aligned:  # la trace dit ce qui est réellement nommé
            index = trials.index(best)
            checks[index] = replace(
                checks[index],
                spans=kept_spans,
                words=sum(s.last_word - s.first_word + 1 for s in kept_spans),
            )
        words = [w for a in kept for w in a.words]
        seed = Candidate(
            span=kept[0].span if isinstance(kept[0].span, WordSpan) else best.aligned[0],
            score=self._floor,
            explained=float(len(words)),
        )
        candidate = _with_words(seed, words, hole.passage)  # les temps font la détection
        if not self._config.word_times:
            candidate = replace(candidate, word_times=())
        return tuple(checks), GapFill(best.role, candidate, best.repeat, best.llr)

    def _without_short_new_verse(self, hole: Hole, best: _Trial) -> list[AlignedSpan]:
        """Plages alignées retenues. La suite d'un verset n'ouvre pas un verset nouveau sur moins
        de `gap_new_verse_min_words` mots : trop peu pour le nommer (même si un verset reconnu
        suit plus loin : il ne le prolonge pas, sinon ce serait un `between`)."""
        assert best.result is not None
        spans = list(best.result.spans)
        if best.role != ROLE_CONTINUATION or hole.before is None:
            return spans
        minimum = self._config.gap_new_verse_min_words
        while (
            spans
            and isinstance(spans[-1].span, WordSpan)
            and spans[-1].span.ref != hole.before.span.ref
            and len(spans[-1].words) < minimum
        ):
            spans.pop()
        return spans

    def _trial(self, lattice: CtcLattice, hypothesis: Hypothesis, heard: str | None) -> _Trial:
        result = self._aligner.align(lattice, list(hypothesis.spans), hypothesis.free_end)
        if result is None:
            return _Trial(
                hypothesis.role,
                hypothesis.repeat,
                hypothesis.spans,
                None,
                None,
                0,
                None,
                None,
                False,
            )
        aligned = tuple(a.span for a in result.spans if isinstance(a.span, WordSpan))
        words = sum(s.last_word - s.first_word + 1 for s in aligned)
        similarity = round(self._similarity(aligned, heard), 4) if heard else None
        llr = result.evidence.voiced_llr_per_frame
        weak = self._weak_words(result)
        reached = _reaches(aligned, hypothesis.new_from)
        return _Trial(
            hypothesis.role,
            hypothesis.repeat,
            aligned,
            llr,
            result.evidence.llr_per_frame,
            words,
            similarity,
            result,
            reached and self._gap_passes(hypothesis, llr, words, similarity, weak),
            result.evidence.forced_logprob,
            weak,
        )

    def _weak_words(self, result: PassageAlignment) -> int:
        floor = self._config.gap_weak_word_llr_per_frame
        return sum(
            1
            for aligned in result.spans
            for word in aligned.words
            if word.llr_per_frame is not None and word.llr_per_frame < floor
        )

    def _rival(self, lattice: CtcLattice, spans: tuple[WordSpan, ...]) -> _Trial:
        result = self._aligner.align(lattice, list(spans), free_end=True)
        if result is None:
            return _Trial("competitor", False, spans, None, None, 0, None, None, False)
        aligned = tuple(a.span for a in result.spans if isinstance(a.span, WordSpan))
        words = sum(s.last_word - s.first_word + 1 for s in aligned)
        return _Trial(
            "competitor",
            False,
            aligned,
            result.evidence.voiced_llr_per_frame,
            result.evidence.llr_per_frame,
            words,
            None,
            result,
            False,
            result.evidence.forced_logprob,
        )

    def _gap_passes(
        self,
        hypothesis: Hypothesis,
        llr: float | None,
        words: int,
        similarity: float | None,
        weak: int,
    ) -> bool:
        """Deux témoins : l'audio (preuve de la parole alignée) et la transcription du trou.
        Audio fort : la transcription, souvent pauvre, ne bloque plus que si elle contredit
        franchement. Pas de transcription : audio fort et peu de mots."""
        cfg = self._config
        if llr is None or llr < self._threshold or words < 1:
            return False
        if weak > int(words * cfg.gap_max_weak_fraction):
            return False
        if hypothesis.role == ROLE_REPETITION and words < cfg.gap_repetition_min_words:
            return False
        strong = llr >= cfg.gap_strong_llr_per_frame
        if similarity is None:
            return strong and words <= cfg.gap_unwitnessed_max_words
        if similarity >= cfg.gap_min_text_similarity:
            return True
        return strong and similarity >= cfg.gap_weak_text_similarity

    def _best_trial(self, trials: Sequence[_Trial], rivals: Sequence[_Trial]) -> _Trial | None:
        passing = [t for t in trials if t.passes and t.llr is not None]
        if not passing:
            return None
        top = max(passing, key=lambda t: t.total)
        # Variantes compatibles d'un même texte (reprise de quelques mots, fin seule d'un verset) :
        # celle qui explique le plus de PAROLE (preuve totale) ; à quelques nats près, celle qui
        # nomme le plus de mots. La moyenne par trame ne départage pas : une fin parfaite sur trois
        # mots battrait le verset entier qui laisse peu de parole sans soutien.
        same = [t for t in passing if _same_text(top, t)]
        close = [t for t in same if top.total - t.total < self._config.gap_variant_margin_nats]
        best = max(close, key=lambda t: (t.words, t.total))
        decisive = self._config.gap_decisive_nats
        for other in passing:
            if not _same_text(best, other) and best.total - other.total < decisive:
                return None  # deux textes différents se valent : aucun n'est nommé
        for rival in rivals:
            if not _same_text(best, rival) and rival.total - best.total >= decisive:
                return None  # le trou est mieux expliqué par autre chose
        return best

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


_MAX_RETIMING_S = 0.5
"""Décalage maximal d'une frontière de mot qu'on corrige à la jointure d'un bord étendu : au-delà,
deux alignements se contredisent et aucun temps au mot n'est gardé plutôt qu'un faux."""


def _splice(
    old: list[TimeSpan] | None, fresh: Sequence[TimeSpan], *, forward: bool
) -> list[TimeSpan] | None:
    """Temps au mot d'un verset dont un bord est étendu : les mots d'origine gardent leurs temps,
    sauf le mot du bord (re-timé avec les mots ajoutés par le nouvel alignement : l'ancien l'avait
    étiré par-dessus la parole du suivant). `fresh` : ce mot du bord puis les mots ajoutés (ou
    l'inverse au début). La jointure ne doit pas chevaucher le mot voisin : un petit écart de
    frontière se corrige, un grand n'a plus de temps au mot (None)."""
    if old is None:
        return None
    if forward:
        kept, joined = old[:-1], list(fresh)
        if kept and joined[0].start_s < kept[-1].end_s:
            previous = kept[-1]
            shift = previous.end_s - joined[0].start_s
            if shift > _MAX_RETIMING_S or joined[0].start_s <= previous.start_s:
                return None
            kept[-1] = TimeSpan(previous.start_s, joined[0].start_s)
        merged = [*kept, *joined]
    else:
        kept, joined = old[1:], list(fresh)
        if kept and joined[-1].end_s > kept[0].start_s:
            following = kept[0]
            shift = joined[-1].end_s - following.start_s
            if shift > _MAX_RETIMING_S or joined[-1].end_s >= following.end_s:
                return None
            kept[0] = TimeSpan(joined[-1].end_s, following.end_s)
        merged = [*joined, *kept]
    return merged if without_overlap(merged) == tuple(merged) else None


def _reaches(aligned: Sequence[WordSpan], target: tuple[VerseRef, int] | None) -> bool:
    """L'alignement atteint le premier mot nouveau de l'hypothèse (None : rien à atteindre)."""
    if target is None:
        return True
    ref, word = target
    return any(s.ref == ref and s.first_word <= word <= s.last_word for s in aligned)


def _same_text(a: _Trial, b: _Trial) -> bool:
    """Les deux alignements disent (au moins en partie) les mêmes mots d'un même verset."""
    return any(
        x.ref == y.ref and x.first_word <= y.last_word and y.first_word <= x.last_word
        for x in a.aligned
        for y in b.aligned
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
