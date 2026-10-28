"""Récitation guidée (ADR-0015) : la sourate annoncée borne le suivi, sans changer le contrat."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from tests.support.live_service import pcm_loud, script_of, stream_factory

from aqr.domain.models import VerseRef
from aqr.live.config import (
    GUIDED_MIN_LOCK_DENSITY,
    GUIDED_MIN_WORDS_LOCK,
    LiveConfig,
)
from aqr.live.prefix_index import PrefixIndex
from aqr.live.protocol import ProtocolError, StartMessage, parse_client_text
from aqr.live.service_config import LiveServiceConfig

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"
needs_corpus = pytest.mark.skipif(
    not (CORPUS_DIR / "quran-uthmani.txt").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)
BASMALA = ("بسم", "الله", "الرحمن", "الرحيم")


def ref(text: str) -> VerseRef:
    return VerseRef.parse(text)


def mini_index() -> PrefixIndex:
    return PrefixIndex(
        {
            ref("112:1"): ("قل", "هو", "الله", "احد"),
            ref("112:2"): ("الله", "الصمد"),
            ref("113:1"): ("قل", "اعوذ", "برب", "الفلق"),
            ref("113:2"): ("من", "شر", "ما", "خلق"),
        },
        basmala=BASMALA,
    )


def start_body(**options: object) -> str:
    return json.dumps(
        {
            "type": "START",
            "schema": "aqr.live/1",
            "token": "v1.x.y",
            "audio": {"encoding": "pcm_s16le", "sample_rate": 16000, "channels": 1},
            "options": {"translation": "none", **options},
        }
    )


# ---------------------------------------------------------------------------- l'index d'une sourate
def test_un_index_de_sourate_ne_contient_que_cette_sourate() -> None:
    restricted = mini_index().restricted_to_surah(113)
    assert restricted.refs == (ref("113:1"), ref("113:2"))
    assert restricted.size == 8
    assert restricted.length(ref("113:1")) == 4


def test_un_index_de_sourate_garde_les_memes_mots_et_ne_nomme_rien_d_ailleurs() -> None:
    full = mini_index()
    restricted = full.restricted_to_surah(112)
    assert restricted.length(ref("112:2")) == full.length(ref("112:2"))
    assert all(verse.surah == 112 for verse in restricted.refs)


def test_une_sourate_inconnue_de_l_index_est_refusee() -> None:
    with pytest.raises(ValueError, match="sourate inconnue"):
        mini_index().restricted_to_surah(2)


# ---------------------------------------------------------------------------- le protocole
def test_options_surah_est_lue_et_vaut_none_par_defaut() -> None:
    message = parse_client_text(start_body(surah=112), max_bytes=4096)
    assert isinstance(message, StartMessage)
    assert message.surah == 112
    classic = parse_client_text(start_body(), max_bytes=4096)
    assert isinstance(classic, StartMessage)
    assert classic.surah is None


@pytest.mark.parametrize("bad", [0, 115, -1, "112", 1.5, True])
def test_options_surah_hors_bornes_est_refusee(bad: object) -> None:
    with pytest.raises(ProtocolError) as error:
        parse_client_text(start_body(surah=bad), max_bytes=4096)
    assert error.value.code == "bad_message"


# ---------------------------------------------------------------------------- les réglages
def test_les_reglages_guides_demandent_moins_de_preuves_que_le_classique() -> None:
    classic = LiveConfig()
    guided = classic.guided()
    assert guided.min_words_lock == GUIDED_MIN_WORDS_LOCK < classic.min_words_lock
    assert guided.min_lock_density == GUIDED_MIN_LOCK_DENSITY < classic.min_lock_density
    assert guided.tau_lock < classic.tau_lock
    assert guided.prior > classic.prior
    assert guided.non_quran_prior < classic.non_quran_prior


def test_les_reglages_guides_ne_modifient_pas_l_original() -> None:
    classic = LiveConfig()
    classic.guided()
    assert classic == LiveConfig()


# ---------------------------------------------------------------------------- le flux
def feed(stream: object, seconds: float = 4.0) -> list[dict[str, object]]:
    """Le flux reçoit des blocs de 100 ms (la limite d'un bloc est de 1 s), puis la fin."""
    pcm = pcm_loud(seconds)
    block = 3200
    messages: list[dict[str, object]] = []
    for i in range(0, len(pcm), block):
        messages += stream.push(pcm[i : i + block])  # type: ignore[attr-defined]
    return messages + stream.end()  # type: ignore[attr-defined]


def locked_refs(messages: list[dict[str, object]]) -> list[str]:
    return [
        str(m["interval"]["ref"])  # type: ignore[index]
        for m in messages
        if m["type"] == "LOCKED"
    ]


@needs_corpus
def test_un_flux_guide_nomme_un_verset_de_la_sourate_annoncee() -> None:
    factory = stream_factory(script_of("112:1"), config=LiveServiceConfig())
    stream = factory("s1", None, False, 112)
    messages = feed(stream)
    assert locked_refs(messages) == ["112:1"]


@needs_corpus
def test_un_flux_guide_ne_nomme_jamais_un_verset_d_une_autre_sourate() -> None:
    # 112:1 est récité mais la personne a annoncé la sourate 113 : rien n'est nommé.
    factory = stream_factory(script_of("112:1"), config=LiveServiceConfig())
    stream = factory("s2", None, False, 113)
    messages = feed(stream)
    assert not any(ref_.startswith("112:") for ref_ in locked_refs(messages))


@needs_corpus
def test_l_ecoute_classique_n_est_pas_changee_par_l_option() -> None:
    factory = stream_factory(script_of("112:1"), config=LiveServiceConfig())
    stream = factory("s3", None, False)
    messages = feed(stream)
    assert locked_refs(messages) == ["112:1"]
