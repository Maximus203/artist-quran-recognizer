"""Test de contrat du port CorpusRepository, implémentation Tanzil.

Nécessite le corpus téléchargé (`python scripts/fetch_corpus.py`) : les fichiers vivent
dans data/corpus/, gitignorés (poids, cf. .gitignore). Sans corpus, ces tests sont
sautés plutôt qu'en échec — pas de dépendance réseau forcée pour la suite unitaire.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from aqr.corpus.checksums import CorpusChecksumError, CorpusLock
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.domain.models import Riwaya, VerseRef
from aqr.domain.quran_structure import SURAH_COUNT, TOTAL_AYAHS, ayah_count

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"

pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "LOCK.json").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)


@pytest.fixture(scope="module")
def repo() -> TanzilCorpusRepository:
    return TanzilCorpusRepository(CORPUS_DIR)


def test_6236_versets(repo):
    assert len(repo.all_refs()) == TOTAL_AYAHS == 6236


def test_toutes_les_sourates_completes(repo):
    refs = set(repo.all_refs())
    for surah in range(1, SURAH_COUNT + 1):
        for ayah in range(1, ayah_count(surah) + 1):
            assert VerseRef(surah, ayah) in refs
            assert repo.text(VerseRef(surah, ayah))  # non vide


def test_riwaya_et_version(repo):
    assert repo.riwaya is Riwaya.HAFS
    assert repo.version


def test_texte_exact_octet_pour_octet_vs_fichier_source(repo):  # P10
    """Le texte rendu est le texte Uthmani brut, sans aucune transformation.

    On relit le fichier source indépendamment du parseur du repository, pour
    détecter toute altération introduite par TanzilCorpusRepository elle-même
    (pas de littéral arabe recopié à la main : les marques diacritiques
    combinantes sont fragiles à la retranscription).
    """
    raw_by_ref = _uthmani_lines()
    sample = [VerseRef(1, a) for a in range(1, 8)] + [VerseRef(112, a) for a in range(1, 5)]
    for ref in sample:
        assert repo.text(ref) == raw_by_ref[ref]


def test_words_retourne_le_decoupage_par_espace_du_texte_uthmani(repo):
    for ref in [VerseRef(1, 1), VerseRef(112, 1), VerseRef(2, 255)]:
        assert repo.words(ref) == tuple(repo.text(ref).split())
    # 112:1 inclut la basmala dans le texte Tanzil (convention pour les sourates
    # autres qu'At-Tawbah) : 4 mots de basmala + 4 mots de "قُلْ هُوَ ٱللَّهُ أَحَدٌ".
    assert len(repo.words(VerseRef(112, 1))) == 8


def _uthmani_lines() -> dict[VerseRef, str]:
    lock = CorpusLock.load(CORPUS_DIR / "LOCK.json")
    raw = (CORPUS_DIR / lock.files["uthmani"].path).read_text(encoding="utf-8")
    result: dict[VerseRef, str] = {}
    for line in raw.splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("|", 2)
        if len(parts) != 3:
            continue
        surah_s, ayah_s, text = parts
        result[VerseRef(int(surah_s), int(ayah_s))] = text
    return result


@pytest.mark.parametrize(
    "ref",
    [VerseRef(1, a) for a in range(1, 8)]
    + [VerseRef(112, a) for a in range(1, 5)]
    + [VerseRef(67, a) for a in range(1, 4)]
    + [VerseRef(2, 255)],
)
def test_correspondance_mot_a_mot_uthmani_simple_sur_echantillon(repo, ref):
    """Échantillon canonique du projet : le compte de mots Uthmani == simple-clean.

    Pas une garantie générale : ~363/6236 versets ont un découpage en mots différent
    entre les deux fichiers Tanzil (ex. "يَـٰٓأَيُّهَا" fusionné vs "يا أيها" séparé) —
    voir .artist/decision-log.md (2026-09-25). L'indexation des mots (WordSpan,
    matching B6) se fait donc uniquement sur la tokenisation Uthmani, jamais sur
    ce fichier simple-clean, qui ne sert qu'à la provenance / vérification croisée.
    """
    simple_words = _simple_clean_words(ref)
    assert len(repo.words(ref)) == len(simple_words)


def _simple_clean_words(ref: VerseRef) -> list[str]:
    lock = CorpusLock.load(CORPUS_DIR / "LOCK.json")
    raw = (CORPUS_DIR / lock.files["simple_clean"].path).read_text(encoding="utf-8")
    for line in raw.splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("|", 2)
        if len(parts) != 3:
            continue
        surah_s, ayah_s, text = parts
        if int(surah_s) == ref.surah and int(ayah_s) == ref.ayah:
            return text.split()
    raise AssertionError(f"verset {ref} introuvable dans simple-clean")


def test_checksum_invalide_leve_erreur(tmp_path):  # F9
    corrupt_dir = tmp_path / "corpus"
    shutil.copytree(CORPUS_DIR, corrupt_dir)
    uthmani_path = corrupt_dir / "quran-uthmani.txt"
    uthmani_path.write_text(
        uthmani_path.read_text(encoding="utf-8") + "TRIPOTAGE", encoding="utf-8"
    )
    with pytest.raises(CorpusChecksumError):
        TanzilCorpusRepository(corrupt_dir)
