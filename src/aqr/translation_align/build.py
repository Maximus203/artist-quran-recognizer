"""Construction du fichier de frontières d'une traduction (`aqr.translation-segments/1`).

Entrée : pour chaque verset, ses mots arabes (corpus, tokenisation Uthmani : la numérotation du
rendu), son texte arabe (signes de pause) et sa traduction. Sortie : un document JSON qui ne
contient AUCUN texte coranique ni traduction (des indices de mots, des offsets de caractères,
l'empreinte du texte français), à écrire sous `data/translation-segments/<translation_id>.json`.
"""

from __future__ import annotations

import hashlib
import itertools
import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass

from aqr.corpus.normalize import normalize_arabic
from aqr.domain.models import VerseRef
from aqr.rendering.translation_segments import (
    SEGMENTS_SCHEMA,
    SegmentStore,
    fingerprint,
)
from aqr.translation_align.clauses import clause_starts
from aqr.translation_align.config import TranslationAlignmentConfig
from aqr.translation_align.lexicon import (
    AlignmentModels,
    Vocabulary,
    fit_boundary_prior,
    fit_length,
    train_ibm1,
)
from aqr.translation_align.segmenter import VerseInput, segment_verse
from aqr.translation_align.tokens import (
    arabic_letter_count,
    arabic_stem,
    french_letter_count,
    french_tokens,
    waqf_flags,
)


@dataclass(frozen=True)
class VerseSource:
    ref: VerseRef
    arabic_words: tuple[str, ...]
    arabic_text: str
    french: str


BASMALA_STEMS = ("بسم", "الله", "الرحمن", "الرحيم")
"""Le texte Tanzil du premier verset de chaque sourate (sauf 1 et 9) commence par la basmala,
que la traduction du verset ne contient pas : ces mots restent numérotés (le rendu les compte)
mais ne servent pas à l'alignement."""


def leading_basmala(source: VerseSource) -> int:
    """Nombre de mots de basmala placés devant le verset par le corpus (0 ou 4)."""
    if source.ref.ayah != 1 or source.ref.surah in (1, 9):
        return 0
    head = tuple(normalize_arabic(w) for w in source.arabic_words[: len(BASMALA_STEMS)])
    return len(BASMALA_STEMS) if head == BASMALA_STEMS else 0


@dataclass(frozen=True)
class Prepared:
    source: VerseSource
    starts: list[int]
    verse: VerseInput
    skip: int = 0
    """Mots de tête (basmala) absents de `verse` : ajouter ce décalage aux numéros de mots."""


def prepare(sources: Sequence[VerseSource], config: TranslationAlignmentConfig) -> list[Prepared]:
    """Propositions candidates, radicaux et mots de chaque verset, en identifiants entiers."""
    arabic_vocab, french_vocab = Vocabulary(), Vocabulary()
    prepared: list[Prepared] = []
    for source in sources:
        starts = clause_starts(source.french, config)
        bounds = [0, *starts, len(source.french)]
        clauses = [
            [french_vocab.id(t) for t in french_tokens(source.french[a:b], config)]
            for a, b in itertools.pairwise(bounds)
        ]
        skip = leading_basmala(source)
        kept = source.arabic_words[skip:]
        words = [arabic_vocab.id(arabic_stem(w, config.arabic_stemming)) for w in kept]
        waqf = waqf_flags(source.arabic_text)
        waqf = waqf[skip:] if len(waqf) == len(source.arabic_words) else [0] * len(words)
        verse = VerseInput(
            arabic=words,
            waqf=waqf,
            clauses=clauses,
            arabic_letters=[arabic_letter_count(w) for w in kept],
            french_letters=[
                french_letter_count(source.french[a:b], config)
                for a, b in itertools.pairwise(bounds)
            ],
        )
        prepared.append(Prepared(source, starts, verse, skip))
    return prepared


def train_models(
    prepared: Sequence[Prepared], config: TranslationAlignmentConfig
) -> AlignmentModels:
    """Apprend les modèles sur les versets donnés (sans étiquette : aucune frontière n'est lue)."""
    forward_pairs = [(p.verse.arabic, [t for c in p.verse.clauses for t in c]) for p in prepared]
    reverse_pairs = [(f, a) for a, f in forward_pairs]
    ratio, variance = fit_length(
        [(sum(p.verse.arabic_letters), sum(p.verse.french_letters)) for p in prepared],
        config.length_variance_floor,
    )
    return AlignmentModels(
        forward=train_ibm1(forward_pairs, config.em_iterations, config.prob_floor),
        reverse=train_ibm1(reverse_pairs, config.em_iterations, config.prob_floor),
        length_ratio=ratio,
        length_variance=variance,
        prior=fit_boundary_prior(
            [(p.verse.arabic, p.verse.waqf) for p in prepared],
            config.prior_smoothing,
            config.prior_cap,
            config.prior_verse_ends,
        ),
    )


def build_document(
    sources: Sequence[VerseSource],
    translation_id: str,
    config: TranslationAlignmentConfig,
    corpus_sha256: str,
    progress: Callable[[str], None] | None = None,
) -> dict[str, object]:
    say = progress or (lambda _msg: None)
    prepared = prepare(sources, config)
    say(f"{len(prepared)} versets préparés ; apprentissage lexical")
    models = train_models(prepared, config)
    second = None
    if config.second_opinion:
        config2 = config.second()
        prepared2 = prepare(sources, config2)
        second = (config2, prepared2, train_models(prepared2, config2))
    say("modèles appris ; découpage des versets")

    verses: dict[str, dict[str, object]] = {}
    stats = {"verses": 0, "single_clause": 0, "split": 0, "fallback": 0, "cuts": 0}
    for done, item in enumerate(prepared, start=1):
        source = item.source
        cuts = segment_verse(item.verse, models, config)
        if second is not None and cuts:
            config2, prepared2, models2 = second
            assert prepared2[done - 1].starts == item.starts  # mêmes propositions candidates
            other = {
                c.boundary: c.word
                for c in segment_verse(prepared2[done - 1].verse, models2, config2)
            }
            cuts = [
                c
                for c in cuts
                if c.boundary in other
                and abs(other[c.boundary] - c.word) <= config.position_tolerance
            ]
        stats["verses"] += 1
        if not item.starts:
            stats["single_clause"] += 1
        elif cuts:
            stats["split"] += 1
            stats["cuts"] += len(cuts)
        else:
            stats["fallback"] += 1
        verses[str(source.ref)] = {
            "h": fingerprint(source.french),
            "w": len(source.arabic_words),
            "cuts": [
                [cut.word + item.skip, item.starts[cut.boundary], round(cut.confidence, 4)]
                for cut in cuts
            ],
        }
        if done % 1000 == 0:
            say(f"  {done}/{len(prepared)}")
    digest = hashlib.sha256(
        "".join(str(v["h"]) for v in verses.values()).encode("ascii")
    ).hexdigest()
    return {
        "schema": SEGMENTS_SCHEMA,
        "translation_id": translation_id,
        "method": config.method,
        "config": config.to_dict(),
        "source": {"corpus_uthmani_sha256": corpus_sha256, "translation_digest": digest},
        "stats": stats,
        "verses": verses,
    }


def dump_document(document: Mapping[str, object]) -> str:
    """JSON stable (clés ordonnées par verset, une ligne par verset : diffs lisibles)."""
    verses = document["verses"]
    assert isinstance(verses, dict)
    head = {k: v for k, v in document.items() if k != "verses"}
    lines = [json.dumps(head, ensure_ascii=False, sort_keys=True)[:-1] + ', "verses": {']
    entries = [
        f"{json.dumps(k)}: {json.dumps(v, separators=(', ', ': '))}" for k, v in verses.items()
    ]
    lines.append(",\n".join(entries))
    lines.append("}}")
    return "\n".join(lines) + "\n"


def verify_reconstruction(
    document: Mapping[str, object], sources: Sequence[VerseSource]
) -> list[str]:
    """Contrôle d'I2 sur chaque verset : le découpage est lisible (empreinte, offsets) et les
    tranches rejointes redonnent la traduction à l'espace de jonction près. Liste des anomalies."""
    store = SegmentStore.from_document(document)
    problems: list[str] = []
    for source in sources:
        text = source.french
        segments = store.segments(source.ref, text, len(source.arabic_words))
        if segments is None:
            problems.append(f"{source.ref} : découpage illisible")
            continue
        pieces = [text[s.start : s.end] for s in segments]
        if "".join("".join(p.split()) for p in pieces) != "".join(text.split()):
            problems.append(f"{source.ref} : tranches ≠ texte")
            continue
        # les tranches sont des tranches EXACTES : texte = tranche + espaces + tranche + …
        rebuilt = ""
        cursor = 0
        for segment in segments:
            rebuilt += text[cursor : segment.start] + text[segment.start : segment.end]
            cursor = segment.end
        rebuilt += text[cursor:]
        if rebuilt != text:
            problems.append(f"{source.ref} : reconstitution inexacte")
        gaps = [text[a.end : b.start] for a, b in itertools.pairwise(segments)]
        if any(not g or not g.isspace() for g in gaps):
            problems.append(f"{source.ref} : jonction non blanche")
        words = [(s.first_word, s.last_word) for s in segments]
        expected_end = len(source.arabic_words)
        contiguous = words[0][0] == 1 and words[-1][1] == expected_end
        contiguous = contiguous and all(a[1] + 1 == b[0] for a, b in itertools.pairwise(words))
        if not contiguous or any(f > la for f, la in words):
            problems.append(f"{source.ref} : plages de mots non contiguës")
    return problems
