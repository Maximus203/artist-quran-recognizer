"""Implémentation du port `CorpusRepository` (aqr.domain.ports) sur les textes Tanzil.

Le texte rendu vient TOUJOURS du fichier Uthmani (invariant I1). Le fichier
simple-clean, bien qu'épinglé et vérifié, ne sert pas à l'indexation des mots :
voir `aqr.corpus.fetch` pour le détail de cette décision.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from aqr.corpus.checksums import CorpusChecksumError, CorpusLock
from aqr.corpus.normalize import normalize_arabic
from aqr.corpus.tanzil_format import parse_tanzil_txt
from aqr.domain.models import Riwaya, VerseRef
from aqr.domain.quran_structure import SURAH_COUNT, ayah_count


class TanzilCorpusRepository:
    riwaya: Riwaya = Riwaya.HAFS

    def __init__(self, corpus_dir: Path) -> None:
        lock_path = corpus_dir / "LOCK.json"
        if not lock_path.exists():
            raise CorpusChecksumError(
                f"LOCK.json introuvable dans {corpus_dir} "
                "(relancer `python scripts/fetch_corpus.py`)"
            )
        lock = CorpusLock.load(lock_path)
        lock.verify(corpus_dir)
        self.version = lock.fetched_at

        uthmani_raw = (corpus_dir / lock.files["uthmani"].path).read_text(encoding="utf-8")
        self._texts = parse_tanzil_txt(uthmani_raw)

        expected = {
            VerseRef(surah, ayah)
            for surah in range(1, SURAH_COUNT + 1)
            for ayah in range(1, ayah_count(surah) + 1)
        }
        missing = expected - self._texts.keys()
        if missing:
            raise CorpusChecksumError(
                f"{len(missing)} verset(s) manquant(s) dans le corpus Uthmani "
                f"(ex. {sorted(missing)[:3]})"
            )

        self._refs: tuple[VerseRef, ...] = tuple(sorted(self._texts))

    def text(self, ref: VerseRef) -> str:
        return self._texts[ref]

    def words(self, ref: VerseRef) -> tuple[str, ...]:
        """Mots du verset (tokenisation Uthmani), sans les marques de pause (waqf).

        Le texte Tanzil sépare par des espaces aussi bien les mots que les signes de
        pause isolés (ۖ ۗ ۚ ۛ ...) et de sajda/rub — ce ne sont pas des mots récités,
        `text()` les conserve (rendu fidèle, I1) mais `words()` les exclut : un token
        qui ne normalise vers aucune lettre arabe (`normalize_arabic` vide) n'est pas
        un mot. Découvert sur 2:255 (8 marques de pause) lors de la brique B6.
        """
        return tuple(w for w in self._texts[ref].split() if normalize_arabic(w))

    def all_refs(self) -> Sequence[VerseRef]:
        return self._refs
