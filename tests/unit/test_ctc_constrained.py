"""Décodage contraint au corpus : preuve acoustique d'un texte candidat sur un treillis CTC.

Treillis synthétiques (aucun modèle) : le principe se vérifie sans GPU ; son branchement sur un vrai
modèle CTC reste à mesurer (voir docs/adr/0005).
"""

from __future__ import annotations

import math

import pytest

from aqr.decoding.ctc_constrained import (
    AcousticGate,
    CtcEvidence,
    acoustic_support,
    ctc_forced_align,
    ctc_free_logprob,
    verify_candidates,
)
from aqr.domain.models import VerseRef, WordSpan
from aqr.domain.ports import Candidate

BLANK = 0
NEG = math.log(1e-9)


def _lattice(path: list[int], vocab: int = 5, sharp: float = 0.97) -> list[list[float]]:
    """Une trame par élément de `path`, probabilité `sharp` sur ce symbole."""
    rest = (1.0 - sharp) / (vocab - 1)
    return [[math.log(sharp if v == sym else rest) for v in range(vocab)] for sym in path]


def test_le_texte_dit_est_aussi_bon_que_le_meilleur_chemin_libre():
    frames = _lattice([1, BLANK, 2, BLANK, 3])
    evidence = acoustic_support(frames, [1, 2, 3], BLANK)
    assert evidence.llr_per_frame == pytest.approx(0.0, abs=1e-9)
    assert evidence.frames == 5


def test_un_texte_different_de_ce_qui_est_dit_est_fortement_penalise():
    frames = _lattice([1, BLANK, 2, BLANK, 3])
    right = acoustic_support(frames, [1, 2, 3], BLANK)
    wrong = acoustic_support(frames, [1, 3, 2], BLANK)
    assert wrong.llr_per_frame < right.llr_per_frame - 1.0


def test_symbole_repete_exige_un_blanc_entre_les_deux():
    assert acoustic_support(_lattice([1, 1]), [1, 1], BLANK).forced_logprob == -math.inf
    ok = acoustic_support(_lattice([1, BLANK, 1]), [1, 1], BLANK)
    assert ok.forced_logprob > -math.inf


def test_trop_peu_de_trames_pour_le_texte():
    assert acoustic_support(_lattice([1, 2]), [1, 2, 3], BLANK).forced_logprob == -math.inf


def test_chemin_libre_est_la_somme_des_maxima_par_trame():
    frames = _lattice([1, 2, 3])
    assert ctc_free_logprob(frames) == pytest.approx(3 * math.log(0.97))


def test_alignement_forces_un_intervalle_de_trames_par_symbole_dans_l_ordre():
    frames = _lattice([BLANK, 1, 1, BLANK, 2, 3, 3])
    logprob, spans = ctc_forced_align(frames, [1, 2, 3], BLANK)
    assert logprob > -math.inf
    assert spans == [(1, 2), (4, 4), (5, 6)]
    assert all(a <= b for a, b in spans)
    assert all(spans[i][1] < spans[i + 1][0] for i in range(len(spans) - 1))


def test_parole_hors_sujet_donne_un_rapport_defavorable():
    # Trames où le modèle émet autre chose que le texte candidat (symbole 4 partout).
    frames = _lattice([4, 4, 4, 4, 4, 4])
    evidence = acoustic_support(frames, [1, 2, 3], BLANK)
    assert evidence.llr_per_frame < -1.0


def test_entrees_invalides():
    with pytest.raises(ValueError, match="vide"):
        acoustic_support(_lattice([1, 2]), [], BLANK)
    with pytest.raises(ValueError, match="trame"):
        acoustic_support([], [1], BLANK)
    with pytest.raises(ValueError, match="symbole"):
        acoustic_support(_lattice([1, 2], vocab=3), [7], BLANK)


def test_porte_acoustique_desactivee_par_defaut_ne_filtre_rien():
    ev = CtcEvidence(forced_logprob=-50.0, free_logprob=-1.0, llr_per_frame=-4.9, frames=10)
    assert AcousticGate().accepts(ev) is True


def test_porte_acoustique_rejette_sous_le_seuil_configure():
    gate = AcousticGate(min_llr_per_frame=-0.5)
    good = CtcEvidence(-1.2, -1.0, -0.02, 10)
    bad = CtcEvidence(-50.0, -1.0, -4.9, 10)
    assert gate.accepts(good) is True
    assert gate.accepts(bad) is False
    assert gate.accepts(CtcEvidence(-math.inf, -1.0, -math.inf, 10)) is False


# --- Candidats du matcher confrontés à l'audio ------------------------------------------------
def _cand(surah: int, ayah: int, text: str) -> tuple[Candidate, str]:
    return Candidate(WordSpan(VerseRef(surah, ayah), 1, len(text)), 0.9), text


def test_verify_candidates_ecarte_le_candidat_que_l_audio_ne_soutient_pas():
    frames = _lattice([1, BLANK, 2, BLANK, 3])  # l'audio dit « abc » (a=1, b=2, c=3)
    good, wrong = _cand(112, 1, "abc"), _cand(2, 255, "acb")
    texts = {id(good[0]): good[1], id(wrong[0]): wrong[1]}
    kept = verify_candidates(
        [good[0], wrong[0]],
        frames,
        BLANK,
        candidate_text=lambda c: texts[id(c)],
        encode=lambda text: [ord(ch) - ord("a") + 1 for ch in text],
        gate=AcousticGate(min_llr_per_frame=-0.5),
    )
    assert [c.span.ref for c, _ in kept] == [VerseRef(112, 1)]
    assert kept[0][1].llr_per_frame == pytest.approx(0.0, abs=1e-9)


def test_verify_candidates_porte_desactivee_garde_tout_et_joint_la_preuve():
    frames = _lattice([1, BLANK, 2, BLANK, 3])
    good, wrong = _cand(112, 1, "abc"), _cand(2, 255, "acb")
    texts = {id(good[0]): good[1], id(wrong[0]): wrong[1]}
    kept = verify_candidates(
        [good[0], wrong[0]],
        frames,
        BLANK,
        candidate_text=lambda c: texts[id(c)],
        encode=lambda text: [ord(ch) - ord("a") + 1 for ch in text],
        gate=AcousticGate(),
    )
    assert len(kept) == 2
    assert kept[1][1].llr_per_frame < kept[0][1].llr_per_frame
