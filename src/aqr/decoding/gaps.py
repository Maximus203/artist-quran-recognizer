"""Comblement de trou entre deux versets reconnus (ADR-0013) : où sont les trous, et quels textes
du corpus y sont plausibles. Logique PURE, sans modèle ni audio.

Un verset commencé est toujours récité jusqu'au bout, et un récitant redit volontiers ce qu'il vient
de dire. Quand une partie d'un verset est reconnue et l'autre abstenue (ou jamais segmentée), le
contexte dit presque ce qu'il faut chercher : le début manquant du verset reconnu, sa suite, les
versets consécutifs qui manquent entre deux versets reconnus, la répétition du dernier. Ce module ne
formule que ces HYPOTHÈSES, avec le texte du CORPUS (I1) ; c'est l'audio qui décide (I3) :
`AcousticVerifier.verify_gap` aligne chaque hypothèse sur le trou et ne garde que celle que la
parole soutient.

Un trou est l'espace de temps entre deux éléments consécutifs de la chronologie (détection de
n'importe quel statut, formule non coranique) ou entre un élément et le bord du fichier. Seul un
verset `recognized` est une ancre : un voisin `uncertain` ou non coranique FERME le trou sans lui
donner de contexte ; un verset `inferred` (jamais entendu) n'est ni ancre ni barrière.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final, Protocol

from aqr.decoding.chains import recited_start
from aqr.domain.models import Detection, NonQuranSpan, Status, TimeSpan, VerseRef, WordSpan

ROLE_HEAD: Final = "head"
ROLE_BETWEEN: Final = "between"
ROLE_CONTINUATION: Final = "continuation"
ROLE_REPETITION: Final = "repetition"
ROLES: Final = (ROLE_HEAD, ROLE_BETWEEN, ROLE_CONTINUATION, ROLE_REPETITION)

Item = Detection | NonQuranSpan


class _Words(Protocol):
    def words(self, ref: VerseRef) -> tuple[str, ...]: ...


@dataclass(frozen=True)
class GapConfig:
    enabled: bool = True
    min_gap_s: float = 0.6
    """Trou minimal examiné : en deçà, c'est la pause normale entre deux versets. Provisoire."""
    max_search_s: float = 60.0
    """Durée maximale examinée à partir d'une ancre : un trou plus long est coupé près de chacune
    (le milieu est trop loin de tout contexte pour que le texte déduit soit crédible)."""
    reprise_words: int = 3
    """Mots que le récitant peut reprendre en arrière avant de continuer (i'ada), comme
    `AcousticCheckConfig.continuation_reprise_words`. Provisoire."""
    max_between_verses: int = 3
    """Versets entiers qui peuvent manquer entre deux versets reconnus."""
    follow_verses: int = 1
    """Versets suivants ajoutés à la suite d'un verset (fin libre : l'audio dit jusqu'où)."""
    repetition_tail_words: tuple[int, ...] = (3, 6)
    """Fins de verset que le récitant peut redire seules (en plus du verset entier)."""
    head: bool = True
    between: bool = True
    continuation: bool = True
    repetition: bool = True

    def __post_init__(self) -> None:
        if self.min_gap_s <= 0 or self.max_search_s <= 0:
            raise ValueError("min_gap_s et max_search_s doivent être positifs")
        if self.reprise_words < 0 or self.max_between_verses < 0 or self.follow_verses < 0:
            raise ValueError("reprise_words, max_between_verses et follow_verses sont ≥ 0")


@dataclass(frozen=True)
class Hole:
    """Un trou à examiner et les ancres reconnues qui l'encadrent (None = pas de contexte)."""

    passage: TimeSpan
    before: Detection | None
    after: Detection | None


@dataclass(frozen=True)
class Hypothesis:
    """Texte du corpus que l'audio du trou doit soutenir."""

    role: str
    spans: tuple[WordSpan, ...]
    free_end: bool
    """Le trou peut ne contenir qu'un DÉBUT du texte (suite, répétition) ; sinon tout le texte."""
    repeat: bool = False
    """Redit des mots déjà reconnus juste avant."""
    new_from: tuple[VerseRef, int] | None = None
    """Premier mot que l'hypothèse apporte en plus de ce qui est déjà reconnu : une reprise de
    quelques mots (i'ada) ne vaut que si l'alignement l'atteint, sinon c'est la queue d'un verset
    déjà nommé qu'on ré-attribuerait. None = tout le texte est une répétition."""


def find_holes(items: Sequence[Item], duration_s: float, config: GapConfig) -> list[Hole]:
    """Trous d'au moins `min_gap_s` qui ont au moins une ancre reconnue, dans l'ordre du temps ;
    un trou plus long que `max_search_s` est coupé près de chaque ancre."""
    timed = sorted(
        (i for i in items if i.time is not None and not _inferred(i)),
        key=lambda i: i.time.start_s,  # type: ignore[union-attr]
    )
    holes: list[Hole] = []
    cursor, previous = 0.0, None
    for item in (*timed, None):
        start = duration_s if item is None else item.time.start_s  # type: ignore[union-attr]
        if start - cursor >= config.min_gap_s:
            holes.extend(_pieces(cursor, start, _anchor(previous), _anchor(item), config))
        if item is not None:
            cursor = max(cursor, item.time.end_s)  # type: ignore[union-attr]
            previous = item
    return holes


def _inferred(item: Item) -> bool:
    return isinstance(item, Detection) and item.status is Status.INFERRED


def _anchor(item: Item | None) -> Detection | None:
    if isinstance(item, Detection) and item.status is Status.RECOGNIZED and item.time is not None:
        return item
    return None


def _pieces(
    start: float, end: float, before: Detection | None, after: Detection | None, config: GapConfig
) -> list[Hole]:
    if before is None and after is None:
        return []
    if end - start <= config.max_search_s:
        return [Hole(TimeSpan(start, end), before, after)]
    out: list[Hole] = []
    if before is not None:
        out.append(Hole(TimeSpan(start, start + config.max_search_s), before, None))
    if after is not None:
        out.append(Hole(TimeSpan(end - config.max_search_s, end), None, after))
    return out


def propose(hole: Hole, corpus: _Words, config: GapConfig) -> list[Hypothesis]:
    """Textes plausibles dans le trou d'après ses ancres. Rien sans ancre."""
    before, after = hole.before, hole.after
    found: list[Hypothesis] = []
    if before is not None and after is not None:
        bridge = _bridge(before.span, after.span, corpus, config) if config.between else None
        if bridge is not None:
            found.extend(bridge)
        else:
            found.extend(_continuation(before.span, corpus, config))
            if before.span.ref != after.span.ref:
                found.extend(_head(after.span, config))
    elif before is not None:
        found.extend(_continuation(before.span, corpus, config))
    elif after is not None:
        found.extend(_head(after.span, config))
    if before is not None and config.repetition:
        found.extend(_repetition(before.span, corpus, config))
    unique: list[Hypothesis] = []
    for hypothesis in found:
        if hypothesis not in unique:
            unique.append(hypothesis)
    return unique


def _total(corpus: _Words, ref: VerseRef) -> int:
    return len(corpus.words(ref))


def _starts(last_known: int, config: GapConfig) -> list[int]:
    """Mots où la suite peut reprendre : juste après le dernier connu, ou quelques mots avant."""
    earliest = max(1, last_known + 1 - config.reprise_words)
    return list(range(last_known + 1, earliest - 1, -1))


def _head(after: WordSpan, config: GapConfig) -> list[Hypothesis]:
    start = recited_start(after.ref)
    if not config.head or after.first_word <= start:
        return []
    span = WordSpan(after.ref, start, after.first_word - 1)
    return [Hypothesis(ROLE_HEAD, (span,), free_end=False, new_from=(after.ref, start))]


def _following(ref: VerseRef, corpus: _Words, count: int) -> list[WordSpan]:
    out: list[WordSpan] = []
    nxt = ref.next()
    while nxt is not None and len(out) < count:
        out.append(WordSpan(nxt, recited_start(nxt), _total(corpus, nxt)))
        nxt = nxt.next()
    return out


def _continuation(before: WordSpan, corpus: _Words, config: GapConfig) -> list[Hypothesis]:
    if not config.continuation:
        return []
    total = _total(corpus, before.ref)
    following = tuple(_following(before.ref, corpus, config.follow_verses))
    if before.last_word >= total:
        if not following:
            return []
        first = following[0]
        return [
            Hypothesis(
                ROLE_CONTINUATION, following, free_end=True, new_from=(first.ref, first.first_word)
            )
        ]
    return [
        Hypothesis(
            ROLE_CONTINUATION,
            (WordSpan(before.ref, start, total), *following),
            free_end=True,
            new_from=(before.ref, before.last_word + 1),
        )
        for start in _starts(before.last_word, config)
    ]


def _bridge(
    before: WordSpan, after: WordSpan, corpus: _Words, config: GapConfig
) -> list[Hypothesis] | None:
    """Reste du verset précédent + versets entiers manquants + début du suivant. None : ces deux
    ancres ne se prolongent pas (autre sourate, trop de versets, ou reprise de mots déjà dits)."""
    if after.ref == before.ref:
        if after.first_word <= before.last_word:
            return None  # `after` redit des mots de `before` : rien ne manque entre eux
        return [
            Hypothesis(
                ROLE_BETWEEN,
                (WordSpan(after.ref, start, after.first_word - 1),),
                free_end=False,
                new_from=(after.ref, before.last_word + 1),
            )
            for start in _starts(before.last_word, config)
            if start <= after.first_word - 1
        ]
    middle: list[WordSpan] = []
    ref = before.ref.next()
    while ref is not None and ref != after.ref:
        if len(middle) >= config.max_between_verses:
            return None
        middle.append(WordSpan(ref, recited_start(ref), _total(corpus, ref)))
        ref = ref.next()
    if ref is None:
        return None
    head = _head_words(after)
    total = _total(corpus, before.ref)
    tails = (
        [(WordSpan(before.ref, s, total),) for s in _starts(before.last_word, config)]
        if before.last_word < total
        else [()]
    )
    out = []
    for tail in tails:
        spans = (*tail, *middle, *head)
        if spans:
            fresh = (
                (before.ref, before.last_word + 1) if tail else (spans[0].ref, spans[0].first_word)
            )
            out.append(Hypothesis(ROLE_BETWEEN, spans, free_end=False, new_from=fresh))
    return out


def _head_words(after: WordSpan) -> tuple[WordSpan, ...]:
    start = recited_start(after.ref)
    if after.first_word <= start:
        return ()
    return (WordSpan(after.ref, start, after.first_word - 1),)


def _repetition(before: WordSpan, corpus: _Words, config: GapConfig) -> list[Hypothesis]:
    start, total = recited_start(before.ref), _total(corpus, before.ref)
    spans = [WordSpan(before.ref, start, total)]
    if before != spans[0]:
        spans.append(before)
    spans.extend(  # une fin de verset n'est redite que si elle a été dite : dans les mots reconnus
        WordSpan(before.ref, total - k + 1, total)
        for k in config.repetition_tail_words
        if total - k + 1 > start
        and before.first_word <= total - k + 1
        and before.last_word >= total
    )
    return [Hypothesis(ROLE_REPETITION, (s,), free_end=True, repeat=True) for s in spans]
