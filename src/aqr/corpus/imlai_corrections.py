"""Dictionnaire de corrections Uthmani -> imla'i, appris depuis le corpus (ADR-0003).

Pas de règle de caractères générique : une règle comme « alef supérieur -> alef
plein » corrige la majorité des écarts (سموت -> سماوات) mais casse des mots à
graphie courte retenue aussi en imla'i (« الرحمن », jamais « الرحمان », y compris
dans la basmala). La correction se fait donc par comparaison directe, verset par
verset, entre le mot Uthmani normalisé et son homologue simple-clean — uniquement
là où les deux tokenisations s'alignent (même nombre de mots ; les ~363 versets
qui divergent, cf. décision du 2026-09-25 sur B6, sont exclus de l'apprentissage).
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path

from aqr.corpus.checksums import CorpusLock
from aqr.corpus.normalize import normalize_arabic
from aqr.corpus.tanzil_format import parse_tanzil_txt
from aqr.domain.models import VerseRef
from aqr.domain.ports import CorpusRepository


def load_simple_clean_words(corpus_dir: Path) -> dict[VerseRef, tuple[str, ...]]:
    """Mots simple-clean par verset, hors marques de pause isolées (même règle que
    `TanzilCorpusRepository.words()` côté Uthmani)."""
    lock = CorpusLock.load(corpus_dir / "LOCK.json")
    raw = (corpus_dir / lock.files["simple_clean"].path).read_text(encoding="utf-8")
    verses = parse_tanzil_txt(raw)
    return {
        ref: tuple(w for w in text.split() if normalize_arabic(w)) for ref, text in verses.items()
    }


def build_word_corrections(
    corpus: CorpusRepository, simple_clean_words: dict[VerseRef, tuple[str, ...]]
) -> dict[str, str]:
    """{forme Uthmani normalisée: forme imla'i normalisée} pour les mots qui diffèrent.

    Vote majoritaire par forme Uthmani, **identité comprise** : un mot correctement
    aligné la plupart du temps (ex. « الذين », 810 occurrences) doit voir son
    identité l'emporter sur le bruit d'un rare mauvais alignement position par
    position — sinon la seule paire non-identité observée, même unique, devenait
    la correction retenue et cassait des mots très fréquents (bug découvert en
    testant : « الذين » se faisait corriger à tort vers « اللذين »).
    """
    votes: dict[str, Counter[str]] = {}
    for ref in corpus.all_refs():
        uthmani_words = corpus.words(ref)
        simple_words = simple_clean_words.get(ref, ())
        if len(uthmani_words) != len(simple_words):
            continue  # tokenisations divergentes : pas d'alignement position par position fiable
        for u_word, s_word in zip(uthmani_words, simple_words, strict=True):
            u_norm = normalize_arabic(u_word)
            s_norm = normalize_arabic(s_word)
            if not u_norm or not s_norm:
                continue
            votes.setdefault(u_norm, Counter())[s_norm] += 1

    corrections: dict[str, str] = {}
    for u_norm, counter in votes.items():
        best, _count = counter.most_common(1)[0]
        if best != u_norm:
            corrections[u_norm] = best
    return corrections
