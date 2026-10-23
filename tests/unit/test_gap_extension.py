"""Étendre les bords d'un verset reconnu d'un ou deux mots que l'audio contient (ADR-0013).

Cas réel (lot3-04, 2:87 [1-12], 33,8-62,6 s) : le verset est reconnu jusqu'au mot 12, mais le mot 13
(« الْبَيِّنَاتِ ») est dit DANS la même fenêtre, à 58,3 s, et l'alignement de [1-12] l'étire par-dessus
sa parole. Les deux textes se comparent sur les mêmes trames : [1-13] explique 13 nats de mieux.
"""

from __future__ import annotations

import math

import pytest

from aqr.alignment.forced import AlignmentConfig
from aqr.alignment.verification import AcousticCheckConfig, AcousticVerifier
from aqr.corpus.alignment_text import AlignmentTexts, AlignmentVariant
from aqr.decoding.chains import ChainConfig
from aqr.domain.models import Detection, Status, TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import AudioClip, CtcLattice

VERSES = {
    VerseRef(55, 1): ("بسم", "الله", "الرحمن", "الرحيم", "الرحمن"),
    VerseRef(55, 5): ("الشمس", "والقمر", "بحسبان"),
    VerseRef(55, 7): ("والسماء", "رفعها", "ووضع", "الميزان"),
}
OTHER = ("كتاب", "بيت", "رجل", "ماء", "باب", "قلم")
SYMBOLS = {
    w: i for i, w in enumerate(sorted({*OTHER, *(w for ws in VERSES.values() for w in ws)}), 1)
}
VOCAB = len(SYMBOLS) + 1
BLANK = 0
FRAME = 0.08
CLIP = AudioClip(samples=(0.0,) * 16000 * 120, sample_rate=16000, source="mem")
V1, V5, V7 = VerseRef(55, 1), VerseRef(55, 5), VerseRef(55, 7)


class _Corpus:
    def words(self, ref: VerseRef) -> tuple[str, ...]:
        return VERSES[ref]


class _Model:
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


def verifier(said, **config):
    model = _Model(said)
    texts = AlignmentTexts(uthmani=dict(VERSES), imlai={AlignmentVariant.BARE: dict(VERSES)})
    config.setdefault("min_llr_per_frame", -1.0)
    v = AcousticVerifier(
        model=model,
        texts=texts,
        corpus=_Corpus(),
        chain=ChainConfig(),
        config=AcousticCheckConfig(**config),
        alignment=AlignmentConfig(variants=(AlignmentVariant.BARE,)),
        max_passage_s=120.0,
        floor=0.75,
    )
    return v, model


def say(start: float, ref: VerseRef, first: int, last: int, step: float = 0.6):
    return [(start + step * n, w) for n, w in enumerate(VERSES[ref][first - 1 : last])]


def detection(ref, first, last, start, end, with_times=True) -> Detection:
    count = last - first + 1
    step = (end - start) / count
    times = tuple(TimeSpan(start + step * n, start + step * (n + 1)) for n in range(count))
    return Detection(
        WordSpan(ref, first, last),
        TimeSpan(start, end),
        Status.RECOGNIZED,
        0.75,
        word_times=times if with_times else (),
    )


def run(said, det, lower=0.0, upper=60.0, **config):
    v, model = verifier(said, **config)
    checks, extension = v.extend(CLIP, det, lower, upper)
    return checks, extension, model


# --- Fin du verset --------------------------------------------------------------------------------
def test_un_mot_dit_apres_la_fin_reconnue_est_ajoute():
    # 55:1 [1-3] reconnu de 10 à 12,4 ; les mots 4 et 5 sont dits juste après.
    det = detection(V1, 1, 3, 10.0, 12.4)
    said = say(10.0, V1, 1, 5)
    checks, ext, _ = run(said, det)
    assert ext is not None
    assert (ext.span.first_word, ext.span.last_word) == (1, 5)
    assert ext.time.start_s == pytest.approx(10.0, abs=0.1) and ext.time.end_s > 12.4
    assert len(ext.word_times) == 5
    assert all(
        a.end_s <= b.start_s for a, b in zip(ext.word_times, ext.word_times[1:], strict=False)
    )
    (check,) = [c for c in checks if c.accepted]
    assert check.kind == "gap" and check.role == "extension" and check.words == 2
    assert check.gain_nats is not None and check.gain_nats > 4.0 * 2


def test_le_dernier_mot_etire_par_dessus_la_parole_du_suivant_est_retrouve():
    # Cas 2 : la fenêtre reconnue [1-3] va jusqu'à 15 s et contient le mot 4 dit à 13,0 s.
    times = (TimeSpan(10.0, 11.0), TimeSpan(11.0, 12.0), TimeSpan(12.0, 15.0))  # le dernier, étiré
    det = Detection(
        WordSpan(V1, 1, 3), TimeSpan(10.0, 15.0), Status.RECOGNIZED, 0.75, word_times=times
    )
    said = [*say(10.0, V1, 1, 3, step=1.0), (13.0, VERSES[V1][3])]
    _, ext, _ = run(said, det)
    assert ext is not None and ext.span.last_word == 4
    last, added = ext.word_times[-2], ext.word_times[-1]
    assert last.end_s <= added.start_s and added.start_s == pytest.approx(13.0, abs=0.15)


def test_rien_n_est_ajoute_si_l_audio_ne_contient_pas_le_mot_suivant():
    det = detection(V1, 1, 3, 10.0, 12.4)
    said = [*say(10.0, V1, 1, 3), (13.0, OTHER[0]), (13.6, OTHER[1])]  # autre chose
    checks, ext, _ = run(said, det)
    assert ext is None and not any(c.accepted for c in checks)


def test_rien_n_est_ajoute_dans_le_silence():
    det = detection(V1, 1, 3, 10.0, 12.4)
    checks, ext, _ = run(say(10.0, V1, 1, 3), det)
    assert ext is None and checks == ()  # aucun gain : rien à tracer


def test_l_extension_ne_deborde_pas_sur_le_voisin():
    det = detection(V1, 1, 3, 10.0, 11.8)  # les mots 4 et 5 sont dits à 11,8 s et 12,4 s
    said = say(10.0, V1, 1, 5)
    _, ext, _ = run(said, det, upper=13.0)
    assert ext is not None and ext.span.last_word == 5 and ext.time.end_s <= 13.0 + 1e-9
    _, ext, _ = run(said, det, upper=12.3)  # le voisin commence avant le mot 5
    assert ext is not None and ext.span.last_word == 4 and ext.time.end_s <= 12.3 + 1e-9
    _, ext, _ = run(said, det, upper=11.8)  # plus aucune place
    assert ext is None


def test_un_verset_fini_n_a_pas_de_fin_a_etendre():
    det = detection(V5, 1, 3, 10.0, 12.0)
    checks, ext, model = run(say(10.0, V5, 1, 3), det)
    assert ext is None and checks == () and model.passages == []


def test_le_seuil_de_gain_est_regle_par_mot():
    det = detection(V1, 1, 3, 10.0, 12.4)
    said = say(10.0, V1, 1, 5)
    _, ext, _ = run(said, det, extend_min_gain_nats_per_word=1000.0)
    assert ext is None


# --- Début du verset ------------------------------------------------------------------------------
def test_un_mot_dit_avant_le_debut_reconnu_est_ajoute():
    # 55:7 [2-4] reconnu de 20 à 22 s ; « والسماء » (mot 1) est dit 1 s avant.
    det = detection(V7, 2, 4, 20.0, 22.0)
    said = say(19.0, V7, 1, 4, step=0.7)
    _, ext, _ = run(said, det, lower=15.0)
    assert ext is not None and (ext.span.first_word, ext.span.last_word) == (1, 4)
    assert ext.time.start_s < 20.0 and ext.time.start_s >= 15.0
    assert len(ext.word_times) == 4


def test_un_verset_qui_commence_au_mot_un_n_a_pas_de_debut_a_etendre():
    det = detection(V7, 1, 4, 20.0, 22.0)
    _, ext, model = run(say(20.0, V7, 1, 4), det)
    assert ext is None and model.passages == []


def test_un_debut_non_dit_n_est_pas_ajoute():
    det = detection(V7, 2, 4, 20.0, 22.0)
    said = [*say(19.0, V7, 2, 4, step=0.7), (18.0, OTHER[0])]
    _, ext, _ = run(said, det, lower=15.0)
    assert ext is None


def test_les_deux_bords_sont_etendus_ensemble():
    det = detection(V7, 2, 3, 20.0, 21.4)
    said = say(19.0, V7, 1, 4, step=0.7)
    _, ext, _ = run(said, det, lower=15.0)
    assert ext is not None and (ext.span.first_word, ext.span.last_word) == (1, 4)
    assert len(ext.word_times) == 4


# --- Garde-fous -----------------------------------------------------------------------------------
def test_sans_temps_au_mot_l_extension_se_fait_sur_les_dernieres_secondes():
    det = detection(V1, 1, 3, 10.0, 12.4, with_times=False)
    _, ext, _ = run(say(10.0, V1, 1, 5), det)
    assert ext is not None and ext.span.last_word == 5 and ext.word_times == ()


def test_extension_desactivable():
    det = detection(V1, 1, 3, 10.0, 12.4)
    checks, ext, model = run(say(10.0, V1, 1, 5), det, extend=False)
    assert ext is None and checks == () and model.passages == []


def test_une_detection_non_reconnue_n_est_pas_etendue():
    det = Detection(WordSpan(V1, 1, 3), TimeSpan(10.0, 12.4), Status.INFERRED, 0.0)
    v, model = verifier(say(10.0, V1, 1, 5))
    assert v.extend(CLIP, det, 0.0, 60.0) == ((), None) and model.passages == []


# --- Les voisins du même verset bornent l'extension en mots ---------------------------------------
def test_l_extension_ne_prend_pas_les_mots_du_voisin_du_meme_verset():
    det = detection(V1, 1, 2, 10.0, 11.2)
    said = say(10.0, V1, 1, 5)
    v, _ = verifier(said)
    _, ext = v.extend(CLIP, det, 0.0, 60.0, max_after=1)
    assert ext is not None and ext.span.last_word == 3 and ext.added_after == 1
    _, ext = v.extend(CLIP, det, 0.0, 60.0, max_after=0)
    assert ext is None


def test_la_borne_en_mots_vaut_aussi_pour_le_debut():
    det = detection(V7, 3, 4, 20.0, 21.2)
    said = say(18.8, V7, 1, 4, step=0.6)
    v, _ = verifier(said)
    _, ext = v.extend(CLIP, det, 15.0, 60.0, max_before=1)
    assert ext is not None and ext.span.first_word == 2 and ext.added_before == 1


# --- Les temps au mot restent ordonnés quand on étend ---------------------------------------------
def test_le_dernier_mot_est_recale_sans_chevauchement_avec_le_precedent():
    # Le mot 2 de l'alignement d'origine finit à 11,5 s, alors que l'audio place le mot 3 à 11,2 s :
    # le nouvel alignement du dernier mot ne doit pas chevaucher le précédent.
    times = (TimeSpan(10.0, 10.9), TimeSpan(10.9, 11.5), TimeSpan(11.5, 14.0))
    det = Detection(
        WordSpan(V1, 1, 3), TimeSpan(10.0, 14.0), Status.RECOGNIZED, 0.75, word_times=times
    )
    said = [
        (10.0, VERSES[V1][0]),
        (10.6, VERSES[V1][1]),
        (11.2, VERSES[V1][2]),
        (11.8, VERSES[V1][3]),
    ]
    _, ext, _ = run(said, det)
    assert ext is not None and ext.span.last_word == 4
    assert len(ext.word_times) == 4
    assert all(
        a.end_s <= b.start_s for a, b in zip(ext.word_times, ext.word_times[1:], strict=False)
    )
    assert ext.word_times[0] == times[0]  # les premiers mots gardent leurs temps d'origine


def test_un_recalage_trop_grand_ne_garde_aucun_temps_au_mot_plutot_qu_un_faux():
    times = (TimeSpan(10.0, 10.9), TimeSpan(10.9, 13.5), TimeSpan(13.5, 14.0))
    det = Detection(
        WordSpan(V1, 1, 3), TimeSpan(10.0, 14.0), Status.RECOGNIZED, 0.75, word_times=times
    )
    said = [
        (10.0, VERSES[V1][0]),
        (10.6, VERSES[V1][1]),
        (11.2, VERSES[V1][2]),
        (11.8, VERSES[V1][3]),
    ]
    _, ext, _ = run(said, det)
    assert ext is not None and ext.span.last_word == 4 and ext.word_times == ()
