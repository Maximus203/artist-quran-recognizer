"""Preuve cumulée par la suite (étape B) : des versets courts, chacun sous le seuil faute de mots,
se confirment quand ils se suivent dans le Mushaf sur des fenêtres consécutives.

Cas d'origine (2026-10-19, voix de Cherif au micro, trois moteurs) : basmala puis 55:1-4, chaque
fenêtre parfaitement transcrite, bon verset en tête, mais 2 mots = score plafonné à 0,40 < 0,75 :
aucun verset nommé. Un fragment isolé, lui, doit rester une abstention (I3).
"""

from __future__ import annotations

import pytest

from aqr.decoding.chains import ChainConfig, chain_spans, find_chains, promote_chains
from aqr.domain.models import TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import Candidate

WORDS = {VerseRef(55, 1): 5, VerseRef(55, 2): 2, VerseRef(55, 3): 2, VerseRef(55, 4): 2}


class _Corpus:
    def words(self, ref: VerseRef) -> tuple[str, ...]:
        return ("w",) * WORDS.get(ref, 9)


def cand(ref: str, first: int, last: int, explained: float, quality: float = 1.0) -> Candidate:
    score = quality * min(1.0, explained / 5.0)
    return Candidate(
        span=WordSpan(VerseRef.parse(ref), first, last),
        score=score,
        quality=quality,
        explained=explained,
    )


def window(i: int) -> TimeSpan:
    return TimeSpan(3.0 * i, 3.0 * i + 2.5)


def run(observations, **config):
    return promote_chains(observations, _Corpus(), ChainConfig(**config))


def best(observation) -> tuple[str, float]:
    top = max(observation[1], key=lambda c: c.score)
    return str(top.span.ref), round(top.score, 2)


def test_ar_rahman_1_4_au_micro_les_quatre_versets_se_confirment():
    observations = [
        (window(0), [cand("55:1", 5, 5, 1.0), cand("1:3", 1, 1, 1.0), cand("20:5", 1, 1, 1.0)]),
        (window(1), [cand("55:2", 1, 2, 2.0)]),
        (window(2), [cand("16:4", 1, 2, 2.0), cand("55:3", 1, 2, 2.0), cand("21:37", 1, 2, 2.0)]),
        (window(3), [cand("55:4", 1, 2, 2.0)]),
    ]
    promoted = run(observations)
    assert [best(o) for o in promoted] == [
        ("55:1", 1.0),
        ("55:2", 1.0),
        ("55:3", 1.0),
        ("55:4", 1.0),
    ]
    # les homonymes hors de la suite gardent leur score plafonné
    third = {str(c.span.ref): round(c.score, 2) for c in promoted[2][1]}
    assert third == {"16:4": 0.4, "55:3": 1.0, "21:37": 0.4}


def test_un_fragment_isole_reste_sous_le_seuil():
    observations = [(window(0), [cand("55:3", 1, 2, 2.0), cand("16:4", 1, 2, 2.0)])]
    assert [round(c.score, 2) for c in run(observations)[0][1]] == [0.4, 0.4]


def test_une_suite_trop_courte_en_mots_n_est_pas_promue():
    observations = [
        (window(0), [cand("55:2", 1, 2, 2.0)]),
        (window(1), [cand("55:3", 1, 2, 2.0)]),
    ]
    assert [best(o)[1] for o in run(observations)] == [0.4, 0.4]


def test_deux_versets_qui_ne_se_suivent_pas_ne_se_confirment_pas():
    observations = [
        (window(0), [cand("55:2", 1, 2, 2.0)]),
        (window(1), [cand("2:255", 3, 6, 4.0)]),
    ]
    assert [best(o)[1] for o in run(observations)] == [0.4, 0.8]


def test_une_fenetre_vide_coupe_la_suite():
    observations = [
        (window(0), [cand("55:2", 1, 2, 2.0)]),
        (window(1), []),
        (window(2), [cand("55:3", 1, 2, 2.0)]),
        (window(3), [cand("55:4", 1, 2, 2.0)]),
    ]
    assert [best(o)[1] for o in run(observations) if o[1]] == [0.4, 0.4, 0.4]


def test_qualite_insuffisante_jamais_promue():
    observations = [(window(i), [cand(f"55:{i + 2}", 1, 2, 2.0, quality=0.5)]) for i in range(3)]
    assert all(best(o)[1] == 0.2 for o in run(observations))


def test_verset_coupe_au_waqf_puis_repris_dans_la_fenetre_suivante():
    observations = [
        (window(0), [cand("2:255", 1, 3, 3.0)]),
        (window(1), [cand("2:255", 4, 6, 3.0)]),
    ]
    assert [best(o) for o in run(observations)] == [("2:255", 1.0), ("2:255", 1.0)]


def test_le_verset_precedent_doit_etre_fini_pour_passer_au_suivant():
    # 55:1 a 5 mots (basmala de Tanzil comprise) : s'arrêter au mot 2 n'enchaîne pas sur 55:2
    observations = [
        (window(0), [cand("55:1", 1, 2, 2.0)]),
        (window(1), [cand("55:2", 1, 2, 2.0)]),
        (window(2), [cand("55:3", 1, 2, 2.0)]),
    ]
    assert [best(o)[1] for o in run(observations)] == [0.4, 0.4, 0.4]


def test_desactive_rien_ne_change():
    observations = [(window(i), [cand(f"55:{i + 2}", 1, 2, 2.0)]) for i in range(3)]
    assert run(observations, enabled=False) == observations


def test_candidat_sans_qualite_connue_jamais_promu():
    plain = Candidate(span=WordSpan(VerseRef(55, 2), 1, 2), score=0.4)
    observations = [
        (window(0), [plain]),
        (window(1), [cand("55:3", 1, 2, 2.0)]),
        (window(2), [cand("55:4", 1, 2, 2.0)]),
    ]
    promoted = run(observations)
    assert promoted[0][1][0].score == 0.4


# --- Suites à vérifier acoustiquement (ADR-0008) -------------------------------------------------
# Cas réel (2026-10-19, Muno, voix de Cherif) : « عَلَّمَ » amputé en « لَّمَ » au début de sa
# fenêtre ; le matcher ne propose plus que 55:2 [2-2], qualité 0,5, un mot.
MUNO_55 = [
    (window(0), [cand("55:1", 5, 5, 1.0), cand("1:3", 1, 1, 1.0), cand("20:5", 1, 1, 1.0)]),
    (window(1), [cand("55:2", 2, 2, 1.0, quality=0.5), cand("2:185", 6, 6, 1.0, quality=0.5)]),
    (window(2), [cand("16:4", 1, 2, 2.0), cand("55:3", 1, 2, 2.0), cand("21:37", 1, 2, 2.0)]),
    (window(3), [cand("55:4", 1, 2, 2.0)]),
]


def refs(chain, observations) -> list[str]:
    return [str(observations[i][1][k].span.ref) for i, k in chain.links]


def test_le_maillon_ampute_coupe_la_suite_a_la_qualite_exigee():
    assert run(MUNO_55)[1][1][0].score == pytest.approx(0.1)
    assert find_chains(MUNO_55, _Corpus(), ChainConfig(), min_quality=0.75) == []


def test_avec_un_plancher_abaisse_la_suite_entiere_est_candidate_a_la_verification():
    (chain,) = find_chains(MUNO_55, _Corpus(), ChainConfig(), min_quality=0.5)
    assert refs(chain, MUNO_55) == ["55:1", "55:2", "55:3", "55:4"]
    assert chain.words == pytest.approx(6.0)


def test_une_suite_candidate_exige_toujours_assez_de_mots_et_deux_fenetres():
    short = [
        (window(0), [cand("55:2", 2, 2, 1.0, quality=0.5)]),
        (window(1), [cand("55:3", 1, 2, 2.0)]),
    ]
    assert find_chains(short, _Corpus(), ChainConfig(), min_quality=0.5) == []
    alone = [(window(0), [cand("2:255", 1, 9, 9.0)])]
    assert find_chains(alone, _Corpus(), ChainConfig(), min_quality=0.5) == []


def test_les_suites_au_plancher_du_matcher_sont_celles_que_la_preuve_textuelle_promeut():
    observations = [(window(i), [cand(f"55:{i + 2}", 1, 2, 2.0)]) for i in range(3)]
    (chain,) = find_chains(observations, _Corpus(), ChainConfig(), min_quality=0.75)
    assert chain.links == ((0, 0), (1, 0), (2, 0))


def test_texte_d_une_suite_comble_les_mots_que_l_asr_a_perdus():
    (chain,) = find_chains(MUNO_55, _Corpus(), ChainConfig(), min_quality=0.5)
    assert chain_spans(chain, MUNO_55, _Corpus()) == [
        WordSpan(VerseRef(55, 1), 5, 5),
        WordSpan(VerseRef(55, 2), 1, 2),
        WordSpan(VerseRef(55, 3), 1, 2),
        WordSpan(VerseRef(55, 4), 1, 2),
    ]


def test_texte_d_une_suite_coupee_au_waqf_est_un_seul_verset():
    observations = [
        (window(0), [cand("2:255", 1, 3, 3.0)]),
        (window(1), [cand("2:255", 4, 6, 3.0)]),
    ]
    (chain,) = find_chains(observations, _Corpus(), ChainConfig(), min_quality=0.75)
    assert chain_spans(chain, observations, _Corpus()) == [WordSpan(VerseRef(2, 255), 1, 6)]


def test_texte_d_une_suite_finit_le_verset_tronque_par_l_asr():
    # 2:21 a 9 mots (corpus factice) : l'ASR s'arrête au 8ᵉ, la suite continue sur 2:22
    observations = [(window(0), [cand("2:21", 1, 8, 8.0)]), (window(1), [cand("2:22", 1, 4, 4.0)])]
    (chain,) = find_chains(observations, _Corpus(), ChainConfig(), min_quality=0.75)
    assert chain_spans(chain, observations, _Corpus()) == [
        WordSpan(VerseRef(2, 21), 1, 9),
        WordSpan(VerseRef(2, 22), 1, 4),
    ]
