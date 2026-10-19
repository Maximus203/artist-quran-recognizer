"""Alignement forcé d'un passage connu sur un treillis CTC (ADR-0006).

Treillis synthétiques et encodeur factice : l'algorithme se vérifie sans modèle. La mesure sur un
vrai modèle est dans tests/contract/ (marqueur `slow`) et docs/evaluation/.
"""

from __future__ import annotations

import math

import pytest

from aqr.alignment.forced import AlignmentConfig, PassageAligner
from aqr.corpus.alignment_text import AlignmentTexts, AlignmentVariant
from aqr.domain.models import VerseRef, WordSpan
from aqr.domain.ports import CtcLattice

BLANK = 0
V1 = VerseRef(2, 21)
V2 = VerseRef(2, 22)

# Encodeur factice : un symbole par mot imla'i (variante sans voyelles 1..5, avec voyelles 6..10).
SYMBOLS = {
    "يا": 1, "أيها": 2, "الناس": 3, "ربكم": 4, "الذي": 5,
    "يَا": 6, "أَيُّهَا": 7, "النَّاسُ": 8, "رَبَّكُمُ": 9, "الَّذِي": 10,
}  # fmt: skip
VOCAB = 11


def encode(text: str) -> tuple[int, ...]:
    return (SYMBOLS[text],)


def texts() -> AlignmentTexts:
    return AlignmentTexts(
        uthmani={V1: ("يَـٰٓأَيُّهَا", "ٱلنَّاسُ"), V2: ("رَبَّكُمُ", "ٱلَّذِى")},
        imlai={
            AlignmentVariant.BARE: {V1: ("يا", "أيها", "الناس"), V2: ("ربكم", "الذي")},
            AlignmentVariant.VOCALIZED: {
                V1: ("يَا", "أَيُّهَا", "النَّاسُ"),
                V2: ("رَبَّكُمُ", "الَّذِي"),
            },
        },
    )


def lattice(path: list[int], start_s: float = 10.0, frame_s: float = 0.08) -> CtcLattice:
    """Une trame par élément de `path`, probabilité 0,97 sur ce symbole."""
    rest = 0.03 / (VOCAB - 1)
    rows = [[math.log(0.97 if v == s else rest) for v in range(VOCAB)] for s in path]
    return CtcLattice(log_probs=rows, blank=BLANK, start_s=start_s, frame_s=frame_s)


def aligner(**config: float) -> PassageAligner:
    return PassageAligner(texts(), encode, AlignmentConfig(**config))


def test_les_mots_et_versets_recoivent_leurs_temps_absolus():
    # trames : 0 1(يا) 2(أيها) 3 4(الناس) 5 6 7(ربكم) 8(الذي) 9
    lat = lattice([0, 1, 2, 0, 3, 0, 0, 4, 5, 0])
    result = aligner().align(lat, [WordSpan(V1, 1, 2), WordSpan(V2, 1, 2)])
    assert result is not None
    assert result.variant is AlignmentVariant.BARE
    first, second = result.spans
    assert first.span == WordSpan(V1, 1, 2)
    # mot Uthmani 1 = « يا أيها » (trames 1-2), mot 2 = « الناس » (trame 4)
    assert [(w.word, w.time.start_s, w.time.end_s) for w in first.words] == [
        (1, pytest.approx(10.08), pytest.approx(10.32)),
        (2, pytest.approx(10.32), pytest.approx(10.40)),
    ]
    assert first.time.start_s == pytest.approx(10.08)
    assert first.time.end_s == pytest.approx(10.40)
    # la pause entre les deux versets (trames 5-6) n'appartient à aucun des deux
    assert second.time.start_s == pytest.approx(10.56)
    assert second.time.end_s == pytest.approx(10.72)


def test_dans_un_verset_les_mots_sont_contigus():
    lat = lattice([1, 0, 0, 2, 3])
    result = aligner().align(lat, [WordSpan(V1, 1, 2)])
    assert result is not None
    words = result.spans[0].words
    assert words[0].time.end_s == pytest.approx(words[1].time.start_s)


def test_la_variante_qui_explique_le_mieux_l_audio_est_retenue():
    lat = lattice([6, 7, 0, 8])
    result = aligner().align(lat, [WordSpan(V1, 1, 2)])
    assert result is not None and result.variant is AlignmentVariant.VOCALIZED
    assert result.evidence.llr_per_frame == pytest.approx(0.0, abs=1e-9)


def test_preuve_acoustique_mauvais_texte_fortement_penalise():
    lat = lattice([1, 2, 0, 3])
    right = aligner().align(lat, [WordSpan(V1, 1, 2)])
    wrong = aligner().align(lat, [WordSpan(V2, 1, 2)])
    assert right is not None and wrong is not None
    assert wrong.evidence.llr_per_frame < right.evidence.llr_per_frame - 1.0


def test_texte_trop_long_pour_le_passage_donne_none():
    assert aligner().align(lattice([1, 2]), [WordSpan(V1, 1, 2), WordSpan(V2, 1, 2)]) is None


def test_plage_partielle():
    lat = lattice([0, 3, 0])
    result = aligner().align(lat, [WordSpan(V1, 2, 2)])
    assert result is not None
    assert [w.word for w in result.spans[0].words] == [2]


def test_la_fin_du_verset_peut_etre_prolongee_sans_depasser_le_suivant():
    lat = lattice([1, 2, 3, 0, 0, 0, 0, 4, 5])
    result = aligner(verse_end_extension_s=0.16).align(
        lat, [WordSpan(V1, 1, 2), WordSpan(V2, 1, 2)]
    )
    assert result is not None
    assert result.spans[0].time.end_s == pytest.approx(10.24 + 0.16)
    short = aligner(verse_end_extension_s=5.0).align(lat, [WordSpan(V1, 1, 2), WordSpan(V2, 1, 2)])
    assert short is not None
    assert short.spans[0].time.end_s == pytest.approx(short.spans[1].time.start_s)
    assert short.spans[1].time.end_s == pytest.approx(lat.time_of(lat.frames))


def test_aucune_plage_refusee():
    with pytest.raises(ValueError):
        aligner().align(lattice([1]), [])


def lattice_rms(path: list[int], rms: list[float]) -> CtcLattice:
    base = lattice(path)
    return CtcLattice(base.log_probs, base.blank, base.start_s, base.frame_s, frame_rms=rms)


def test_l_energie_prolonge_un_son_tenu_jusqu_au_silence():
    # « الناس » émis trame 2, voix tenue trames 3-4, silence trames 5-6, verset suivant trame 7.
    path = [1, 2, 3, 0, 0, 0, 0, 4, 5]
    rms = [0.5, 0.5, 0.5, 0.4, 0.3, 0.001, 0.001, 0.5, 0.5]
    spans = [WordSpan(V1, 1, 2), WordSpan(V2, 1, 2)]
    result = aligner(energy_ratio=0.1).align(lattice_rms(path, rms), spans)
    assert result is not None
    assert result.spans[0].time.end_s == pytest.approx(10.0 + 5 * 0.08)
    assert result.spans[0].words[-1].time.end_s == pytest.approx(10.0 + 5 * 0.08)


def test_l_energie_avance_un_debut_emis_en_retard_sans_mordre_sur_le_verset_precedent():
    path = [1, 2, 3, 0, 0, 0, 4, 5, 0]
    rms = [0.5, 0.5, 0.5, 0.001, 0.4, 0.4, 0.5, 0.5, 0.001]
    spans = [WordSpan(V1, 1, 2), WordSpan(V2, 1, 2)]
    result = aligner(energy_ratio=0.1).align(lattice_rms(path, rms), spans)
    assert result is not None
    assert result.spans[0].time.end_s == pytest.approx(10.24)
    assert result.spans[1].time.start_s == pytest.approx(10.0 + 4 * 0.08)
    assert result.spans[1].words[0].time.start_s == pytest.approx(10.0 + 4 * 0.08)


def test_sans_energie_dans_le_treillis_le_reglage_est_sans_effet():
    path = [1, 2, 3, 0, 0]
    with_ratio = aligner(energy_ratio=0.1).align(lattice(path), [WordSpan(V1, 1, 2)])
    without = aligner().align(lattice(path), [WordSpan(V1, 1, 2)])
    assert with_ratio == without


def test_un_symbole_pose_sur_le_silence_ne_prolonge_pas_le_verset():
    # « الناس » placé trame 6, dans le silence qui suit la voix (trames 0-3).
    path = [1, 2, 0, 0, 0, 0, 3]
    rms = [0.5, 0.5, 0.4, 0.3, 0.001, 0.001, 0.001]
    result = aligner(energy_ratio=0.1).align(lattice_rms(path, rms), [WordSpan(V1, 1, 2)])
    assert result is not None
    span = result.spans[0]
    # le verset s'arrête avec la voix, mais le dernier mot garde au moins sa trame
    assert span.time.end_s == pytest.approx(10.0 + 7 * 0.08)
    retract = [1, 2, 3, 0, 0, 0, 0]
    result = aligner(energy_ratio=0.1).align(lattice_rms(retract, rms), [WordSpan(V1, 1, 2)])
    assert result is not None
    assert result.spans[0].time.end_s == pytest.approx(10.0 + 4 * 0.08)


def test_un_debut_pose_sur_le_silence_est_avance_jusqu_a_la_voix():
    path = [1, 0, 0, 2, 3]
    rms = [0.001, 0.001, 0.5, 0.5, 0.5]
    result = aligner(energy_ratio=0.1).align(lattice_rms(path, rms), [WordSpan(V1, 1, 2)])
    assert result is not None
    # « يا » est posé trame 0 sur du silence : le verset commence avec la voix, au plus tard au
    # dernier symbole de son premier mot (ici trame 3, « أيها »)
    assert result.spans[0].time.start_s == pytest.approx(10.0 + 2 * 0.08)


def test_silence_numerique_l_energie_ne_deplace_aucune_limite():
    path = [1, 2, 3, 0, 0]
    rms = [0.0] * 5
    result = aligner(energy_ratio=0.1).align(lattice_rms(path, rms), [WordSpan(V1, 1, 2)])
    assert result is not None
    assert result.spans[0].time.start_s == pytest.approx(10.0)
    assert result.spans[0].time.end_s == pytest.approx(10.24)


def test_une_formule_declaree_coupe_le_verset_qui_l_aurait_absorbee():
    from aqr.corpus.alignment_text import FORMULA_TEXTS, Formula
    from aqr.domain.models import NonQuranKind

    amin = FORMULA_TEXTS[NonQuranKind.AMIN]
    SYMBOLS[amin[AlignmentVariant.BARE]] = 4  # réutilise un symbole libre de ce test
    SYMBOLS[amin[AlignmentVariant.VOCALIZED]] = 9
    try:
        # « يا أيها الناس » trames 0-2, voix continue, « آمين » trames 4-5
        path = [1, 2, 3, 0, 4, 4]
        rms = [0.5] * 6
        result = aligner(energy_ratio=0.1).align(
            lattice_rms(path, rms), [WordSpan(V1, 1, 2), Formula(NonQuranKind.AMIN)]
        )
    finally:
        del SYMBOLS[amin[AlignmentVariant.BARE]], SYMBOLS[amin[AlignmentVariant.VOCALIZED]]
    assert result is not None
    verse, formula = result.spans
    assert verse.time.end_s == pytest.approx(formula.time.start_s)
    assert formula.span == Formula(NonQuranKind.AMIN)
    assert formula.words[0].ref is None
    assert formula.time.start_s == pytest.approx(10.0 + 4 * 0.08)
