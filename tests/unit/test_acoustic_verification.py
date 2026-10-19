"""Vérification acoustique des suites de versets et temps au mot (étape B, ADR-0008).

Treillis synthétiques (un modèle CTC factice « entend » des mots à des instants donnés) et mini
corpus : la logique se vérifie sans modèle ni corpus téléchargé. La mesure sur le vrai FastConformer
est dans docs/evaluation/acoustic-check-2026-10-19.md.
"""

from __future__ import annotations

import math

import pytest

from aqr.alignment.forced import AlignmentConfig
from aqr.alignment.verification import AcousticCheckConfig, AcousticVerifier
from aqr.corpus.alignment_text import AlignmentTexts, AlignmentVariant
from aqr.decoding.chains import ChainConfig
from aqr.domain.models import TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import AudioClip, Candidate, CtcLattice

# Mini corpus : Uthmani (indices des mots) et imla'i sans voyelles (texte aligné).
VERSES = {
    VerseRef(55, 1): ("بسم", "الله", "الرحمن", "الرحيم", "الرحمن"),
    VerseRef(55, 2): ("علم", "القرآن"),
    VerseRef(55, 3): ("خلق", "الإنسان"),
    VerseRef(55, 4): ("علمه", "البيان"),
    VerseRef(55, 5): ("الشمس", "والقمر", "بحسبان"),
    VerseRef(55, 6): ("والنجم", "والشجر", "يسجدان"),
    VerseRef(16, 4): ("خلق", "الإنسان", "من", "نطفة"),
}
OTHER = ("كتاب", "بيت", "رجل", "ماء", "باب", "قلم")
SYMBOLS = {
    w: i for i, w in enumerate(sorted({*OTHER, *(w for ws in VERSES.values() for w in ws)}), 1)
}
VOCAB = len(SYMBOLS) + 1
BLANK = 0
FRAME = 0.08
CLIP = AudioClip(samples=(0.0,) * 16000 * 60, sample_rate=16000, source="mem")


class _Corpus:
    def words(self, ref: VerseRef) -> tuple[str, ...]:
        return VERSES[ref]


class _Model:
    """« Entend » chaque mot de `said` pendant 3 trames depuis son instant ; du blanc ailleurs."""

    engine = "fake-ctc@test"

    def __init__(self, said: list[tuple[float, str]]) -> None:
        self.said = said
        self.passages: list[TimeSpan] = []

    def encode(self, text: str) -> tuple[int, ...]:
        return (SYMBOLS[text],)

    def lattice(self, clip: AudioClip, span: TimeSpan) -> CtcLattice:
        self.passages.append(span)
        frames = [BLANK] * round(span.duration_s / FRAME)
        for time, word in self.said:
            first = round((time - span.start_s) / FRAME)
            for f in range(first, first + 3):
                if 0 <= f < len(frames):
                    frames[f] = SYMBOLS[word]
        rest = 0.03 / (VOCAB - 1)
        rows = [[math.log(0.97 if v == s else rest) for v in range(VOCAB)] for s in frames]
        return CtcLattice(log_probs=rows, blank=BLANK, start_s=span.start_s, frame_s=FRAME)


def texts() -> AlignmentTexts:
    return AlignmentTexts(uthmani=dict(VERSES), imlai={AlignmentVariant.BARE: dict(VERSES)})


def window(i: int) -> TimeSpan:
    return TimeSpan(3.0 * i, 3.0 * i + 2.5)


def recited(*items: tuple[int, VerseRef, int, int]) -> list[tuple[float, str]]:
    """Mots réellement dits : (fenêtre, verset, premier mot, dernier mot), 0,5 s d'écart."""
    out: list[tuple[float, str]] = []
    for i, ref, first, last in items:
        for n, word in enumerate(VERSES[ref][first - 1 : last]):
            out.append((3.0 * i + 0.4 + 0.5 * n, word))
    return out


def said_other(i: int, count: int = 2) -> list[tuple[float, str]]:
    return [(3.0 * i + 0.4 + 0.5 * n, OTHER[n]) for n in range(count)]


def cand(ref: str, first: int, last: int, explained: float, quality: float = 1.0) -> Candidate:
    return Candidate(
        span=WordSpan(VerseRef.parse(ref), first, last),
        score=quality * min(1.0, explained / 5.0),
        quality=quality,
        explained=explained,
    )


def verifier(model: _Model, max_passage_s: float = 120.0, **config) -> AcousticVerifier:
    config.setdefault("min_llr_per_frame", -0.5)
    return AcousticVerifier(
        model=model,
        texts=texts(),
        corpus=_Corpus(),
        chain=ChainConfig(),
        config=AcousticCheckConfig(**config),
        alignment=AlignmentConfig(variants=(AlignmentVariant.BARE,)),
        max_passage_s=max_passage_s,
        floor=0.75,
    )


def scores(observations) -> list[dict[str, float]]:
    return [{str(c.span.ref): round(c.score, 2) for c in cands} for _t, cands in observations]


# Cas réel (2026-10-19, Muno, voix de Cherif) : « عَلَّمَ » amputé en « لَّمَ » au début de sa
# fenêtre ; le matcher ne propose que 55:2 [2-2] (qualité 0,5) et la suite textuelle se coupe.
MUNO_55 = [
    (window(0), [cand("55:1", 5, 5, 1.0)]),
    (window(1), [cand("55:2", 2, 2, 1.0, quality=0.5)]),
    (window(2), [cand("16:4", 1, 2, 2.0), cand("55:3", 1, 2, 2.0)]),
    (window(3), [cand("55:4", 1, 2, 2.0)]),
]
SAID_55 = recited(
    (0, VerseRef(55, 1), 5, 5),
    (1, VerseRef(55, 2), 1, 2),
    (2, VerseRef(55, 3), 1, 2),
    (3, VerseRef(55, 4), 1, 2),
)


def test_le_maillon_ampute_est_sauve_par_l_audio():
    observations, checks = verifier(_Model(SAID_55)).verify(CLIP, MUNO_55)
    assert scores(observations) == [
        {"55:1": 1.0},
        {"55:2": 0.75},  # sauvé par l'audio : il franchit le seuil, sans plus
        {"16:4": 0.4, "55:3": 1.0},  # l'homonyme hors de la suite reste plafonné
        {"55:4": 1.0},
    ]
    (check,) = checks
    assert check.accepted and check.llr_per_frame == pytest.approx(0.0, abs=1e-6)
    assert check.spans[1] == WordSpan(VerseRef(55, 2), 1, 2)
    assert check.time == TimeSpan(0.0, 11.5)


def test_le_maillon_sauve_couvre_les_mots_que_l_audio_contient_avec_leurs_temps():
    observations, _checks = verifier(_Model(SAID_55)).verify(CLIP, MUNO_55)
    rescued = observations[1][1][0]
    assert rescued.span == WordSpan(VerseRef(55, 2), 1, 2)  # « عَلَّمَ » retrouvé
    (time,) = rescued.times
    assert time.start_s == pytest.approx(3.4, abs=FRAME) and 3.9 < time.end_s <= 5.5


def test_une_suite_que_l_audio_ne_soutient_pas_est_refusee_meme_si_le_texte_la_prouve():
    strong = [(window(i), [cand(f"55:{i + 3}", 1, 2, 2.0)]) for i in range(3)]
    said = said_other(0, 3) + said_other(1, 3) + said_other(2, 3)
    observations, (check,) = verifier(_Model(said)).verify(CLIP, strong)
    assert not check.accepted and check.llr_per_frame is not None
    assert check.llr_per_frame < -0.5
    assert scores(observations) == [{"55:3": 0.4}, {"55:4": 0.4}, {"55:5": 0.4}]
    assert all(not c.times for _t, cands in observations for c in cands)


def test_un_maillon_faible_refuse_ne_condamne_pas_la_suite_que_le_texte_prouve():
    observations = [
        (window(0), [cand("55:2", 1, 2, 2.0)]),
        (window(1), [cand("55:3", 1, 2, 2.0)]),
        (window(2), [cand("55:4", 1, 2, 2.0)]),
        (window(3), [cand("55:5", 1, 1, 1.0, quality=0.5)]),
    ]
    said = recited(
        (0, VerseRef(55, 2), 1, 2), (1, VerseRef(55, 3), 1, 2), (2, VerseRef(55, 4), 1, 2)
    ) + said_other(3, 4)
    out, checks = verifier(_Model(said)).verify(CLIP, observations)
    assert [c.accepted for c in checks] == [False, True]  # la suite longue, puis celle du texte
    assert scores(out) == [{"55:2": 1.0}, {"55:3": 1.0}, {"55:4": 1.0}, {"55:5": 0.1}]


def test_un_verset_prouve_seul_recoit_ses_temps_au_mot():
    alone = [(window(4), [cand("55:5", 1, 3, 3.0, quality=0.9), cand("55:6", 1, 3, 3.0, 0.4)])]
    alone[0][1][0] = Candidate(
        span=WordSpan(VerseRef(55, 5), 1, 3), score=0.9, quality=0.9, explained=5.0
    )
    observations, checks = verifier(_Model(recited((4, VerseRef(55, 5), 1, 3)))).verify(CLIP, alone)
    assert checks == ()
    best, weak = observations[0][1]
    assert best.score == 0.9 and len(best.times) == 1
    assert best.times[0].start_s == pytest.approx(12.4, abs=FRAME)
    assert weak.times == ()  # sous le seuil : jamais aligné


def test_un_verset_prouve_seul_que_l_audio_ne_soutient_pas_garde_les_bords_de_sa_fenetre():
    alone = [
        (window(4), [Candidate(WordSpan(VerseRef(55, 5), 1, 3), 0.9, quality=0.9, explained=5.0)])
    ]
    observations, _checks = verifier(_Model(said_other(4, 4))).verify(CLIP, alone)
    (best,) = observations[0][1]
    assert best.score == 0.9 and best.times == ()


def test_une_longue_suite_est_verifiee_par_passages_que_le_modele_peut_traiter():
    model = _Model(SAID_55)
    _out, checks = verifier(model, max_passage_s=6.0).verify(CLIP, MUNO_55)
    assert all(p.duration_s <= 6.0 for p in model.passages)
    assert [c.time for c in checks] == [TimeSpan(0.0, 5.5), TimeSpan(6.0, 11.5)]


def test_sans_temps_au_mot_seuls_les_scores_changent():
    observations, _checks = verifier(_Model(SAID_55), word_times=False).verify(CLIP, MUNO_55)
    assert scores(observations)[1] == {"55:2": 0.75}
    assert observations[1][1][0].span == WordSpan(VerseRef(55, 2), 2, 2)
    assert all(not c.times for _t, cands in observations for c in cands)


def test_un_texte_trop_long_pour_le_passage_est_refuse():
    short = [
        (TimeSpan(0.0, 0.1), MUNO_55[0][1]),
        (TimeSpan(0.1, 0.2), [cand("55:2", 1, 2, 2.0)]),
        (TimeSpan(0.2, 0.3), [cand("55:3", 1, 2, 2.0)]),
    ]
    observations, (check,) = verifier(_Model([])).verify(CLIP, short)
    assert not check.accepted and check.llr_per_frame is None
    assert scores(observations)[1] == {"55:2": 0.4}


def test_seuil_absent_refuse_d_etre_construit():
    with pytest.raises(ValueError, match="désactivée"):
        verifier(_Model([]), min_llr_per_frame=None)
