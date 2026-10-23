"""Comblement de trou sur l'audio (ADR-0013) : l'hypothèse de texte n'est gardée que si la parole du
trou la soutient. Treillis synthétiques (un modèle CTC factice « entend » des mots à des instants
donnés) et mini corpus ; la mesure sur le vrai FastConformer est dans docs/evaluation/.
"""

from __future__ import annotations

import math

import pytest

from aqr.alignment.forced import AlignmentConfig
from aqr.alignment.verification import AcousticCheckConfig, AcousticVerifier
from aqr.corpus.alignment_text import AlignmentTexts, AlignmentVariant
from aqr.decoding.chains import ChainConfig
from aqr.decoding.gaps import (
    ROLE_BETWEEN,
    ROLE_CONTINUATION,
    ROLE_HEAD,
    ROLE_REPETITION,
    GapConfig,
    Hole,
    Hypothesis,
    propose,
)
from aqr.domain.models import Detection, Status, TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import AudioClip, CtcLattice

VERSES = {
    VerseRef(55, 1): ("بسم", "الله", "الرحمن", "الرحيم", "الرحمن"),
    VerseRef(55, 2): ("علم", "القرآن"),
    VerseRef(55, 3): ("خلق", "الإنسان"),
    VerseRef(55, 4): ("علمه", "البيان"),
    VerseRef(55, 5): ("الشمس", "والقمر", "بحسبان"),
    VerseRef(55, 6): ("والنجم", "والشجر", "يسجدان"),
    VerseRef(55, 7): ("والسماء", "رفعها", "ووضع", "الميزان"),
    VerseRef(55, 8): ("ألا", "تطغوا"),
}
OTHER = ("كتاب", "بيت", "رجل", "ماء", "باب", "قلم")
SYMBOLS = {
    w: i for i, w in enumerate(sorted({*OTHER, *(w for ws in VERSES.values() for w in ws)}), 1)
}
VOCAB = len(SYMBOLS) + 1
BLANK = 0
FRAME = 0.08
CLIP = AudioClip(samples=(0.0,) * 16000 * 120, sample_rate=16000, source="mem")


class _Corpus:
    def words(self, ref: VerseRef) -> tuple[str, ...]:
        return VERSES[ref]


class _Model:
    """« Entend » chaque mot de `said` pendant 3 trames depuis son instant ; du blanc ailleurs."""

    engine = "fake-ctc@test"
    unknown_symbol: int | None = None

    def __init__(self, said: list[tuple]) -> None:
        # (instant, mot), (instant, mot, probabilité) ou (instant, {mot: probabilité, …})
        self.said = said

    def encode(self, text: str) -> tuple[int, ...]:
        return (SYMBOLS[text],)

    def lattice(self, clip: AudioClip, span: TimeSpan) -> CtcLattice:
        frames: list[dict[int, float]] = [{} for _ in range(round(span.duration_s / FRAME))]
        for time, word, *prob in self.said:
            heard = word if isinstance(word, dict) else {word: prob[0] if prob else 0.97}
            first = round((time - span.start_s) / FRAME)
            for f in range(first, first + 3):
                if 0 <= f < len(frames):
                    frames[f] = {SYMBOLS[w]: p for w, p in heard.items()}
        rest = 0.03 / (VOCAB - 1)
        rows = []
        for symbols in frames:
            row = [rest] * VOCAB
            row[BLANK] = max(0.97 - sum(symbols.values()), 0.0) + rest if symbols else 0.97
            for symbol, p in symbols.items():
                row[symbol] = p
            rows.append([math.log(x) for x in row])
        return CtcLattice(log_probs=rows, blank=BLANK, start_s=span.start_s, frame_s=FRAME)


def texts() -> AlignmentTexts:
    return AlignmentTexts(uthmani=dict(VERSES), imlai={AlignmentVariant.BARE: dict(VERSES)})


def verifier(said: list[tuple[float, str]], **config) -> AcousticVerifier:
    config.setdefault("min_llr_per_frame", -1.0)
    return AcousticVerifier(
        model=_Model(said),
        texts=texts(),
        corpus=_Corpus(),
        chain=ChainConfig(),
        config=AcousticCheckConfig(**config),
        alignment=AlignmentConfig(variants=(AlignmentVariant.BARE,)),
        max_passage_s=120.0,
        floor=0.75,
    )


def say(start: float, ref: VerseRef, first: int, last: int, step: float = 0.5):
    return [(start + step * n, w) for n, w in enumerate(VERSES[ref][first - 1 : last])]


def heard(*parts: tuple[VerseRef, int, int]) -> str:
    return " ".join(w for ref, a, b in parts for w in VERSES[ref][a - 1 : b])


def det(ref: VerseRef, first: int, last: int, start: float, end: float) -> Detection:
    return Detection(WordSpan(ref, first, last), TimeSpan(start, end), Status.RECOGNIZED, 0.75)


V1, V2, V3, V4, V5, V6, V7 = (VerseRef(55, n) for n in range(1, 8))
CORPUS = _Corpus()


def run(hole, said, heard_text=None, *, hypotheses=None, competitors=(), **config):
    v = verifier(said, **config)
    hypotheses = propose(hole, CORPUS, GapConfig()) if hypotheses is None else hypotheses
    return v.verify_gap(CLIP, hole, hypotheses, heard_text, competitors)


def spans_of(candidate) -> list[tuple[int, int, int]]:
    return [(s.ref.ayah, s.first_word, s.last_word) for s in candidate.spans]


# --- Le début manquant d'un verset reconnu -------------------------------------------------------
def test_le_debut_manquant_est_reconnu_quand_l_audio_et_la_transcription_le_soutiennent():
    # 55:5 [2-3] reconnu à 20 s ; avant lui, dans le trou 8-20 s, « الشمس » est dit.
    hole = Hole(TimeSpan(8.0, 20.0), det(V4, 1, 2, 2.0, 8.0), det(V5, 2, 3, 20.0, 22.0))
    checks, fill = run(hole, say(14.0, V5, 1, 1), heard((V5, 1, 1)))
    assert fill is not None and fill.role == ROLE_BETWEEN and not fill.repeat
    assert spans_of(fill.candidate) == [(5, 1, 1)]
    (time,) = fill.candidate.times
    assert time.start_s >= 14.0 and time.end_s <= 14.6
    assert len(fill.candidate.word_times[0]) == 1
    (check,) = [c for c in checks if c.accepted]
    assert check.kind == "gap" and check.role == ROLE_BETWEEN and check.words == 1
    assert check.llr_per_frame == pytest.approx(0.0, abs=1e-6) and check.time == hole.passage


def test_un_trou_qui_dit_autre_chose_ne_donne_jamais_de_verset():  # I3
    hole = Hole(TimeSpan(8.0, 20.0), det(V4, 1, 2, 2.0, 8.0), det(V5, 2, 3, 20.0, 22.0))
    said = [(14.0 + 0.5 * n, w) for n, w in enumerate(OTHER[:3])]
    checks, fill = run(hole, said, " ".join(OTHER[:3]))
    assert fill is None and checks and not any(c.accepted for c in checks)


def test_la_preuve_est_mesuree_sur_la_parole_pas_sur_tout_le_trou():
    # 60 s de trou, deux mots de « autre chose » : par trame sur tout le passage, le mauvais texte
    # (« الشمس ») serait dilué dans les blancs et franchirait le seuil ; sur la parole, non.
    hole = Hole(TimeSpan(0.0, 60.0), None, det(V5, 2, 3, 60.0, 62.0))
    said = [(30.0, OTHER[0]), (30.5, OTHER[1])]
    checks, fill = run(hole, said, None)
    (check,) = checks
    assert fill is None and not check.accepted
    assert check.passage_llr_per_frame is not None and check.passage_llr_per_frame > -1.0  # dilué
    assert check.llr_per_frame is not None and check.llr_per_frame < -1.0  # la parole, non


def test_sans_transcription_seuls_les_courts_morceaux_a_forte_preuve_passent():
    hole = Hole(TimeSpan(0.0, 30.0), None, det(V7, 3, 4, 30.0, 32.0))
    _, fill = run(hole, say(5.0, V7, 1, 2), None)
    assert fill is not None and spans_of(fill.candidate) == [(7, 1, 2)]
    # quatre mots sans aucun témoin textuel : trop pour l'audio seul
    hole = Hole(TimeSpan(0.0, 30.0), None, det(V7, 5, 5, 30.0, 32.0))
    _, fill = run(hole, say(5.0, V7, 1, 4), None)
    assert fill is None


def test_une_transcription_qui_contredit_le_texte_bloque_meme_si_l_audio_le_soutient():
    hole = Hole(TimeSpan(8.0, 20.0), det(V4, 1, 2, 2.0, 8.0), det(V5, 2, 3, 20.0, 22.0))
    _, fill = run(hole, say(14.0, V5, 1, 1), " ".join(OTHER[:2]))
    assert fill is None


def test_une_transcription_pauvre_ne_bloque_pas_si_l_audio_soutient_fortement_le_texte():
    # Cas 3 : l'ASR comprend mal ce passage (similarité faible) mais l'alignement du texte du corpus
    # est quasi parfait. Similarité de la transcription entre les deux seuils.
    hole = Hole(TimeSpan(0.0, 30.0), det(V2, 1, 2, 0.0, 1.0), det(V7, 3, 4, 30.0, 32.0))
    said = say(5.0, V7, 1, 2)
    poor = f"{VERSES[V7][0]} {OTHER[0]} {OTHER[1]} {OTHER[2]}"  # similarité 0,55 : entre 0,3 et 0,6
    _, fill = run(hole, said, poor)
    assert fill is not None and spans_of(fill.candidate) == [(7, 1, 2)]
    _, fill = run(hole, said, poor, gap_weak_text_similarity=0.95)
    assert fill is None  # le seuil bas est réglable


# --- Entre deux reconnus -------------------------------------------------------------------------
def test_le_reste_du_verset_et_le_debut_du_suivant_entre_deux_reconnus():
    hole = Hole(TimeSpan(10.0, 40.0), det(V5, 1, 1, 8.0, 10.0), det(V7, 3, 4, 40.0, 42.0))
    # 55:5 [2-3], 55:6 entier, 55:7 [1-2] sont dits dans le trou : tout est consécutif
    said = say(12.0, V5, 2, 3) + say(20.0, V6, 1, 3) + say(28.0, V7, 1, 2)
    text = heard((V5, 2, 3), (V6, 1, 3), (V7, 1, 2))
    _, fill = run(hole, said, text)
    assert fill is not None and fill.role == ROLE_BETWEEN
    assert spans_of(fill.candidate) == [(5, 2, 3), (6, 1, 3), (7, 1, 2)]
    assert [len(w) for w in fill.candidate.word_times] == [2, 3, 2]
    assert all(
        a.end_s <= b.start_s
        for a, b in zip(fill.candidate.times, fill.candidate.times[1:], strict=False)
    )


def test_la_reprise_de_quelques_mots_est_retrouvee():
    hole = Hole(TimeSpan(10.0, 30.0), det(V7, 1, 2, 8.0, 10.0), det(V7, 4, 4, 30.0, 31.0))
    # le récitant redit « رفعها » (mot 2) avant de continuer par « ووضع » (mot 3)
    said = say(12.0, V7, 2, 3)
    _, fill = run(hole, said, heard((V7, 2, 3)))
    assert fill is not None and spans_of(fill.candidate) == [(7, 2, 3)]


# --- Après le dernier reconnu ---------------------------------------------------------------------
def test_la_suite_d_un_verset_s_arrete_ou_s_arrete_l_audio():
    hole = Hole(TimeSpan(10.0, 30.0), det(V1, 1, 2, 8.0, 10.0), None)
    said = say(12.0, V1, 3, 5)  # le reste du verset, puis du blanc
    _, fill = run(hole, said, heard((V1, 3, 5)))
    assert fill is not None and fill.role == ROLE_CONTINUATION
    assert spans_of(fill.candidate) == [(1, 3, 5)]


def test_une_suite_audio_seule_n_est_pas_nommee_au_dela_de_quelques_mots():
    hole = Hole(TimeSpan(10.0, 30.0), det(V1, 1, 1, 8.0, 10.0), None)
    _, fill = run(hole, say(12.0, V1, 2, 5), None)  # 4 mots, aucune transcription
    assert fill is None


def test_la_repetition_du_dernier_verset_est_marquee():
    hole = Hole(TimeSpan(20.0, 50.0), det(V6, 1, 3, 10.0, 20.0), None)
    said = say(30.0, V6, 1, 3)
    _, fill = run(hole, said, heard((V6, 1, 3)))
    assert fill is not None and fill.role == ROLE_REPETITION and fill.repeat
    assert spans_of(fill.candidate) == [(6, 1, 3)]


def test_une_repetition_de_deux_mots_n_est_pas_assez_pour_nommer():
    hole = Hole(TimeSpan(20.0, 50.0), det(V3, 1, 2, 10.0, 20.0), None)
    _, fill = run(hole, say(30.0, V3, 1, 2), heard((V3, 1, 2)))
    assert fill is None


def test_une_fin_de_verset_redite_seule_est_une_repetition():
    hole = Hole(TimeSpan(20.0, 50.0), det(V7, 1, 4, 10.0, 20.0), None)
    said = say(30.0, V7, 2, 4)
    _, fill = run(hole, said, heard((V7, 2, 4)))
    assert fill is not None and fill.repeat and spans_of(fill.candidate) == [(7, 2, 4)]


# --- Ce qu'on ne fait pas -------------------------------------------------------------------------
def test_un_trou_silencieux_n_est_meme_pas_aligne():
    hole = Hole(TimeSpan(8.0, 20.0), det(V4, 1, 2, 2.0, 8.0), det(V5, 2, 3, 20.0, 22.0))
    checks, fill = run(hole, [], "")
    assert checks == () and fill is None


def test_le_meilleur_texte_gagne_et_les_autres_sont_traces():
    hole = Hole(TimeSpan(20.0, 50.0), det(V6, 1, 2, 10.0, 20.0), None)
    said = say(30.0, V6, 3, 3)  # la suite du verset est dite, pas sa répétition
    checks, fill = run(hole, said, heard((V6, 3, 3)))
    assert fill is not None and fill.role == ROLE_CONTINUATION
    assert {c.role for c in checks} >= {ROLE_CONTINUATION}
    assert sum(1 for c in checks if c.accepted) == 1


def test_un_concurrent_mieux_soutenu_par_l_audio_met_l_hypothese_en_echec():
    # Le contexte ferait croire à 55:5 [1] (« الشمس », dit faiblement), mais le trou contient aussi
    # « علم القرآن » (55:2), clairement mieux soutenu : le trou est mieux expliqué par autre chose.
    hole = Hole(TimeSpan(8.0, 20.0), det(V4, 1, 2, 2.0, 8.0), det(V5, 2, 3, 20.0, 22.0))
    said = [(12.0, {VERSES[V5][0]: 0.30, OTHER[0]: 0.60}), *say(16.0, V2, 1, 2)]
    text = VERSES[V5][0]
    _, alone = run(hole, said, text)
    assert alone is not None and spans_of(alone.candidate) == [(5, 1, 1)]
    competitor = (WordSpan(V2, 1, 2),)
    checks, fill = run(hole, said, text, competitors=[competitor])
    assert fill is None
    assert any(c.role == "competitor" and not c.accepted for c in checks)
    assert not any(c.accepted for c in checks)  # la décision finale est tracée comme un refus


def test_un_concurrent_moins_bien_soutenu_ne_change_rien():
    hole = Hole(TimeSpan(8.0, 20.0), det(V4, 1, 2, 2.0, 8.0), det(V5, 2, 3, 20.0, 22.0))
    said = [(12.0, VERSES[V5][0]), (16.0, {VERSES[V2][0]: 0.30, OTHER[0]: 0.60})]
    competitor = (WordSpan(V2, 1, 2),)
    _, fill = run(hole, said, VERSES[V5][0], competitors=[competitor])
    assert fill is not None


def test_une_hypothese_de_meme_texte_sous_deux_roles_n_est_pas_une_ambiguite():
    hole = Hole(TimeSpan(20.0, 50.0), det(V5, 1, 3, 10.0, 20.0), None)
    hypotheses = [
        Hypothesis(ROLE_REPETITION, (WordSpan(V5, 1, 3),), free_end=True, repeat=True),
        Hypothesis(ROLE_CONTINUATION, (WordSpan(V5, 1, 3),), free_end=True),
    ]
    _, fill = run(hole, say(30.0, V5, 1, 3), heard((V5, 1, 3)), hypotheses=hypotheses)
    assert fill is not None


def test_deux_textes_differents_aussi_bien_soutenus_ne_departagent_rien():
    # « الشمس » (55:5 [1]) et « والنجم » (55:6 [1]) sont dits tous deux : lequel est le début ?
    hole = Hole(TimeSpan(8.0, 20.0), det(V4, 1, 2, 2.0, 8.0), det(V5, 2, 3, 20.0, 22.0))
    said = [(12.0, VERSES[V5][0]), (16.0, VERSES[V6][0])]
    hypotheses = [
        Hypothesis(ROLE_HEAD, (WordSpan(V5, 1, 1),), free_end=False),
        Hypothesis(ROLE_HEAD, (WordSpan(V6, 1, 1),), free_end=False),
    ]
    checks, fill = run(hole, said, f"{VERSES[V5][0]} {VERSES[V6][0]}", hypotheses=hypotheses)
    assert fill is None and sum(1 for c in checks if c.accepted) == 0


def test_desactivation_et_seuil_absent():
    hole = Hole(TimeSpan(8.0, 20.0), det(V4, 1, 2, 2.0, 8.0), det(V5, 2, 3, 20.0, 22.0))
    _, fill = run(hole, say(14.0, V5, 1, 1), heard((V5, 1, 1)), gap=False)
    assert fill is None


# --- Ce que la moyenne par trame ne voit pas ------------------------------------------------------
def test_entre_deux_variantes_compatibles_celle_qui_explique_le_plus_de_parole_gagne():
    # Cas 4 (lot3-04) : « 17:74 [2-9] » (8 mots, un peu imparfait) contre sa seule fin « [7-9] »
    # (parfaite sur ses trois mots mais qui laisse sans explication la parole des mots 2 à 6).
    hole = Hole(TimeSpan(10.0, 40.0), det(V1, 1, 1, 8.0, 10.0), None)
    said = [
        *say(12.0, V1, 2, 2),
        (12.5, {VERSES[V1][2]: 0.25, OTHER[0]: 0.65}),  # le mot 3 est dit de façon confuse
        *say(13.0, V1, 4, 5),
    ]
    whole = Hypothesis(ROLE_CONTINUATION, (WordSpan(V1, 2, 5),), free_end=True, new_from=(V1, 2))
    tail = Hypothesis(ROLE_REPETITION, (WordSpan(V1, 4, 5),), free_end=True, repeat=True)
    _, fill = run(
        hole,
        said,
        heard((V1, 2, 5)),
        hypotheses=[tail, whole],
        gap_repetition_min_words=2,
    )
    assert fill is not None and spans_of(fill.candidate) == [(1, 2, 5)]


def test_un_mot_de_reprise_qui_n_apporte_aucun_mot_nouveau_ne_nomme_rien():
    # Le trou ne contient que « رفعها » (mot 2, déjà reconnu) : l'hypothèse de suite « [2-4] » n'a
    # rien de nouveau à offrir, ce serait ré-attribuer la queue d'un verset déjà nommé.
    hole = Hole(TimeSpan(10.0, 30.0), det(V7, 1, 2, 8.0, 10.0), None)
    _, fill = run(hole, say(12.0, V7, 2, 2), heard((V7, 2, 2)))
    assert fill is None
    _, fill = run(hole, say(12.0, V7, 2, 3), heard((V7, 2, 3)))
    assert fill is not None and spans_of(fill.candidate) == [(7, 2, 3)]


def test_un_mot_absent_de_l_audio_est_toleres_dans_un_long_texte_pas_dans_un_court():
    hole = Hole(TimeSpan(10.0, 40.0), det(V1, 1, 1, 8.0, 10.0), None)
    # texte nommé : mots 2 à 5 du verset (4 mots) ; le mot 3 n'est jamais dit
    said = [*say(12.0, V1, 2, 2), *say(13.0, V1, 4, 5)]
    hypothesis = Hypothesis(
        ROLE_CONTINUATION, (WordSpan(V1, 2, 5),), free_end=True, new_from=(V1, 2)
    )
    _, fill = run(hole, said, heard((V1, 2, 2), (V1, 4, 5)), hypotheses=[hypothesis])
    assert fill is None  # 1 mot sur 4 sans soutien : trop
    _, fill = run(
        hole,
        said,
        heard((V1, 2, 2), (V1, 4, 5)),
        hypotheses=[hypothesis],
        gap_max_weak_fraction=0.5,
    )
    assert fill is not None  # le seuil est réglable
    checks, _ = run(hole, said, heard((V1, 2, 2), (V1, 4, 5)), hypotheses=[hypothesis])
    assert checks[0].weak_words == 1 and checks[0].words == 4


# --- Un verset NOUVEAU n'est jamais nommé sur un seul mot -----------------------------------------
def test_la_suite_ne_nomme_pas_un_verset_suivant_d_un_seul_mot():
    # Mesuré (lot3-04, 2:88 [1-1], 11:91 [1-1]) : un mot du verset suivant, sans transcription ni
    # contexte après lui, c'est trop peu pour nommer un verset qu'on n'a pas reconnu.
    hole = Hole(TimeSpan(10.0, 40.0), det(V6, 1, 3, 8.0, 10.0), None)
    said = say(12.0, V7, 1, 1)  # le premier mot du verset d'après
    checks, fill = run(hole, said, None)
    assert fill is None
    assert any(c.role == ROLE_CONTINUATION and c.words == 1 for c in checks)
    assert not any(c.accepted for c in checks)  # la trace ne dit pas « accepté » ce qui est écarté


def test_le_reste_du_verset_est_garde_quand_le_mot_du_verset_suivant_est_ecarte():
    hole = Hole(TimeSpan(10.0, 40.0), det(V1, 1, 4, 8.0, 10.0), None)
    said = say(12.0, V1, 5, 5) + say(13.0, V2, 1, 1)  # fin du verset puis un mot du suivant
    checks, fill = run(hole, said, None)
    assert fill is not None and spans_of(fill.candidate) == [(1, 5, 5)]
    (accepted,) = [c for c in checks if c.accepted]
    assert [(s.ref.ayah, s.first_word, s.last_word) for s in accepted.spans] == [(1, 5, 5)]
    assert accepted.words == 1  # la trace dit ce qui est réellement nommé


def test_le_verset_suivant_est_nomme_quand_il_a_assez_de_mots_et_un_temoin():
    hole = Hole(TimeSpan(10.0, 40.0), det(V6, 1, 3, 8.0, 10.0), None)
    said = say(12.0, V7, 1, 3)
    _, fill = run(hole, said, heard((V7, 1, 3)))
    assert fill is not None and spans_of(fill.candidate) == [(7, 1, 3)]
