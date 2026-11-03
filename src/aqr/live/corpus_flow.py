"""Le flux de mots du Coran tel que le matcher le voit, construit depuis le corpus (ADR-0011).

Même normalisation que `FlowVerseMatcher` (ADR-0004) : `normalize_arabic`, dictionnaire Uthmani vers
imla'i, basmala du verset 1 retirée. Une seule construction pour le suivi en direct, le banc de
simulation et le script d'analyse des préfixes (zéro duplication).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from pathlib import Path

from aqr.corpus.normalize import normalize_arabic
from aqr.domain.models import VerseRef
from aqr.domain.ports import CorpusRepository
from aqr.domain.quran_structure import BASMALA_WORD_COUNT, verse_one_includes_basmala
from aqr.live.prefix_index import PrefixIndex

Skeleton = Callable[[str], str]


def make_skeleton(corrections: Mapping[str, str]) -> Skeleton:
    """Mot (texte d'ASR ou du corpus) -> mot normalisé du flux, sans espace."""

    def skeleton(word: str) -> str:
        normalized = normalize_arabic(word).replace(" ", "")
        return corrections.get(normalized, normalized)

    return skeleton


def flow_words(
    corpus: CorpusRepository, skeleton: Skeleton
) -> tuple[dict[VerseRef, tuple[str, ...]], tuple[str, ...]]:
    """(mots normalisés de chaque verset, basmala) ; la basmala que Tanzil concatène au verset 1
    (toutes sourates sauf 1 et 9) sort du flux, 1:1 la garde (c'est le verset)."""
    refs = corpus.all_refs()
    basmala = tuple(skeleton(w) for w in corpus.words(refs[0]))[:BASMALA_WORD_COUNT]
    flow: dict[VerseRef, tuple[str, ...]] = {}
    for ref in refs:
        words = tuple(skeleton(w) for w in corpus.words(ref))
        if (
            ref.ayah == 1
            and ref.surah != 1
            and verse_one_includes_basmala(ref.surah)
            and words[:BASMALA_WORD_COUNT] == basmala
        ):
            words = words[BASMALA_WORD_COUNT:]
        flow[ref] = words
    return flow, basmala


def load_prefix_index(
    corpus_dir: Path, *, word_threshold: float = 0.7
) -> tuple[PrefixIndex, Skeleton]:
    """L'index du Coran entier et la normalisation des mots entendus, depuis `data/corpus`."""
    from aqr.corpus.imlai_corrections import build_word_corrections, load_simple_clean_words
    from aqr.corpus.tanzil_repository import TanzilCorpusRepository

    corpus = TanzilCorpusRepository(corpus_dir)
    corrections = build_word_corrections(corpus, load_simple_clean_words(corpus_dir))
    skeleton = make_skeleton(corrections)
    flow, basmala = flow_words(corpus, skeleton)
    return PrefixIndex(flow, basmala=basmala, word_threshold=word_threshold), skeleton
