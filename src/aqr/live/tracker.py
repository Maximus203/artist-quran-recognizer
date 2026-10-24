"""HypothesisTracker : le suivi d'hypothèses de position, mot après mot (ADR-0011 §1 à §4).

Le tracker tient, pour un flux, un **passage** ouvert : un ensemble d'hypothèses « le passage a
commencé à la position *s* du flux de mots du Coran et on en a entendu *j* mots », chacune avec une
vraisemblance des mots entendus (erreurs d'ASR tolérées : mot proche, remplacé, avalé, en trop)
et un a priori qui dépend du contexte (`aqr.live.priors`). Une hypothèse de fond « ce n'est pas du
Coran » reçoit chaque mot avec la probabilité d'un mot quelconque : sans mot qui correspond, elle
l'emporte.

Les posteriors sont les poids normalisés. Un verset est **verrouillé** (jamais avant) quand son
posterior atteint `tau_lock` ET qu'il explique au moins `min_words_lock` mots entendus, quel que
soit le posterior (I3). Si un rival (sosie exact ou verset aux mots aussi probables) n'est écarté
que par l'a priori, la référence est déduite de la position : `INFERRED`, `identity_basis:
"context"`.

Domaine pur : aucune dépendance externe, aucun texte produit. L'horloge est celle du flux (temps des
mots), jamais l'horloge murale.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Final

from aqr.domain.models import Status, VerseRef
from aqr.domain.ports import HeardWord
from aqr.live.config import LiveConfig
from aqr.live.events import (
    BasmalaHeard,
    CandidateItem,
    Candidates,
    Continue,
    HypothesisClass,
    Jump,
    LiveEvent,
    Locked,
    Lost,
    Revision,
    Unresolved,
)
from aqr.live.prefix_index import PrefixIndex
from aqr.live.priors import AfterBasmalaPrior, ContextPrior, PriorPolicy, UniformPrior
from aqr.matching.similarity import word_similarity

_BASMALA_LOOKAHEAD: Final = 2
"""Mots parasites tolérés entre deux mots de la basmala (comme le matcher, ADR-0004)."""
_SHARED_WORDS_SAMPLE: Final = 300
"""Candidats plausibles comparés pour le texte commun (les plus probables)."""

_Key = tuple[int, int]


@dataclass(slots=True)
class _Hyp:
    start: int
    ptr: int
    matched: int
    log_words: float
    log_prior: float
    cls: HypothesisClass
    misses: int
    first_start_s: float
    last_end_s: float
    verse: VerseRef
    end: int
    conf_sum: float = 0.0
    """Somme des confiances ASR des mots qui correspondent."""
    exact: int = 0
    """Mots qui correspondent exactement (similarité 1) et non seulement de près."""

    @property
    def log_w(self) -> float:
        return self.log_words + self.log_prior

    @property
    def complete(self) -> bool:
        return self.ptr > self.end

    @property
    def finished(self) -> bool:
        """Tous les mots du verset sont passés ET le dernier a été entendu (pas un mot remplacé)."""
        return self.ptr > self.end and self.misses == 0


@dataclass(slots=True)
class _Lock:
    ref: VerseRef
    status: Status
    basis: str
    first_word: int


@dataclass(slots=True)
class _Passage:
    prior: PriorPolicy
    context: dict[VerseRef, float]
    log_none: float
    words: list[HeardWord] = field(default_factory=list)
    hyps: dict[_Key, _Hyp] = field(default_factory=dict)
    locked: _Lock | None = None
    jumped: bool = False
    after_basmala: bool = False
    basmala_checked: bool = False
    basmala_pending: bool = False


@dataclass(slots=True)
class _Summary:
    posterior: dict[VerseRef, float]
    best: dict[VerseRef, _Hyp]
    best_words: dict[VerseRef, float]
    none_posterior: float
    continue_posterior: float
    top: _Hyp | None

    def plausible(self, floor: float) -> list[VerseRef]:
        """Versets dont le posterior est au moins `floor` x celui du meilleur, du plus probable au
        moins probable (à égalité, dans l'ordre du Mushaf)."""
        if not self.posterior:
            return []
        threshold = floor * max(self.posterior.values())
        found = [v for v, p in self.posterior.items() if p >= threshold]
        return sorted(found, key=lambda v: (-self.posterior[v], v))


class HypothesisTracker:
    """Un tracker par flux. `feed` reçoit les mots dans l'ordre d'arrivée et rend les événements."""

    def __init__(self, index: PrefixIndex, config: LiveConfig | None = None) -> None:
        self._index = index
        self._config = config or LiveConfig()
        cfg = self._config
        vocabulary = max(1, index.vocabulary_size)
        self._log_background = -math.log(vocabulary)
        self._log_substitution = math.log(cfg.word_error / vocabulary)
        self._log_insertion = math.log(cfg.word_insertion / vocabulary)
        self._log_deletion = math.log(cfg.word_deletion)
        self._log_correct = math.log(1.0 - cfg.word_error)
        self._last_arrival = -math.inf
        self._dormant = False
        self._passage = self._fresh({})

    # ------------------------------------------------------------------ API publique
    def feed(self, word: HeardWord) -> list[LiveEvent]:
        if not word.text:
            return []
        if word.arrival_s < self._last_arrival - 1e-9:
            raise ValueError("les mots doivent arriver dans l'ordre")
        self._last_arrival = word.arrival_s
        events: list[LiveEvent] = []
        self._advance(word, events)
        return events

    def tick(self, now_s: float) -> list[LiveEvent]:
        """Le temps du flux avance sans mot : un passage non verrouillé silencieux est abandonné."""
        passage = self._passage
        if not passage.words or passage.locked is not None:
            return []
        if now_s - passage.words[-1].arrival_s < self._config.silence_lost_s:
            return []
        self._passage = self._fresh({})
        return [Lost(now_s, "silence")]

    def finish(self, now_s: float) -> list[LiveEvent]:
        """Fin du flux : le passage ouvert est clos avec ce qu'on en sait."""
        events: list[LiveEvent] = []
        passage = self._passage
        if passage.words:
            self._close(passage, self._summarize(passage), now_s, events)
        self._passage = self._fresh({})
        return events

    # ------------------------------------------------------------------ passage
    def _fresh(self, context: Mapping[VerseRef, float]) -> _Passage:
        cfg = self._config
        prior: PriorPolicy
        if context:
            prior = ContextPrior(self._index, cfg, context)
        else:
            prior = UniformPrior(self._index, cfg)
        return _Passage(prior=prior, context=dict(context), log_none=math.log(cfg.non_quran_prior))

    def _advance(self, word: HeardWord, events: list[LiveEvent]) -> None:
        passage = self._passage
        passage.words.append(word)
        self._update(passage, word, len(passage.words))
        summary = self._summarize(passage)
        if summary.top is not None and summary.top.matched >= 2:
            self._dormant = False
        if self._check_basmala(passage, events):
            return
        if passage.basmala_pending:
            return
        if self._check_restart(passage, summary, word, events):
            return
        if passage.locked is not None and self._lock_holds(passage, summary, word, events):
            self._close_if_complete(passage, summary, word, events)
            return
        if self._check_lost(passage, summary, word, events):
            return
        self._check_jump(passage, summary, word, events)
        if self._try_lock(passage, summary, word, events):
            self._close_if_complete(passage, summary, word, events)
            return
        if self._close_if_unresolved(passage, summary, word, events):
            return
        self._emit_candidates(passage, summary, word, events)

    # ------------------------------------------------------------------ vraisemblance
    def _update(self, passage: _Passage, word: HeardWord, count: int) -> None:
        cfg = self._config
        sims = self._index.similar_positions(word.text)
        advanced: dict[_Key, _Hyp] = {}

        def keep(candidate: _Hyp) -> None:
            key = (candidate.start, candidate.ptr)
            current = advanced.get(key)
            if current is None or candidate.log_w > current.log_w:
                advanced[key] = candidate

        for hyp in passage.hyps.values():
            if hyp.complete:
                keep(self._moved(hyp, hyp.ptr, self._log_insertion, False, word))
                continue
            direct = sims.get(hyp.ptr)
            if direct:
                gain = self._log_correct + math.log(direct)
                keep(self._moved(hyp, hyp.ptr + 1, gain, True, word, exact=direct >= 1.0))
                continue
            for skip in range(1, cfg.max_skip + 1):
                target = hyp.ptr + skip
                if target > hyp.end:
                    break
                similar = sims.get(target)
                if similar:
                    gain = skip * self._log_deletion + self._log_correct + math.log(similar)
                    keep(self._moved(hyp, target + 1, gain, True, word, exact=similar >= 1.0))
            keep(self._moved(hyp, hyp.ptr + 1, self._log_substitution, False, word))
            keep(self._moved(hyp, hyp.ptr, self._log_insertion, False, word))

        if count <= cfg.inject_window:
            self._birth(passage, word, count, sims, keep)
        passage.log_none += self._log_background
        passage.hyps = self._prune(advanced, passage.log_none)

    @staticmethod
    def _moved(
        hyp: _Hyp, ptr: int, gain: float, is_match: bool, word: HeardWord, *, exact: bool = False
    ) -> _Hyp:
        return _Hyp(
            start=hyp.start,
            ptr=ptr,
            matched=hyp.matched + (1 if is_match else 0),
            log_words=hyp.log_words + gain,
            log_prior=hyp.log_prior,
            cls=hyp.cls,
            misses=0 if is_match else hyp.misses + 1,
            first_start_s=hyp.first_start_s,
            last_end_s=word.end_s if is_match else hyp.last_end_s,
            verse=hyp.verse,
            end=hyp.end,
            conf_sum=hyp.conf_sum + (word.confidence if is_match else 0.0),
            exact=hyp.exact + (1 if exact else 0),
        )

    def _birth(
        self,
        passage: _Passage,
        word: HeardWord,
        count: int,
        sims: Mapping[int, float],
        keep: Callable[[_Hyp], None],
    ) -> None:
        """Naissance des hypothèses sur le `count`-ième mot du passage : le début peut être précédé
        de mots parasites (insertions) ou mal entendu (substitutions)."""
        index = self._index
        previous = count - 1
        first_word = passage.words[0]
        for position, similarity in sims.items():
            verse, rank = index.verse_at(position)
            gain = self._log_correct + math.log(similarity)
            mass, cls = passage.prior.prior(position)
            if mass > 0:
                keep(
                    _Hyp(
                        start=position,
                        ptr=position + 1,
                        matched=1,
                        log_words=previous * self._log_insertion + gain,
                        log_prior=math.log(mass),
                        cls=cls,
                        misses=0,
                        first_start_s=word.start_s,
                        last_end_s=word.end_s,
                        verse=verse,
                        end=index.end_of(verse),
                        conf_sum=word.confidence,
                        exact=1 if similarity >= 1.0 else 0,
                    )
                )
            if previous and rank > previous:
                start = position - previous
                mass, cls = passage.prior.prior(start)
                if mass > 0:
                    keep(
                        _Hyp(
                            start=start,
                            ptr=position + 1,
                            matched=1,
                            log_words=previous * self._log_substitution + gain,
                            log_prior=math.log(mass),
                            cls=cls,
                            misses=0,
                            first_start_s=first_word.start_s,
                            last_end_s=word.end_s,
                            verse=verse,
                            end=index.end_of(verse),
                            conf_sum=word.confidence,
                            exact=1 if similarity >= 1.0 else 0,
                        )
                    )

    def _prune(self, hyps: dict[_Key, _Hyp], log_none: float) -> dict[_Key, _Hyp]:
        if not hyps:
            return {}
        cfg = self._config
        reference = max(max(h.log_w for h in hyps.values()), log_none)
        floor = reference + math.log(cfg.prune_ratio)
        kept = [h for h in hyps.values() if h.log_w >= floor]
        if len(kept) > cfg.max_hypotheses:
            kept.sort(key=lambda h: (-h.log_w, h.start, h.ptr))
            kept = kept[: cfg.max_hypotheses]
        return {(h.start, h.ptr): h for h in kept}

    def _summarize(self, passage: _Passage) -> _Summary:
        hyps = passage.hyps
        if not hyps:
            return _Summary({}, {}, {}, 1.0, 0.0, None)
        top = max(hyps.values(), key=lambda h: (h.log_w, -h.start, -h.ptr))
        reference = max(top.log_w, passage.log_none)
        none_weight = math.exp(passage.log_none - reference)
        total = none_weight
        posterior: dict[VerseRef, float] = {}
        best: dict[VerseRef, _Hyp] = {}
        best_words: dict[VerseRef, float] = {}
        continue_weight = 0.0
        for hyp in hyps.values():
            weight = math.exp(hyp.log_w - reference)
            total += weight
            posterior[hyp.verse] = posterior.get(hyp.verse, 0.0) + weight
            current = best.get(hyp.verse)
            if current is None or hyp.log_w > current.log_w:
                best[hyp.verse] = hyp
            if hyp.log_words > best_words.get(hyp.verse, -math.inf):
                best_words[hyp.verse] = hyp.log_words
            if hyp.cls is HypothesisClass.CONTINUE:
                continue_weight += weight
        return _Summary(
            posterior={v: w / total for v, w in posterior.items()},
            best=best,
            best_words=best_words,
            none_posterior=none_weight / total,
            continue_posterior=continue_weight / total,
            top=top,
        )

    # ------------------------------------------------------------------ basmala
    def _basmala_alignment(self, texts: list[str]) -> tuple[int, int]:
        """(mots de basmala reconnus dans l'ordre, mots entendus qu'ils couvrent)."""
        threshold = self._config.word_threshold
        position = matched = 0
        for expected in self._index.basmala:
            for at in range(position, min(position + _BASMALA_LOOKAHEAD, len(texts))):
                if word_similarity(texts[at], expected, threshold) > 0:
                    matched += 1
                    position = at + 1
                    break
        return matched, position

    def _check_basmala(self, passage: _Passage, events: list[LiveEvent]) -> bool:
        basmala = self._index.basmala
        if not basmala or passage.basmala_checked:
            passage.basmala_pending = False
            return False
        cfg = self._config
        texts = [w.text for w in passage.words]
        count = len(texts)
        matched, position = self._basmala_alignment(texts)
        if matched >= cfg.basmala_min_matched and (matched == len(basmala) or count > position):
            leftover = passage.words[position:]
            events.append(BasmalaHeard(passage.words[position - 1].arrival_s))
            self._passage = _Passage(
                prior=AfterBasmalaPrior(self._index, cfg, passage.context),
                context=passage.context,
                log_none=math.log(cfg.non_quran_prior),
                after_basmala=True,
                basmala_checked=True,
            )
            for word in leftover:
                self._advance(word, events)
            return True
        # une basmala commence par son premier mot : un verset qui s'ouvre sur « الله » n'attend pas
        opens = word_similarity(texts[0], basmala[0], cfg.word_threshold) > 0
        possible = opens and matched >= 1 and position >= count - 1 and count <= len(basmala)
        passage.basmala_pending = possible
        if not possible:
            passage.basmala_checked = True
        return False

    # ------------------------------------------------------------------ cassure, perte, saut
    def _check_restart(
        self, passage: _Passage, summary: _Summary, word: HeardWord, events: list[LiveEvent]
    ) -> bool:
        """La meilleure hypothèse n'explique plus les derniers mots alors qu'elle en avait expliqué
        avant : le passage est clos et un autre commence avec ces mots."""
        top = summary.top
        cfg = self._config
        if top is None or top.matched < 2 or top.misses < cfg.restart_misses:
            return False
        tail = passage.words[-top.misses :]
        self._close(passage, summary, tail[0].arrival_s, events)
        for pending in tail:
            self._advance(pending, events)
        return True

    def _check_lost(
        self, passage: _Passage, summary: _Summary, word: HeardWord, events: list[LiveEvent]
    ) -> bool:
        cfg = self._config
        if len(passage.words) < cfg.min_words_lost:
            return False
        if summary.none_posterior < cfg.lost_posterior:
            return False
        if not self._dormant:
            reason = "no_candidate" if not passage.hyps else "non_quran"
            events.append(Lost(word.arrival_s, reason))
        self._dormant = True
        self._passage = self._fresh({})
        return True

    def _check_jump(
        self, passage: _Passage, summary: _Summary, word: HeardWord, events: list[LiveEvent]
    ) -> None:
        cfg = self._config
        if passage.jumped or not passage.context or summary.top is None:
            return
        if len(passage.words) < cfg.min_words_jump:
            return
        if summary.continue_posterior >= cfg.jump_floor:
            return
        if summary.none_posterior >= cfg.lost_posterior:
            return
        origin = max(passage.context, key=lambda v: (passage.context[v], v))
        others = {
            v: p
            for v, p in summary.posterior.items()
            if summary.best[v].cls is not HypothesisClass.CONTINUE
        }
        if not others:
            return
        leader = max(others, key=lambda v: (others[v], v))
        if others[leader] < cfg.jump_leader_posterior:
            return  # la suite a disparu mais rien ne la remplace : ce n'est pas un saut
        if leader in {v.next() for v in passage.context}:
            # la suite attendue elle-même, entendue sans son premier mot (avalé par l'ASR) : le
            # passage démarre au milieu du verset attendu, la classe d'hypothèse n'y change rien
            return
        if leader == origin:
            kind = "repeat"
        elif leader.surah == origin.surah:
            kind = "back" if leader < origin else "skip"
        else:
            kind = "other_surah"
        passage.jumped = True
        events.append(Jump(word.arrival_s, origin, kind))

    # ------------------------------------------------------------------ verrou
    def _try_lock(
        self, passage: _Passage, summary: _Summary, word: HeardWord, events: list[LiveEvent]
    ) -> bool:
        cfg = self._config
        index = self._index
        if not summary.posterior:
            return False
        verse = max(summary.posterior, key=lambda v: (summary.posterior[v], -v.surah, -v.ayah))
        posterior = summary.posterior[verse]
        if posterior < cfg.tau_lock:
            return False
        best = summary.best[verse]
        rank = index.verse_at(best.start)[1]
        if rank == 1:
            wanted = min(cfg.min_words_lock, index.length(verse))  # verset court : en entier
        else:
            # milieu de verset : toujours `min_words_lock` + l'écart, même si la fin du verset est
            # proche (une phrase courte qui finit un verset ne doit pas le nommer)
            wanted = cfg.min_words_lock + cfg.mid_verse_extra_words
        if best.matched < wanted:
            return False
        if best.conf_sum / best.matched < cfg.min_lock_confidence:
            return False  # des mots peu sûrs : on propose des candidats, on ne nomme pas (I3)
        if best.exact < math.ceil(cfg.min_exact_share * wanted - 1e-9):
            return False
        if best.matched < cfg.min_lock_density * len(passage.words) - 1e-9:
            return False  # des mots épars noyés dans de la parole : pas une récitation (I3, I4)
        margin = math.log(cfg.words_margin)
        equivalent = {
            other
            for other, words in summary.best_words.items()
            if other != verse
            and words >= summary.best_words[verse] - margin
            and (
                rank > 1  # un passage qui démarre en milieu de verset ne tranche que par les mots
                or index.verse_at(summary.best[other].start)[1] == 1
                or summary.posterior[other] >= cfg.mid_rival_posterior
            )
        }
        if equivalent - set(index.twins(verse)):
            # règle (c) de l'ADR-0011 : un rival qui explique aussi bien les mots sans être un
            # sosie exact finira par être séparé par un mot de plus ; seuls des sosies EXACTS se
            # départagent par la position. On attend ce mot, on ne nomme pas sur l'a priori (I3).
            return False
        basis = "context" if equivalent else "words"
        status = Status.INFERRED if equivalent else Status.RECOGNIZED
        passage.locked = _Lock(verse, status, basis, rank)
        events.append(
            Locked(
                t=word.arrival_s,
                ref=verse,
                status=status,
                identity_basis=basis,
                words_heard=len(passage.words),
                first_word=rank,
                posterior=posterior,
                start_s=best.first_start_s,
                end_s=best.last_end_s,
                repetition=best.cls is HypothesisClass.REPEAT,
                mean_confidence=best.conf_sum / best.matched,
                exact_words=best.exact,
            )
        )
        return True

    def _lock_holds(
        self, passage: _Passage, summary: _Summary, word: HeardWord, events: list[LiveEvent]
    ) -> bool:
        """False (et `Revision`) si le verrou ne tient plus : l'affichage est corrigé, pas caché."""
        lock = passage.locked
        assert lock is not None
        if summary.posterior.get(lock.ref, 0.0) >= self._config.unlock_floor:
            return True
        events.append(Revision(word.arrival_s, lock.ref, "contradicted"))
        passage.locked = None
        return False

    # ------------------------------------------------------------------ clôture
    def _close_if_complete(
        self, passage: _Passage, summary: _Summary, word: HeardWord, events: list[LiveEvent]
    ) -> None:
        lock = passage.locked
        assert lock is not None
        best = summary.best.get(lock.ref)
        if best is None or not best.finished:
            return
        floor = self._config.candidate_floor
        for other in summary.plausible(floor):
            if other != lock.ref and not summary.best[other].complete:
                return  # un rival plus long partage encore ces mots : on attend le mot suivant
        self._close(passage, summary, word.arrival_s, events)

    def _close_if_unresolved(
        self, passage: _Passage, summary: _Summary, word: HeardWord, events: list[LiveEvent]
    ) -> bool:
        plausible = summary.plausible(self._config.candidate_floor)
        if not plausible or not all(summary.best[v].finished for v in plausible):
            return False
        self._close(passage, summary, word.arrival_s, events)
        return True

    def _close(
        self, passage: _Passage, summary: _Summary, t: float, events: list[LiveEvent]
    ) -> None:
        """Clôt le passage : `Continue` s'il était verrouillé, `Unresolved` s'il reste ambigu. Le
        passage suivant démarre avec, pour contexte, ce qui vient d'être clos."""
        index = self._index
        cfg = self._config
        context: dict[VerseRef, float] = {}
        lock = passage.locked
        if lock is not None and lock.ref in summary.best:
            best = summary.best[lock.ref]
            last_word = index.verse_at(min(best.ptr - 1, best.end))[1]
            following = lock.ref.next()
            expected = (following,) if following is not None and following in index.refs else ()
            events.append(
                Continue(
                    t=t,
                    ref=lock.ref,
                    status=lock.status,
                    identity_basis=lock.basis,
                    first_word=lock.first_word,
                    last_word=max(last_word, lock.first_word),
                    start_s=best.first_start_s,
                    end_s=best.last_end_s,
                    complete=best.finished,
                    expected=expected,
                )
            )
            context = {lock.ref: 1.0}
        else:
            plausible = summary.plausible(cfg.candidate_floor)
            if plausible and passage.words:
                events.append(
                    Unresolved(
                        t=t,
                        candidates=tuple(plausible),
                        words_heard=len(passage.words),
                        start_s=passage.words[0].start_s,
                        end_s=passage.words[-1].end_s,
                    )
                )
                if len(plausible) <= cfg.context_max_candidates:
                    weights = {v: summary.posterior[v] for v in plausible}
                    total = sum(weights.values())
                    context = {v: w / total for v, w in weights.items()}
        self._passage = self._fresh(context)

    # ------------------------------------------------------------------ candidats
    def _emit_candidates(
        self, passage: _Passage, summary: _Summary, word: HeardWord, events: list[LiveEvent]
    ) -> None:
        cfg = self._config
        index = self._index
        if not summary.posterior or summary.top is None:
            return
        if self._dormant and summary.top.matched < 2:
            return  # parole déjà jugée étrangère : un mot isolé ne rouvre pas de candidats
        if summary.none_posterior >= cfg.lost_posterior:
            return
        ranked = sorted(summary.posterior, key=lambda v: (-summary.posterior[v], v))
        plausible = summary.plausible(cfg.candidate_floor)
        items = tuple(
            CandidateItem(
                ref=v,
                posterior=summary.posterior[v],
                hypothesis_class=summary.best[v].cls,
                matched=summary.best[v].matched,
                next_word=(
                    None if summary.best[v].complete else index.verse_at(summary.best[v].ptr)[1]
                ),
            )
            for v in plausible[: cfg.max_items]
        )
        events.append(
            Candidates(
                t=word.arrival_s,
                start_s=passage.words[0].start_s,
                end_s=word.end_s,
                words_heard=len(passage.words),
                count=len(plausible),
                items=items,
                leader=ranked[0],
                leader_posterior=summary.posterior[ranked[0]],
                shared_words=self._shared_words(summary, plausible),
                non_quran_posterior=summary.none_posterior,
            )
        )

    def _shared_words(self, summary: _Summary, plausible: list[VerseRef]) -> int:
        """Mots entendus que tous les candidats plausibles expliquent par le même texte."""
        index = self._index
        sequences = [
            [index.token(p) for p in range(summary.best[v].start, summary.best[v].ptr)]
            for v in plausible[:_SHARED_WORDS_SAMPLE]
        ]
        if not sequences:
            return 0
        shared = min(len(s) for s in sequences)
        first = sequences[0]
        for other in sequences[1:]:
            limit = min(shared, len(other))
            at = 0
            while at < limit and other[at] == first[at]:
                at += 1
            shared = at
        return shared
