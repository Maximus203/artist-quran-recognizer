"""Tests de QuranEncTranslationRepository.

Les tests de parsing/cache/checksum sont purs (fetcher factice, pas de réseau).
Un test d'intégration légère (réseau réel, 1 sourate) est sauté si le réseau
n'est pas joignable.
"""

from __future__ import annotations

import json
import urllib.error

import pytest

from aqr.adapters.quranenc import (
    QuranEncTranslationRepository,
    fetch_url,
    parse_sura_response,
    sura_url,
)
from aqr.corpus.checksums import CorpusChecksumError
from aqr.domain.models import VerseRef


def _fake_sura_1_payload() -> bytes:
    result = [
        {"id": "1", "sura": "1", "aya": "1", "arabic_text": "...", "translation": "Verset 1"},
        {"id": "2", "sura": "1", "aya": "2", "arabic_text": "...", "translation": "Verset 2"},
    ]
    return json.dumps({"result": result}).encode("utf-8")


def test_parse_sura_response():
    parsed = parse_sura_response(_fake_sura_1_payload())
    assert parsed == {1: "Verset 1", 2: "Verset 2"}


def test_sura_url_contient_id_et_numero():
    assert sura_url("french_hameedullah", 67) == (
        "https://quranenc.com/api/v1/translation/sura/french_hameedullah/67"
    )


def test_get_utilise_un_fetcher_injecte_et_met_en_cache(tmp_path):
    calls = []

    def fake_fetcher(url: str) -> bytes:
        calls.append(url)
        return _fake_sura_1_payload()

    repo = QuranEncTranslationRepository(cache_dir=tmp_path, fetcher=fake_fetcher)
    t1 = repo.get(VerseRef(1, 1), "french_hameedullah")
    t2 = repo.get(VerseRef(1, 2), "french_hameedullah")

    assert t1.text == "Verset 1"
    assert t2.text == "Verset 2"
    assert t1.translation_id == "french_hameedullah"
    assert "Hamidullah" in t1.attribution
    assert len(calls) == 1  # une sourate entière en un seul appel, réutilisée


def test_translation_id_inconnu_leve_erreur(tmp_path):
    repo = QuranEncTranslationRepository(cache_dir=tmp_path, fetcher=lambda _u: b"{}")
    with pytest.raises(ValueError, match="inconnu"):
        repo.get(VerseRef(1, 1), "english_klingon")


def test_checksum_invalide_leve_erreur_explicite(tmp_path):  # F8
    sura_dir = tmp_path / "french_hameedullah"
    sura_dir.mkdir(parents=True)
    (sura_dir / "1.json").write_bytes(_fake_sura_1_payload())
    (sura_dir / "1.sha256").write_text("checksum-bidon", encoding="utf-8")

    def fetcher_qui_ne_doit_jamais_etre_appele(_url: str) -> bytes:
        raise AssertionError("le cache existe déjà, le fetcher ne doit pas être appelé")

    repo = QuranEncTranslationRepository(
        cache_dir=tmp_path, fetcher=fetcher_qui_ne_doit_jamais_etre_appele
    )
    with pytest.raises(CorpusChecksumError):
        repo.get(VerseRef(1, 1), "french_hameedullah")


def test_verset_absent_de_la_sourate_en_cache_leve_erreur(tmp_path):
    # Le faux payload ne couvre que 1:1 et 1:2 ; 1:5 est un verset valide de la
    # sourate 1 (7 versets) mais absent de ce cache tronqué.
    repo = QuranEncTranslationRepository(
        cache_dir=tmp_path, fetcher=lambda _u: _fake_sura_1_payload()
    )
    with pytest.raises(CorpusChecksumError):
        repo.get(VerseRef(1, 5), "french_hameedullah")


def test_integration_reseau_reelle_french_hameedullah_1_1(tmp_path):
    try:
        repo = QuranEncTranslationRepository(cache_dir=tmp_path, fetcher=fetch_url)
        translation = repo.get(VerseRef(1, 1), "french_hameedullah")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        pytest.skip(f"QuranEnc injoignable depuis cet environnement : {exc}")
    assert translation.text
    assert translation.ref == VerseRef(1, 1)
    assert "QuranEnc" in translation.attribution
