"""Mixages synthétiques : vérité terrain exacte, reproductible, couvrant les cas réels."""

from __future__ import annotations

import math
import random
import wave
from array import array
from dataclasses import replace
from itertools import pairwise
from pathlib import Path

import pytest

from aqr.corpus.imlai_corrections import build_word_corrections, load_simple_clean_words
from aqr.corpus.normalize import normalize_arabic
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.data.config import DataConfig
from aqr.data.labels import export_labels, import_labels
from aqr.data.manifest import Manifest, WordRange
from aqr.data.mixer import (
    SCENARIOS,
    MixConfig,
    generate_mixes,
    materialize,
    mix_segment_cases,
)
from aqr.decoding.viterbi_decoder import DecoderConfig
from aqr.domain.models import NonQuranKind, Status, VerseRef
from aqr.matching.flow_matcher import FlowVerseMatcher
from aqr.matching.segment_bench import evaluate

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"
RATE = 16000

pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "LOCK.json").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)


def tone(freq: float, seconds: float, amp: int = 9000) -> array:
    n = round(seconds * RATE)
    return array("h", (int(amp * math.sin(2 * math.pi * freq * i / RATE)) for i in range(n)))


def freq_of(samples: array) -> float:
    crossings = sum(1 for a, b in pairwise(samples) if (a < 0) != (b < 0))
    return crossings / 2 / (len(samples) / RATE)


class SyntheticProvider:
    """Un ton par verset (fréquence = f(ref)), durée proportionnelle aux lettres du verset."""

    def __init__(self, corpus: TanzilCorpusRepository, specials: bool = True, speech: bool = True):
        self.corpus = corpus
        self._specials = specials
        self._speech = speech

    def reciters(self) -> tuple[str, ...]:
        return ("recit_a", "recit_b")

    def surahs(self, reciter: str) -> tuple[int, ...]:
        return (1, 67, 112, 113, 114)

    @staticmethod
    def verse_freq(ref: VerseRef) -> float:
        return 300.0 + 40.0 * ((ref.surah * 7 + ref.ayah) % 17)

    def verse(self, reciter: str, ref: VerseRef) -> array:
        words = self.corpus.words(ref)
        if ref.ayah == 1 and ref.surah not in (1, 9):
            words = words[4:]  # comme EveryAyah : pas de basmala dans le fichier du verset 1
        letters = sum(max(1, len(normalize_arabic(w))) for w in words)
        return tone(self.verse_freq(ref), 0.05 * letters)

    def bismillah(self, reciter: str) -> array:
        return tone(1500.0, 2.0)

    def special(self, kind: NonQuranKind) -> array | None:
        if not self._specials:
            return None
        freq = {
            NonQuranKind.ISTIADHA: 2100.0,
            NonQuranKind.TAKBIR: 2300.0,
            NonQuranKind.AMIN: 2500.0,
        }
        return tone(freq[kind], 1.0) if kind in freq else None

    def speech(self, kind: NonQuranKind, rng: random.Random) -> array | None:
        if not self._speech:
            return None
        return tone({NonQuranKind.FRENCH: 3100.0, NonQuranKind.ARABIC_SPEECH: 3300.0}[kind], 3.0)


@pytest.fixture(scope="module")
def corpus() -> TanzilCorpusRepository:
    return TanzilCorpusRepository(CORPUS_DIR)


@pytest.fixture(scope="module")
def provider(corpus):
    return SyntheticProvider(corpus)


CFG = MixConfig()


def mixes_for(provider, corpus, scenario: str, seed: int = 1, count: int = 3):
    report = generate_mixes(
        provider, corpus, seed=seed, per_scenario=count, scenarios=(scenario,), config=CFG
    )
    return report


def all_segments(mix):
    return sorted(
        [(i.t, "verse", i) for i in mix.expected] + [(n.t, "non", n) for n in mix.non_quran],
        key=lambda x: x[0],
    )


def test_tous_les_scenarios_connus_sont_disponibles_avec_des_sources_completes(provider, corpus):
    report = generate_mixes(provider, corpus, seed=5, per_scenario=2, config=CFG)
    assert not report.skipped
    assert {m.scenario for m in report.mixes} == set(SCENARIOS)


@pytest.mark.parametrize("scenario", sorted(SCENARIOS))
def test_temps_exacts_a_la_milliseconde_et_ordonnes(provider, corpus, scenario):
    for mix in mixes_for(provider, corpus, scenario).mixes:
        previous_end = 0.0
        for (start, end), _kind, _item in all_segments(mix):
            assert round(start, 3) == start and round(end, 3) == end
            assert start >= previous_end - 1e-9, "segments qui se chevauchent"
            assert end > start
            previous_end = end
        assert len(mix.samples) % (RATE // 1000) == 0
        assert previous_end <= len(mix.samples) / RATE + 1e-9


def test_chaque_verset_complet_est_au_bon_endroit_de_l_audio(provider, corpus):
    for mix in mixes_for(provider, corpus, "murattal_continu").mixes:
        for item in mix.expected:
            if item.status is not Status.RECOGNIZED or not item.words.is_all or item.ref.ayah == 1:
                continue
            a, b = round(item.t[0] * RATE), round(item.t[1] * RATE)
            segment = mix.samples[a:b]
            assert freq_of(segment) == pytest.approx(provider.verse_freq(item.ref), rel=0.03)


def test_verset_brouille_est_infere_et_son_audio_n_est_pas_le_verset(provider, corpus):
    mixes = mixes_for(provider, corpus, "verset_brouille").mixes
    inferred = [i for m in mixes for i in m.expected if i.status is Status.INFERRED]
    assert inferred
    for mix in mixes:
        for item in mix.expected:
            if item.status is Status.INFERRED:
                a, b = round(item.t[0] * RATE), round(item.t[1] * RATE)
                assert abs(freq_of(mix.samples[a:b]) - provider.verse_freq(item.ref)) > 150


def test_saut_de_sourate_change_de_sourate(provider, corpus):
    for mix in mixes_for(provider, corpus, "saut_de_sourate").mixes:
        surahs = [i.ref.surah for i in mix.expected]
        assert len(set(surahs)) >= 2


def test_repetition_reprend_la_seconde_moitie_d_un_verset(provider, corpus):
    for mix in mixes_for(provider, corpus, "repetition").mixes:
        by_ref: dict[VerseRef, list] = {}
        for item in mix.expected:
            by_ref.setdefault(item.ref, []).append(item)
        repeated = [items for items in by_ref.values() if len(items) >= 2]
        assert repeated
        full, part = repeated[0][0], repeated[0][1]
        assert full.words.is_all and not part.words.is_all
        assert part.words.last == len(corpus.words(part.ref))
        assert mix.boundaries == "approximate"


def test_arret_au_waqf_decoupe_proportionnellement_aux_lettres(provider, corpus):
    for mix in mixes_for(provider, corpus, "arret_waqf").mixes:
        partial = [i for i in mix.expected if not i.words.is_all]
        assert partial and mix.boundaries == "approximate"
        for item in partial:
            words = corpus.words(item.ref)
            offset = 4 if item.ref.ayah == 1 and item.ref.surah not in (1, 9) else 0
            letters = [max(1, len(normalize_arabic(w))) for w in words[offset:]]
            first, last = item.words.first, item.words.last
            assert first is not None and last is not None
            share = sum(letters[first - 1 - offset : last - offset]) / sum(letters)
            duration = item.t[1] - item.t[0]
            full = len(provider.verse("recit_a", item.ref)) / RATE
            # tolérance : coupure collée au silence le plus proche (fenêtre de snap)
            assert duration == pytest.approx(share * full, abs=2 * CFG.snap_window_s)


def test_versets_courts_d_un_souffle_sont_contigus(provider, corpus):
    for mix in mixes_for(provider, corpus, "versets_courts_souffle").mixes:
        items = sorted(mix.expected, key=lambda i: i.t)
        assert len(items) >= 2
        assert all(a.t[1] == b.t[0] for a, b in pairwise(items))


def test_verset_1_avec_basmala_ajoute_la_basmala_et_garde_tous_les_mots(provider, corpus):
    for mix in mixes_for(provider, corpus, "verset1_avec_basmala").mixes:
        item = mix.expected[0]
        assert item.ref.ayah == 1 and item.words.is_all
        a, b = round(item.t[0] * RATE), round(item.t[1] * RATE)
        head = mix.samples[a : a + 2 * RATE]
        assert freq_of(head) == pytest.approx(1500.0, rel=0.03)  # basmala d'abord
        assert freq_of(mix.samples[a + 2 * RATE : b]) == pytest.approx(
            provider.verse_freq(item.ref), rel=0.03
        )


def test_verset_1_sans_basmala_porte_seulement_les_mots_du_verset(provider, corpus):
    for mix in mixes_for(provider, corpus, "verset1_sans_basmala").mixes:
        item = mix.expected[0]
        total = len(corpus.words(item.ref))
        assert item.words == WordRange(5, total)


def test_priere_enchaine_takbir_istiadha_fatiha_amin(provider, corpus):
    for mix in mixes_for(provider, corpus, "priere").mixes:
        kinds = [n.kind for n in sorted(mix.non_quran, key=lambda n: n.t)]
        assert kinds[0] is NonQuranKind.TAKBIR
        assert NonQuranKind.ISTIADHA in kinds and NonQuranKind.AMIN in kinds
        fatiha = [i.ref for i in mix.expected if i.ref.surah == 1]
        assert fatiha == [VerseRef(1, a) for a in range(1, 8)]


def test_assise_alterne_francais_coran_et_arabe_non_coranique(provider, corpus):
    for mix in mixes_for(provider, corpus, "assise_fr").mixes:
        kinds = {n.kind for n in mix.non_quran}
        assert NonQuranKind.FRENCH in kinds and NonQuranKind.ARABIC_SPEECH in kinds
        assert mix.expected  # au moins une citation coranique


def test_sources_manquantes_scenarios_ecartes_et_signales(corpus):
    bare = SyntheticProvider(corpus, specials=False, speech=False)
    report = generate_mixes(bare, corpus, seed=1, per_scenario=1, config=CFG)
    skipped = dict(report.skipped)
    assert "priere" in skipped and "assise_fr" in skipped and "khutba_citation" in skipped
    assert "murattal_continu" not in skipped and report.mixes


def test_deterministe_par_graine(provider, corpus):
    a = generate_mixes(provider, corpus, seed=11, per_scenario=2, config=CFG).mixes
    b = generate_mixes(provider, corpus, seed=11, per_scenario=2, config=CFG).mixes
    c = generate_mixes(provider, corpus, seed=12, per_scenario=2, config=CFG).mixes
    assert [(m.id, m.samples, m.expected, m.non_quran) for m in a] == [
        (m.id, m.samples, m.expected, m.non_quran) for m in b
    ]
    assert [m.expected for m in a] != [m.expected for m in c]


def test_un_mix_genere_puis_reimporte_redonne_exactement_sa_verite_terrain(
    provider, corpus, tmp_path: Path
):
    audio_dir, manifest_path = tmp_path / "audio", tmp_path / "manifest.yaml"
    data_config = DataConfig()
    for mix in generate_mixes(provider, corpus, seed=3, per_scenario=1, config=CFG).mixes:
        case = materialize(mix, audio_dir, manifest_path, data_config)
        assert case.origine == "mix" and case.statut == "annote"
        assert (audio_dir / case.file).exists() and (
            audio_dir / "_derived" / f"{mix.id}.wav"
        ).exists()
        with wave.open(str(audio_dir / case.file), "rb") as w:
            assert w.getframerate() == RATE and w.getnchannels() == 1
            assert w.getnframes() == len(mix.samples)
        assert case.duree_s == pytest.approx(len(mix.samples) / RATE)

        truth = (case.expected, case.non_quran)
        export_labels(manifest_path, audio_dir, mix.id)
        # on efface la vérité du manifeste, puis on la reconstruit depuis les étiquettes seules
        manifest = Manifest.load(manifest_path)
        manifest.upsert(replace(case, expected=(), non_quran=(), statut="a_annoter"))
        manifest.save(manifest_path)
        again = import_labels(manifest_path, audio_dir, mix.id, config=data_config)
        assert (again.expected, again.non_quran) == truth


def test_materialiser_deux_fois_ne_duplique_pas(provider, corpus, tmp_path: Path):
    audio_dir, manifest_path = tmp_path / "audio", tmp_path / "manifest.yaml"
    mix = generate_mixes(provider, corpus, seed=3, per_scenario=1, config=CFG).mixes[0]
    materialize(mix, audio_dir, manifest_path, DataConfig())
    materialize(mix, audio_dir, manifest_path, DataConfig())
    assert len(Manifest.load(manifest_path).cases) == 1


def test_les_segments_generes_couvrent_les_cas_reels_et_n_induisent_aucun_faux_verset(
    provider, corpus
):
    """Réutilise le banc de la phase 2b : les segments d'un lot de mixages doivent couvrir
    parties de verset, plusieurs versets d'un souffle, verset 1 avec/sans basmala, etc., et le
    matcher + la règle du décodeur ne doivent nommer aucun faux verset (I3)."""
    mixes = generate_mixes(provider, corpus, seed=7, per_scenario=6, config=CFG).mixes
    simple_clean = load_simple_clean_words(CORPUS_DIR)
    cases = mix_segment_cases(mixes, corpus, simple_clean)
    kinds = {c.kind for c in cases}
    assert {
        "partiel",
        "multi_versets",
        "verset1_sans_basmala",
        "verset1_avec_basmala",
        "verset_entier",
    } <= kinds
    non_quran_kinds = {n.kind for m in mixes for n in m.non_quran}
    assert {NonQuranKind.ISTIADHA, NonQuranKind.TAKBIR, NonQuranKind.AMIN} <= non_quran_kinds
    assert any(i.status is Status.INFERRED for m in mixes for i in m.expected)

    matcher = FlowVerseMatcher(
        corpus, word_corrections=build_word_corrections(corpus, simple_clean)
    )
    decoder = DecoderConfig()
    metrics = evaluate(matcher, cases, decoder.min_recognized_score, decoder.uncertainty_ratio)
    assert metrics.n == len(cases)
    assert metrics.false_named == 0


def test_deux_mixages_strictement_identiques_ne_sont_pas_produits(corpus):
    class Tiny(SyntheticProvider):
        def reciters(self) -> tuple[str, ...]:
            return ("seul",)

        def surahs(self, reciter: str) -> tuple[int, ...]:
            return (112,)

    report = generate_mixes(
        Tiny(corpus),
        corpus,
        seed=1,
        per_scenario=4,
        scenarios=("verset1_avec_basmala",),
        config=CFG,
    )
    assert len(report.mixes) == 1  # 112:1 est le seul choix : un seul mixage distinct
    assert report.skipped and "variété" in report.skipped[0][1]
