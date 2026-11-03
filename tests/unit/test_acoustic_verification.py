"""Vérification acoustique des suites de versets et temps au mot (étape B, ADR-0008).

Treillis synthétiques (un modèle CTC factice « entend » des mots à des instants donnés) et mini
corpus : la logique se vérifie sans modèle ni corpus téléchargé. La mesure sur le vrai FastConformer
est dans docs/evaluation/acoustic-check-2026-10-19.md.
"""

from __future__ import annotations

import math
from itertools import pairwise

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
    VerseRef(55, 7): ("والسماء", "رفعها", "ووضع", "الميزان"),
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
    unknown_symbol: int | None = None

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


class _ModelWithUnknown(_Model):
    """Le tokenizer rend `<unk>` pour une lettre de chaque mot (alif suscrit de Tanzil) ; le
    modèle ne l'émet jamais (ici : un mot qui n'est jamais dit)."""

    unknown_symbol = SYMBOLS[OTHER[-1]]

    def encode(self, text: str) -> tuple[int, ...]:
        return (SYMBOLS[text], self.unknown_symbol)


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


def test_un_symbole_que_le_modele_n_emet_jamais_n_est_pas_exige():
    observations, (check,) = verifier(_ModelWithUnknown(SAID_55)).verify(CLIP, MUNO_55)
    assert check.accepted and check.llr_per_frame == pytest.approx(0.0, abs=1e-6)
    assert scores(observations)[1] == {"55:2": 0.75}


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


def test_un_seul_treillis_par_fenetre_quel_que_soit_le_nombre_de_candidats():
    proven = Candidate(WordSpan(VerseRef(55, 5), 1, 3), 0.9, quality=0.9, explained=5.0)
    rival = Candidate(WordSpan(VerseRef(55, 6), 1, 3), 0.9, quality=0.9, explained=5.0)
    model = _Model(recited((4, VerseRef(55, 5), 1, 3)))
    verifier(model).verify(CLIP, [(window(4), [proven, rival])])
    assert model.passages == [window(4)]


def test_un_maillon_ne_deborde_pas_de_la_fenetre_ou_le_segmenteur_a_entendu_la_voix():
    # le dernier mot de 55:2 est posé à cheval sur la fin de sa fenêtre (5,5 s)
    said = [w for w in SAID_55 if w[1] != "القرآن"] + [(5.36, "القرآن")]
    observations, _checks = verifier(_Model(sorted(said))).verify(CLIP, MUNO_55)
    (time,) = observations[1][1][0].times
    assert time.end_s <= window(1).end_s


# --- Suite d'un verset commencé (un verset commencé est toujours récité jusqu'au bout) ----------
# Cas réels : lot1-06, 21:56 [1-8] puis 100-105 s en abstention ; 21:87 [2-10] puis 442-453 s.
def proven(ref: str, first: int, last: int) -> Candidate:
    """Candidat prouvé seul (assez de mots), plage partielle."""
    return Candidate(WordSpan(VerseRef.parse(ref), first, last), 0.9, quality=0.9, explained=5.0)


def weak(ref: str = "2:185") -> Candidate:
    return cand(ref, 6, 6, 1.0, quality=0.5)


BEGUN = [(window(4), [proven("55:5", 1, 2)]), (window(5), [weak()])]


def heard_of(observations, said) -> list[str]:
    """Ce que l'ASR aurait transcrit : les mots dits dans chaque fenêtre."""
    return [
        " ".join(w for t, w in said if time.start_s <= t < time.end_s) for time, _c in observations
    ]


def continuation(observations, said, heard=None, **config):
    heard = heard_of(observations, said) if heard is None else heard
    out, checks = verifier(_Model(said), **config).verify(CLIP, observations, heard=heard)
    return out, [c for c in checks if c.kind == "continuation"]


def test_la_suite_du_verset_commence_est_reconnue_avec_les_temps_de_l_alignement():
    said = recited((4, VerseRef(55, 5), 1, 2), (5, VerseRef(55, 5), 3, 3))
    out, (check,) = continuation(BEGUN, said)
    assert check.accepted
    rest = out[1][1][0]
    assert rest.spans == (WordSpan(VerseRef(55, 5), 3, 3),) and rest.score == 0.75
    assert rest.times[0].start_s == pytest.approx(15.4, abs=FRAME)
    assert [round(c.score, 2) for c in out[1][1][1:]] == [0.1]  # le faible reste, sous le seuil


def test_une_suite_que_l_audio_ne_soutient_pas_n_est_jamais_nommee():
    said = recited((4, VerseRef(55, 5), 1, 2)) + said_other(5, 4)
    out, (check,) = continuation(BEGUN, said)
    assert not check.accepted
    assert [c.span.ref for c in out[1][1]] == [VerseRef(2, 185)]


def test_reprise_de_quelques_mots_avant_la_coupure():
    said = recited((4, VerseRef(55, 5), 1, 2), (5, VerseRef(55, 5), 2, 3))
    out, _checks = continuation(BEGUN, said)
    assert out[1][1][0].spans == (WordSpan(VerseRef(55, 5), 2, 3),)


def test_la_suite_continue_sur_le_verset_suivant():
    said = [
        *recited((4, VerseRef(55, 5), 1, 2)),
        (15.4, "بحسبان"), (15.9, "والنجم"), (16.4, "والشجر"), (16.9, "يسجدان"),
    ]  # fmt: skip
    out, _checks = continuation(BEGUN, said)
    assert out[1][1][0].spans == (WordSpan(VerseRef(55, 5), 3, 3), WordSpan(VerseRef(55, 6), 1, 3))
    assert len(out[1][1][0].times) == 2


def test_une_suite_en_deux_souffles_se_poursuit_de_fenetre_en_fenetre():
    observations = [*BEGUN, (window(6), [])]
    said = [*recited((4, VerseRef(55, 5), 1, 2)), (15.4, "بحسبان"), (15.9, "والنجم")]
    said += recited((6, VerseRef(55, 6), 2, 3))
    out, checks = continuation(observations, said)
    assert [c.accepted for c in checks] == [True, True]
    assert out[1][1][0].spans == (WordSpan(VerseRef(55, 5), 3, 3), WordSpan(VerseRef(55, 6), 1, 1))
    assert out[2][1][0].spans == (WordSpan(VerseRef(55, 6), 2, 3),)


def test_une_formule_apres_le_verset_n_est_jamais_prise_pour_sa_suite():
    said = recited((4, VerseRef(55, 5), 1, 2), (5, VerseRef(55, 5), 3, 3))
    heard = heard_of(BEGUN, said)
    out, checks = verifier(_Model(said)).verify(CLIP, BEGUN, blocked={1}, heard=heard)
    assert [c for c in checks if c.kind == "continuation"] == []
    assert [c.span.ref for c in out[1][1]] == [VerseRef(2, 185)]


def test_rien_a_predire_si_le_verset_est_fini_ou_la_fenetre_suivante_reconnue():
    done = [(window(4), [proven("55:5", 1, 3)]), (window(5), [weak()])]
    assert continuation(done, [])[1] == []
    known = [(window(4), [proven("55:5", 1, 2)]), (window(5), [proven("55:6", 1, 3)])]
    assert continuation(known, [])[1] == []


def test_suite_desactivable():
    said = recited((4, VerseRef(55, 5), 1, 2), (5, VerseRef(55, 5), 3, 3))
    out, checks = continuation(BEGUN, said, continuation=False)
    assert checks == [] and [c.span.ref for c in out[1][1]] == [VerseRef(2, 185)]


def test_l_audio_seul_ne_suffit_pas_la_transcription_doit_temoigner():
    # Mesuré (lot1-04) : un mot de fin de verset s'aligne à bon compte sur de la parole non
    # coranique, rendue surtout en blancs (9:24 [22] sur « ليه يال لك هنا انتم », −0,55 par trame).
    said = recited((4, VerseRef(55, 5), 1, 2), (5, VerseRef(55, 5), 3, 3))
    heard = ["الشمس والقمر", "كتاب بيت رجل ماء"]
    out, (check,) = continuation(BEGUN, said, heard=heard)
    assert not check.accepted and check.llr_per_frame == pytest.approx(0.0, abs=1e-6)
    assert check.text_similarity is not None and check.text_similarity < 0.6
    assert [c.span.ref for c in out[1][1]] == [VerseRef(2, 185)]


def test_sans_transcription_aucune_suite_n_est_tentee():
    said = recited((4, VerseRef(55, 5), 1, 2), (5, VerseRef(55, 5), 3, 3))
    _out, checks = verifier(_Model(said)).verify(CLIP, BEGUN)
    assert [c for c in checks if c.kind == "continuation"] == []


# --- Temps au mot (ADR-0010) : la liste des mots de chaque plage, même ordre que `spans` --------
def test_un_verset_prouve_seul_porte_le_temps_de_chacun_de_ses_mots():
    alone = [(window(4), [proven("55:5", 1, 3)])]
    observations, _checks = verifier(_Model(recited((4, VerseRef(55, 5), 1, 3)))).verify(
        CLIP, alone
    )
    (best,) = observations[0][1]
    (words,) = best.word_times
    (time,) = best.times
    assert len(words) == 3
    assert words[0].start_s == time.start_s and words[-1].end_s == time.end_s
    assert [w.start_s for w in words] == pytest.approx([12.4, 12.9, 13.4], abs=FRAME)
    assert all(a.end_s <= b.start_s + 1e-9 for a, b in pairwise(words))


def test_le_maillon_sauve_porte_les_temps_de_ses_mots_dans_sa_fenetre():
    observations, _checks = verifier(_Model(SAID_55)).verify(CLIP, MUNO_55)
    rescued = observations[1][1][0]
    ((first, second),) = rescued.word_times  # « عَلَّمَ » retrouvé, puis « الْقُرْآنَ »
    assert first.start_s == pytest.approx(3.4, abs=FRAME)
    assert first.start_s == rescued.times[0].start_s and second.end_s == rescued.times[0].end_s
    assert window(1).start_s <= first.start_s and second.end_s <= window(1).end_s


def test_un_mot_a_cheval_sur_la_fin_de_la_fenetre_est_borne_comme_le_temps_du_verset():
    said = [w for w in SAID_55 if w[1] != "القرآن"] + [(5.36, "القرآن")]
    observations, _checks = verifier(_Model(sorted(said))).verify(CLIP, MUNO_55)
    ((_first, last),) = observations[1][1][0].word_times
    assert last.end_s <= window(1).end_s
    assert last.end_s == observations[1][1][0].times[0].end_s


def test_sans_temps_au_mot_aucune_liste_de_mots():
    observations, _checks = verifier(_Model(SAID_55), word_times=False).verify(CLIP, MUNO_55)
    assert all(not c.word_times for _t, cands in observations for c in cands)


def test_la_suite_d_un_verset_commence_porte_aussi_les_temps_de_ses_mots():
    said = recited((4, VerseRef(55, 5), 1, 2), (5, VerseRef(55, 5), 3, 3))
    out, _checks = continuation(BEGUN, said)
    (words,) = out[1][1][0].word_times
    assert len(words) == 1 and words[0].start_s == pytest.approx(15.4, abs=FRAME)


# --- Un candidat seul, soutenu par l'audio (promotion par le voisin, ADR-0010) -------------------
def test_un_candidat_soutenu_par_l_audio_est_confirme_avec_les_temps_de_l_alignement():
    candidate = proven("55:5", 1, 3)
    model = _Model(recited((4, VerseRef(55, 5), 1, 3)))
    check, confirmed = verifier(model).verify_alone(CLIP, window(4), candidate)
    assert check.kind == "neighbor" and check.accepted and check.time == window(4)
    assert check.spans == (WordSpan(VerseRef(55, 5), 1, 3),)
    assert confirmed is not None and confirmed.span == candidate.span
    assert confirmed.score >= 0.75 and len(confirmed.word_times[0]) == 3
    assert confirmed.times[0].start_s == pytest.approx(12.4, abs=FRAME)


def test_un_candidat_que_l_audio_ne_soutient_pas_n_est_pas_confirme():  # I3
    check, confirmed = verifier(_Model(said_other(4, 4))).verify_alone(
        CLIP, window(4), proven("55:5", 1, 3)
    )
    assert not check.accepted and confirmed is None
    assert check.llr_per_frame is not None and check.llr_per_frame < -0.5


def test_un_candidat_dont_le_texte_ne_tient_pas_dans_la_fenetre_n_est_pas_confirme():
    tiny = TimeSpan(12.0, 12.1)
    check, confirmed = verifier(_Model([])).verify_alone(CLIP, tiny, proven("55:7", 1, 4))
    assert not check.accepted and check.llr_per_frame is None and confirmed is None


# --- Le début d'un verset dont la suite est reconnue (amorce, ADR-0010) --------------------------
# Cas réel (lot2-05, récitation avec pauses) : « le récitant commence une partie du verset, fait
# une pause, continue » ; la fenêtre d'avant la pause reste une abstention, la suite est reconnue.
HEADED = [(window(4), [weak()]), (window(5), [proven("55:5", 3, 3)])]


def heads(observations, said, heard=None, **config):
    heard = heard_of(observations, said) if heard is None else heard
    out, checks = verifier(_Model(said), **config).verify(CLIP, observations, heard=heard)
    return out, [c for c in checks if c.kind == "head"]


def test_le_debut_d_un_verset_dont_la_suite_est_reconnue_est_reconnu_sur_l_audio():
    said = recited((4, VerseRef(55, 5), 1, 2), (5, VerseRef(55, 5), 3, 3))
    out, (check,) = heads(HEADED, said)
    assert check.accepted and check.time == window(4) and check.text_similarity is not None
    head = out[0][1][0]
    assert head.spans == (WordSpan(VerseRef(55, 5), 1, 2),) and head.score == 0.75
    (words,) = head.word_times
    assert len(words) == 2 and words[0].start_s == pytest.approx(12.4, abs=FRAME)
    assert out[0][1][1].span.ref == VerseRef(2, 185)  # le candidat faible reste, sous le seuil


def test_un_debut_que_l_audio_ne_soutient_pas_n_est_jamais_nomme():  # I3 (ex. autre riwaya)
    said = said_other(4, 4) + recited((5, VerseRef(55, 5), 3, 3))
    out, (check,) = heads(HEADED, said)
    assert not check.accepted
    assert [c.span.ref for c in out[0][1]] == [VerseRef(2, 185)]


def test_un_debut_soutenu_par_l_audio_mais_pas_par_la_transcription_n_est_pas_nomme():
    said = recited((4, VerseRef(55, 5), 1, 2), (5, VerseRef(55, 5), 3, 3))
    out, (check,) = heads(HEADED, said, heard=["كتاب بيت رجل ماء", "بحسبان"])
    assert not check.accepted and check.llr_per_frame == pytest.approx(0.0, abs=1e-6)
    assert check.text_similarity is not None and check.text_similarity < 0.6
    assert [c.span.ref for c in out[0][1]] == [VerseRef(2, 185)]


def test_rien_a_predire_si_la_suite_commence_le_verset_ou_si_l_avant_est_deja_reconnu():
    said = recited((4, VerseRef(55, 5), 1, 2), (5, VerseRef(55, 5), 3, 3))
    starts = [(window(4), [weak()]), (window(5), [proven("55:5", 1, 3)])]
    assert heads(starts, said)[1] == []
    known = [(window(4), [proven("55:6", 1, 3)]), (window(5), [proven("55:5", 3, 3)])]
    assert heads(known, said)[1] == []


def test_une_formule_avant_la_suite_n_est_jamais_prise_pour_son_debut():
    said = recited((4, VerseRef(55, 5), 1, 2), (5, VerseRef(55, 5), 3, 3))
    heard = heard_of(HEADED, said)
    out, checks = verifier(_Model(said)).verify(CLIP, HEADED, blocked={0}, heard=heard)
    assert [c for c in checks if c.kind == "head"] == []
    assert [c.span.ref for c in out[0][1]] == [VerseRef(2, 185)]


def test_le_trou_entre_deux_morceaux_reconnus_du_meme_verset_est_comble_sur_l_audio():
    # cas réel lot2-05 : 4:12 [1-47], pause (mots 48-56 non reconnus), puis [57-88]
    gap = [
        (window(3), [proven("55:7", 1, 1)]),
        (window(4), [weak()]),
        (window(5), [proven("55:7", 4, 4)]),
    ]
    said = recited(
        (3, VerseRef(55, 7), 1, 1), (4, VerseRef(55, 7), 2, 3), (5, VerseRef(55, 7), 4, 4)
    )
    out, (check,) = heads(gap, said, continuation=False)
    assert check.accepted
    assert out[1][1][0].spans == (WordSpan(VerseRef(55, 7), 2, 3),)  # ni le mot 1 ni le mot 4


def test_l_amorce_se_desactive():
    said = recited((4, VerseRef(55, 5), 1, 2), (5, VerseRef(55, 5), 3, 3))
    assert heads(HEADED, said, head=False)[1] == []
