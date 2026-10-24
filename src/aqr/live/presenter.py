"""Des événements du suivi aux messages `aqr.live/1` (ADR-0011 §3 et §6, Observer).

Le présentateur est l'unique endroit où un événement du domaine devient du texte affichable :

- tout texte arabe vient du corpus (I1), jamais d'un modèle ; la seule exception est `PARTIAL`, le
  texte provisoire de l'ASR, étiqueté comme tel et réservé au mode technique ;
- une traduction est celle de QuranEnc, entière et sans modification (I2) ;
- un candidat non nommé n'a ni texte ni traduction (I3) ;
- un passage clos sans nom est un état normal : `CONTINUE` avec `closed.status = uncertain` ; le
  `GAP` (saut après un passage sans nom) est dérivé par le client d'un `JUMP` qui suit (design
  « En direct », arbitrage 13).

Le présentateur garde peu d'état : la confiance et le premier mot de chaque verrou (pour
l'intervalle clos et la progression).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from aqr.live.content import LiveContent
from aqr.live.events import (
    BasmalaHeard,
    Candidates,
    Continue,
    DegradationChanged,
    HypothesisClass,
    Jump,
    LiveEvent,
    Locked,
    Lost,
    PartialTranscript,
    Progress,
    Revision,
    Unresolved,
)

MAX_UNCERTAIN_REFS = 20
"""Références listées dans un message `UNCERTAIN` ou `GAP` (le total est dit à part)."""


@dataclass(frozen=True)
class Presented:
    """Un message à envoyer, avant numérotation : type, temps du flux, champs propres."""

    type: str
    t: float
    fields: dict[str, Any] = field(default_factory=dict)


def _round(value: float) -> float:
    return round(value, 4)


def _t(seconds: float) -> float:
    return round(seconds, 3)


class LivePresenter:
    def __init__(
        self, content: LiveContent, translation_id: str | None, *, technical: bool = False
    ) -> None:
        self._content = content
        self._translation = translation_id
        self._technical = technical
        self._lock_posterior: dict[str, float] = {}
        self._lock_first_word: dict[str, int] = {}

    @property
    def technical(self) -> bool:
        return self._technical

    # ------------------------------------------------------------------ API
    def present(self, event: LiveEvent) -> list[Presented]:
        if isinstance(event, Candidates):
            return [self._candidates(event)]
        if isinstance(event, Locked):
            return [self._locked(event)]
        if isinstance(event, Progress):
            return [self._progress(event)]
        if isinstance(event, Continue):
            return [self._continue(event)]
        if isinstance(event, Unresolved):
            return [self._unresolved(event)]
        if isinstance(event, Jump):
            return [self._jump(event)]
        if isinstance(event, Lost):
            return [Presented("LOST", event.t, {"reason": event.reason})]
        if isinstance(event, BasmalaHeard):
            return [Presented("BASMALA", event.t, self._content.basmala(self._translation))]
        if isinstance(event, Revision):
            self._lock_posterior.pop(str(event.ref), None)
            self._lock_first_word.pop(str(event.ref), None)
            return [
                Presented(
                    "REVISION",
                    event.t,
                    {"ref": str(event.ref), "status": "retracted", "reason": event.reason},
                )
            ]
        if isinstance(event, PartialTranscript):
            if not self._technical:
                return []
            return [
                Presented(
                    "PARTIAL",
                    event.t,
                    {
                        "span": [_t(event.start_s), _t(event.end_s)],
                        "text": event.text,
                        "stable": False,
                    },
                )
            ]
        return [self._degraded(event)]

    # ------------------------------------------------------------------ candidats
    def _candidates(self, event: Candidates) -> Presented:
        content = self._content
        items: list[dict[str, Any]] = []
        for candidate in event.items:
            next_word: dict[str, Any] | None = None
            if candidate.next_word is not None:
                rank = content.corpus_rank(candidate.ref, candidate.next_word)
                next_word = {"index": rank, "text": content.word(candidate.ref, rank)}
            items.append(
                {
                    "ref": str(candidate.ref),
                    "posterior": _round(candidate.posterior),
                    "class": candidate.hypothesis_class.value,
                    "matched": candidate.matched,
                    "next_word": next_word,
                }
            )
        heard: dict[str, Any] | None = None
        if event.shared_words > 0:
            heard = {"words": [1, event.shared_words]}
            # un seul candidat qui n'a pas passé le verrou n'est pas nommé (I3) : ni texte ni
            # traduction du verset entier ; il faut une vraie famille de candidats
            comparable = len(event.sources) == event.count and event.count >= 2
            text = content.common_text(event.sources, event.shared_words) if comparable else None
            if text is not None:
                heard["text"] = text
            translation = (
                content.common_translation(event.sources, self._translation) if comparable else None
            )
            if translation is not None:
                heard["translation"] = translation
        body: dict[str, Any] = {
            "state": "ambiguous",
            "span": [_t(event.start_s), _t(event.end_s)],
            "words_heard": event.words_heard,
            "count": event.count,
            "heard": heard,
            "items": items,
        }
        if event.leader is not None:
            leader_class = next(
                (c.hypothesis_class for c in event.items if c.ref == event.leader), None
            )
            body["leader"] = {
                "ref": str(event.leader),
                "posterior": _round(event.leader_posterior),
                "basis": "context" if leader_class is HypothesisClass.CONTINUE else "words",
            }
        return Presented("CANDIDATES", event.t, body)

    # ------------------------------------------------------------------ verrou et clôture
    def _locked(self, event: Locked) -> Presented:
        self._lock_posterior[str(event.ref)] = event.posterior
        self._lock_first_word[str(event.ref)] = event.first_word
        interval = self._content.verse(
            ref=event.ref,
            status=event.status,
            first_flow_word=event.first_word,
            last_flow_word=None,
            start_s=event.start_s,
            end_s=None,
            confidence=event.posterior,
            repetition=event.repetition,
            translation_id=self._translation,
        )
        interval["identity_basis"] = event.identity_basis
        interval["words_heard"] = event.words_heard
        return Presented("LOCKED", event.t, {"interval": interval})

    def _progress(self, event: Progress) -> Presented:
        content = self._content
        first = self._lock_first_word.get(str(event.ref), 1)
        rank = content.corpus_rank(event.ref, event.last_word)
        return Presented(
            "PROGRESS",
            event.t,
            {
                "ref": str(event.ref),
                "words_heard": event.words_heard,
                "words": [content.corpus_rank(event.ref, first), rank],
                "word": {"index": rank, "t": [_t(event.word_start_s), _t(event.word_end_s)]},
            },
        )

    def _continue(self, event: Continue) -> Presented:
        self._lock_first_word.pop(str(event.ref), None)
        confidence = self._lock_posterior.pop(str(event.ref), 0.0)
        interval = self._content.verse(
            ref=event.ref,
            status=event.status,
            first_flow_word=event.first_word,
            last_flow_word=event.last_word,
            start_s=event.start_s,
            end_s=event.end_s,
            confidence=confidence,
            repetition=False,
            translation_id=self._translation,
        )
        interval["identity_basis"] = event.identity_basis
        expected = {"ref": str(event.expected[0])} if event.expected else None
        return Presented(
            "CONTINUE",
            event.t,
            {"closed": interval, "complete": event.complete, "expected": expected},
        )

    def _unresolved(self, event: Unresolved) -> Presented:
        """Un passage clos sans nom est un état normal (un verset sur trois) : il se ferme comme un
        autre, avec le statut `uncertain` et sans suite annoncée."""
        interval = self._content.uncertain(
            event.candidates[:MAX_UNCERTAIN_REFS], event.words_heard, event.start_s, event.end_s
        )
        interval["candidate_count"] = len(event.candidates)
        return Presented(
            "CONTINUE", event.t, {"closed": interval, "complete": False, "expected": None}
        )

    # ------------------------------------------------------------------ saut, perte, budget
    def _jump(self, event: Jump) -> Presented:
        """Toujours un `JUMP` sur le fil : `GAP` est dérivé par le client d'un `JUMP` qui suit un
        passage clos `uncertain` (décision du coordinateur, design « En direct » arbitrage 13)."""
        return Presented(
            "JUMP",
            event.t,
            {"from": str(event.from_ref), "reason": "mismatch_with_expected", "kind": event.kind},
        )

    def _degraded(self, event: DegradationChanged) -> Presented:
        return Presented(
            "DEGRADED",
            event.t,
            {
                "tier": event.tier,
                "overloaded": event.overloaded,
                "lag_s": round(event.lag_s, 3),
                "skipped": list(event.skipped),
                "reason": event.reason,
                "lock_rule": {"min_words_lock": event.min_words_lock, "tau_lock": event.tau_lock},
            },
        )
