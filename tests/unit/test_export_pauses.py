"""Découpe d'un verset aux pauses du récitant : détection, coupe, options, invariants I1 et I2.

Les temps au mot de l'alignement forcé sont contigus (le silence qui suit un mot lui appartient,
`alignment/forced.py`) : une pause se lit donc comme un mot anormalement long, pas comme un trou.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from itertools import pairwise
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given
from hypothesis import strategies as st
from tests.support.export_docs import document, verse

from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.domain.models import VerseRef
from aqr.export.analysis import Context, analyze
from aqr.export.cues import _chunks, build_cues, pause_after, sign_stops
from aqr.export.options import ExportOptions, OptionsError, parse_options
from aqr.export.view import build_view
from aqr.rendering.passages import Passages

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"
needs_corpus = pytest.mark.skipif(
    not (CORPUS_DIR / "quran-uthmani.txt").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)

WORDS = ["كلمة"] * 8  # huit mots de même longueur : le débit attendu est le même pour tous


def timeline(durations: Sequence[float], gaps: Sequence[float] = ()) -> list[tuple[float, float]]:
    """Des mots l'un après l'autre ; `gaps[k]` est le trou qui suit le mot k (0 par défaut)."""
    out: list[tuple[float, float]] = []
    cursor = 0.0
    for k, d in enumerate(durations):
        out.append((cursor, cursor + d))
        cursor += d + (gaps[k] if k < len(gaps) else 0.0)
    return out


# --- détection ---------------------------------------------------------------------------------


def test_un_mot_anormalement_long_est_une_pause_apres_lui():
    times = timeline([0.5, 0.5, 1.6, 0.5, 0.5, 0.5, 0.5, 0.5])
    assert pause_after(WORDS, times, 0.6) == frozenset({2})


def test_un_debit_regulier_ne_donne_aucune_pause():
    assert pause_after(WORDS, timeline([0.5] * 8), 0.6) == frozenset()


def test_un_allongement_sous_le_seuil_n_est_pas_une_pause():
    times = timeline([0.5, 0.5, 0.9, 0.5, 0.5, 0.5, 0.5, 0.5])  # +0,4 s : un madd, pas un arrêt
    assert pause_after(WORDS, times, 0.6) == frozenset()


def test_un_trou_entre_deux_mots_compte_comme_silence():
    times = timeline([0.5] * 8, gaps=[0, 0, 0, 0.8])
    assert pause_after(WORDS, times, 0.6) == frozenset({3})


def test_le_dernier_mot_n_est_jamais_une_coupe():
    times = timeline([0.5] * 7 + [3.0])
    assert pause_after(WORDS, times, 0.6) == frozenset()


def test_trop_peu_de_mots_pour_estimer_un_debit():
    assert pause_after(WORDS[:2], timeline([0.5, 3.0]), 0.6) == frozenset()


def test_le_debit_est_juge_par_la_mediane_pas_par_la_moyenne():
    # Trois pauses longues ne faussent pas le débit : elles sont toutes trouvées.
    times = timeline([0.5, 1.5, 0.5, 1.5, 0.5, 1.5, 0.5, 0.5])
    assert pause_after(WORDS, times, 0.6) == frozenset({1, 3, 5})


def test_les_signes_d_arret_permis_sont_des_candidats_les_autres_non():
    words = ["a ۚ", "b ۙ", "c ۖ", "d ۗ", "e ۘ", "f ۛ", "g", "h ۚ"]
    # ۙ (ne pas s'arrêter), ۖ (mieux vaut continuer) et le dernier mot n'en sont pas
    assert sign_stops(words) == frozenset({0, 3, 4, 5})


# --- coupe -------------------------------------------------------------------------------------


def test_une_pause_coupe_meme_un_verset_plus_court_que_le_maximum():
    times = timeline([0.5] * 8)
    assert _chunks(times, 0.0, 7.0, 1.0) == [(0, 8)]
    assert _chunks(times, 0.0, 7.0, 1.0, pauses=frozenset({3})) == [(0, 4), (4, 8)]


def test_un_morceau_plus_court_que_le_minimum_est_rattache_au_precedent():
    times = timeline([0.5] * 8)  # deux mots = 1,0 s ; trois = 1,5 s
    chunks = _chunks(times, 0.0, 7.0, 1.2, pauses=frozenset({1, 5}))
    assert chunks == [(0, 8)]  # (0,2) et (6,8) durent 1,0 s < 1,2 s : ils sont absorbés
    long_enough = _chunks(times, 0.0, 7.0, 1.0, pauses=frozenset({1, 5}))
    assert long_enough == [(0, 2), (2, 6), (6, 8)]  # 1,0 s suffit quand le minimum est 1,0 s


def test_le_plafond_prefere_un_signe_d_arret_au_dernier_mot_qui_tient():
    times = timeline([1.0] * 10)  # plafond 6 s : le dernier mot qui tient est le 6e (indice 5)
    cut_at_cap = _chunks(times, 0.0, 6.0, 1.0)
    assert cut_at_cap[0] == (0, 6)
    with_sign = _chunks(times, 0.0, 6.0, 1.0, stops=frozenset({3}))  # signe après le 4e mot
    assert with_sign[0] == (0, 4)


def test_un_signe_trop_tot_dans_le_morceau_est_ignore():
    times = timeline([1.0] * 10)
    early = _chunks(times, 0.0, 6.0, 1.0, stops=frozenset({0}))  # 1 s < moitié du plafond
    assert early[0] == (0, 6)


def test_les_morceaux_couvrent_tous_les_mots_sans_trou_ni_recouvrement():
    times = timeline([0.4, 0.4, 1.4, 0.4, 0.9, 0.4, 0.4, 2.0, 0.4, 0.4, 0.4])
    for pauses in (frozenset(), frozenset({2, 7}), frozenset(range(10))):
        chunks = _chunks(times, 0.0, 4.0, 0.8, pauses=pauses, stops=frozenset({4}))
        assert chunks[0][0] == 0 and chunks[-1][1] == len(times)
        assert all(a[1] == b[0] for a, b in pairwise(chunks))
        assert all(i < j for i, j in chunks)


# --- options -----------------------------------------------------------------------------------


def test_les_options_de_pause_ont_des_defauts_et_des_bornes():
    base = parse_options({})
    assert base.pause_split is True and base.pause_s == 0.6
    assert parse_options({"pause_split": False}).pause_split is False
    assert parse_options({"pause_s": 1.2}).pause_s == 1.2
    for bad in ({"pause_s": 0.05}, {"pause_s": 9}, {"pause_s": "1"}, {"pause_split": 1}):
        with pytest.raises(OptionsError):
            parse_options(bad)


# --- de bout en bout (corpus réel) -------------------------------------------------------------


@pytest.fixture(scope="module")
def corpus() -> TanzilCorpusRepository:
    return TanzilCorpusRepository(CORPUS_DIR)


class _NoTranslations:
    def passage(self, ref: VerseRef, words: tuple[int, int] | None) -> Any:
        return None


def _build(corpus, doc, **options):
    ctx = Context(
        passages=Passages(corpus), options=ExportOptions(**options), translations=_NoTranslations()
    )
    view = build_view(doc, analyze(doc, None, [], ctx), ctx)
    return build_cues(view.entries, ctx), view


@needs_corpus
def test_un_verset_mesure_avec_une_pause_est_affiche_en_deux_temps(corpus):
    ref = "112:4"
    n = len(corpus.words(VerseRef.parse(ref)))
    durations = [0.5] * n
    durations[n // 2 - 1] = 2.2  # le récitant s'arrête après le mot du milieu
    times = timeline(durations)
    interval = verse(ref, (1, n), (0.0, times[-1][1]), word_times=times)
    build, view = _build(corpus, document(interval), content="ar", max_s=60.0)
    assert len(build.cues) == 2 and build.split == 1
    assert build.cues[0].end_s <= build.cues[1].start_s + 1e-9  # l'un après l'autre
    assert build.cues[0].start_s == 0.0 and build.cues[-1].end_s == times[-1][1]
    (entry,) = view.entries
    assert " ".join(c.arabic or "" for c in build.cues) == " ".join(entry.arabic_words)  # I1


@needs_corpus
def test_sans_la_coupe_aux_pauses_le_verset_reste_d_un_bloc(corpus):
    ref = "112:4"
    n = len(corpus.words(VerseRef.parse(ref)))
    durations = [0.5] * n
    durations[n // 2 - 1] = 2.2
    times = timeline(durations)
    interval = verse(ref, (1, n), (0.0, times[-1][1]), word_times=times)
    build, _ = _build(corpus, document(interval), content="ar", max_s=60.0, pause_split=False)
    assert len(build.cues) == 1 and build.split == 0


@needs_corpus
def test_des_temps_estimes_n_inventent_aucune_pause(corpus):
    interval = verse("112:4", (1, 4), (0.0, 12.0))  # pas de temps au mot : prorata de l'intervalle
    build, _ = _build(corpus, document(interval), content="ar", max_s=60.0)
    assert len(build.cues) == 1


@needs_corpus
def test_la_traduction_suit_la_coupe_et_se_recompose_a_l_identique(corpus):
    ref = "112:4"
    n = len(corpus.words(VerseRef.parse(ref)))
    durations = [0.5] * n
    durations[1] = 2.2  # pause après le 2e mot
    times = timeline(durations)
    translation = {
        "text": "Et nul n'est égal à Lui.",
        "translation_id": "french_hameedullah",
        "scope": "verse",
        "segments": [
            {"words": [1, 2], "text": "Et nul n'est"},
            {"words": [3, n], "text": "égal à Lui."},
        ],
    }
    interval = verse(ref, (1, n), (0.0, times[-1][1]), word_times=times, translation=translation)
    build, _ = _build(corpus, document(interval), max_s=60.0)
    assert [c.translation for c in build.cues] == [("Et nul n'est",), ("égal à Lui.",)]


# --- mêmes cas que l'atelier (web/lib/export-video-split.test.ts) ------------------------------

SHARED = json.loads(
    (Path(__file__).resolve().parents[1] / "fixtures" / "export-pauses" / "cases.json").read_text(
        encoding="utf-8"
    )
)


@pytest.mark.parametrize("case", SHARED, ids=[c["name"] for c in SHARED])
def test_meme_decoupe_que_l_atelier(case: dict[str, Any]) -> None:
    times = [(a, b) for a, b in case["times"]]
    pauses = pause_after(case["words"], times, case["pause_s"])
    stops = sign_stops(case["words"])
    assert sorted(pauses) == case["pauses"]
    assert sorted(stops) == case["stops"]
    chunks = _chunks(times, case["start_s"], case["max_s"], case["min_s"], pauses, stops)
    assert [list(c) for c in chunks] == case["chunks"]


# --- propriétés (hypothesis) -------------------------------------------------------------------


@st.composite
def _verse_times(draw: st.DrawFn) -> list[tuple[float, float]]:
    durations = draw(st.lists(st.floats(0.05, 4.0), min_size=1, max_size=40))
    return timeline(durations)


@given(
    times=_verse_times(),
    max_s=st.floats(0.5, 20.0),
    min_s=st.floats(0.0, 5.0),
    data=st.data(),
)
def test_les_morceaux_couvrent_toujours_tous_les_mots(times, max_s, min_s, data):
    n = len(times)
    indices = st.sets(st.integers(0, max(0, n - 2)))
    pauses = frozenset(data.draw(indices)) if n > 1 else frozenset()
    stops = frozenset(data.draw(indices)) if n > 1 else frozenset()
    chunks = _chunks(times, 0.0, max_s, min_s, pauses, stops)
    assert chunks[0][0] == 0 and chunks[-1][1] == n
    assert all(i < j for i, j in chunks)
    assert all(a[1] == b[0] for a, b in pairwise(chunks))


@given(times=_verse_times(), pause_s=st.floats(0.2, 5.0))
def test_une_pause_ne_designe_jamais_le_dernier_mot(times, pause_s):
    words = ["كلمة"] * len(times)
    found = pause_after(words, times, pause_s)
    assert all(0 <= k < len(words) - 1 for k in found)


# --- cas limites de bout en bout ---------------------------------------------------------------


def _paused_interval(corpus, ref="112:4", **kw):
    n = len(corpus.words(VerseRef.parse(ref)))
    durations = [0.5] * n
    durations[1] = 2.2  # pause après le 2e mot
    times = timeline(durations)
    return n, times, verse(ref, (1, n), (0.0, times[-1][1]), word_times=times, **kw)


@needs_corpus
def test_le_karaoke_de_chaque_morceau_ne_porte_que_ses_mots(corpus):
    n, _, interval = _paused_interval(corpus)
    build, _ = _build(corpus, document(interval), content="ar", max_s=60.0, karaoke=True)
    first, second = build.cues
    assert " ".join(w.text for w in first.words) == first.arabic
    assert " ".join(w.text for w in second.words) == second.arabic
    assert len(first.words) + len(second.words) == n
    assert first.words[-1].end_s <= second.words[0].start_s + 1e-9


@needs_corpus
def test_le_decalage_garde_l_ordre_des_morceaux(corpus):
    _, _, interval = _paused_interval(corpus)
    build, _ = _build(corpus, document(interval), content="ar", max_s=60.0, offset_ms=-300)
    first, second = build.cues
    assert first.start_s == 0.0 and first.end_s <= second.start_s + 1e-9


@needs_corpus
def test_une_repetition_fusionnee_perd_ses_temps_donc_aucune_pause(corpus):
    _, times, interval = _paused_interval(corpus)
    again = {**interval, "repetition": True, "t": [times[-1][1], times[-1][1] + 6.0]}
    again["word_times"] = [[a + times[-1][1], b + times[-1][1]] for a, b in times]
    build, _ = _build(
        corpus, document(interval, again), content="ar", max_s=60.0, repetitions="merge"
    )
    assert len(build.cues) == 1  # un seul sous-titre, de la première à la dernière lecture


@needs_corpus
def test_le_verset_garde_sa_reference_sur_le_premier_morceau_seulement(corpus):
    _, _, interval = _paused_interval(corpus)
    build, _ = _build(corpus, document(interval), content="ar", max_s=60.0, show_ref=True)
    first, second = build.cues
    assert first.reference == "112:4" and second.reference is None
