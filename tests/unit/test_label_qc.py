"""Contrôle des étiquettes du jeu de fine-tuning par le modèle de base (étape C).

Treillis synthétiques et encodeur factice (un symbole par mot) : la notation, le signalement de la
basmala, le filtre et le rapport se vérifient sans modèle. La mesure réelle est dans
docs/evaluation/finetune-label-qc.md.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping, Sequence
from typing import Any

import pytest

from aqr.corpus.alignment_text import AlignmentTexts, AlignmentVariant
from aqr.data.config import LabelQcConfig
from aqr.data.label_qc import (
    LabelScore,
    LabelScorer,
    QcFlag,
    filter_manifest,
    heard_edges,
    qc_report,
    verdict,
)
from aqr.domain.models import VerseRef
from aqr.domain.ports import CtcLattice

BLANK = 0
V1 = VerseRef(112, 1)
V2 = VerseRef(112, 2)

UTHMANI = {
    V1: ("بِسْمِ", "ٱللَّهِ", "ٱلرَّحْمَـٰنِ", "ٱلرَّحِيمِ", "قُلْ", "هُوَ", "ٱللَّهُ", "أَحَدٌ"),
    V2: ("ٱللَّهُ", "ٱلصَّمَدُ"),
}
VOCALIZED = {
    V1: ("بِسْمِ", "اللَّهِ", "الرَّحْمَٰنِ", "الرَّحِيمِ", "قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"),
    V2: ("اللَّهُ", "الصَّمَدُ"),
}
BARE = {
    V1: ("بسم", "الله", "الرحمن", "الرحيم", "قل", "هو", "الله", "أحد"),
    V2: ("الله", "الصمد"),
}
DAGGER_ALIF = "ٰ"
"""Alif suscrit de la graphie Tanzil (« الرَّحْمَٰنِ ») : le tokenizer du vrai modèle n'en a pas
de symbole et le code `<unk>`, que le modèle n'émet jamais."""
CONVENTION = "هُوْ"
"""« هُوَ » écrit avec une autre voyelle : ce que le modèle peut émettre pour un mot juste quand
sa convention diffère de celle du corpus (soukoun noté ou non, mesuré : « الْإِنْسَانَ »)."""
WORDS = sorted(
    {w.replace(DAGGER_ALIF, "") for v in (VOCALIZED, BARE) for words in v.values() for w in words}
    | {CONVENTION}
)
SYMBOLS = {word: index for index, word in enumerate(WORDS, start=1)}
UNK = len(SYMBOLS) + 1
VOCAB = UNK + 1

BASMALA = " ".join(VOCALIZED[V1][:4])
QUL = " ".join(VOCALIZED[V1][4:])
SAMAD = " ".join(VOCALIZED[V2])

CONFIG = LabelQcConfig(min_llr_per_frame=-0.5, basmala_margin=0.05)


def encode(text: str) -> tuple[int, ...]:
    symbols: list[int] = []
    for word in text.split():
        symbols.append(SYMBOLS[word.replace(DAGGER_ALIF, "")])
        symbols += [UNK] * word.count(DAGGER_ALIF)
    return tuple(symbols)


def decode(symbols: Sequence[int]) -> str:
    return " ".join(WORDS[s - 1] for s in symbols)


def texts() -> AlignmentTexts:
    return AlignmentTexts(
        uthmani=UTHMANI,
        imlai={AlignmentVariant.VOCALIZED: VOCALIZED, AlignmentVariant.BARE: BARE},
    )


def lattice(spoken: str, pause: int = 2) -> CtcLattice:
    """L'audio « dit » `spoken` : chaque mot sur une trame (0,97), séparé par `pause` blancs."""
    path = [BLANK] * pause
    for word in spoken.split():
        path += [SYMBOLS[word.replace(DAGGER_ALIF, "")], *[BLANK] * pause]
    rest = 0.03 / (VOCAB - 1)
    rows = [[math.log(0.97 if v == s else rest) for v in range(VOCAB)] for s in path]
    return CtcLattice(log_probs=rows, blank=BLANK, start_s=0.0, frame_s=0.08)


def entry(text: str, ref: VerseRef | None = V1, name: str = "a.wav") -> dict[str, Any]:
    return {
        "audio_filepath": f"../../audio/tadabur/tadabur-7/{name}",
        "duration": 3.5,
        "text": text,
        "aqr_source": "tadabur",
        "aqr_speaker": "tadabur-7",
        "aqr_ref": None if ref is None else str(ref),
    }


def scorer(
    spoken: str,
    calls: list[str] | None = None,
    pause: int = 2,
    unknown: int | None = UNK,
    heard: bool = True,
) -> LabelScorer:
    def lattice_of(line: Mapping[str, Any]) -> CtcLattice:
        if calls is not None:
            calls.append(str(line["audio_filepath"]))
        return lattice(spoken, pause)

    return LabelScorer(
        texts(), encode, lattice_of, unknown_symbol=unknown, decode=decode if heard else None
    )


# --- Notation -----------------------------------------------------------------------------------


def test_une_etiquette_juste_est_soutenue_par_l_audio() -> None:
    score = scorer(QUL).score(entry(QUL), "train")
    assert score.error is None
    assert score.llr_per_frame == pytest.approx(0.0, abs=1e-9)
    assert score.variant == AlignmentVariant.VOCALIZED.value
    assert score.basmala_in_text is False
    assert score.split == "train" and score.ref == "112:1" and score.speaker == "tadabur-7"
    assert verdict(score, CONFIG) is None


def test_une_etiquette_fausse_tombe_sous_le_seuil() -> None:
    # L'audio récite 112:2 alors que l'étiquette annonce 112:1 (segmentation automatique fausse).
    score = scorer(f"{SAMAD} {SAMAD}").score(entry(QUL), "train")
    assert score.error is None and score.llr_per_frame is not None
    assert score.llr_per_frame < CONFIG.min_llr_per_frame  # type: ignore[operator]
    assert verdict(score, CONFIG) is QcFlag.LOW_SCORE


def test_basmala_recitee_mais_non_annoncee_est_signalee() -> None:
    score = scorer(f"{BASMALA} {QUL}").score(entry(QUL), "train")
    assert score.basmala_in_text is False
    assert score.basmala_alt_llr is not None and score.llr_per_frame is not None
    assert score.basmala_alt_llr - score.llr_per_frame >= CONFIG.basmala_margin
    assert verdict(score, CONFIG) is QcFlag.BASMALA_UNANNOUNCED


def test_basmala_annoncee_mais_absente_est_signalee() -> None:
    score = scorer(QUL).score(entry(f"{BASMALA} {QUL}"), "train")
    assert score.basmala_in_text is True
    assert verdict(score, CONFIG) is QcFlag.BASMALA_MISSING


def test_basmala_annoncee_et_recitee_est_acceptee() -> None:
    score = scorer(f"{BASMALA} {QUL}").score(entry(f"{BASMALA} {QUL}"), "train")
    assert score.basmala_in_text is True
    assert verdict(score, CONFIG) is None


def test_symbole_inconnu_du_modele_retire_et_compte() -> None:
    # « الرَّحْمَٰنِ » : l'alif suscrit n'existe pas pour le modèle, qui ne peut donc jamais
    # l'émettre ; l'exiger pénaliserait toute étiquette juste qui en contient.
    label = f"{BASMALA} {QUL}"
    exige = scorer(label, unknown=None).score(entry(label), "train")
    retire = scorer(label).score(entry(label), "train")
    assert exige.llr_per_frame is not None and exige.llr_per_frame < -0.1
    assert retire.llr_per_frame == pytest.approx(0.0, abs=1e-9)
    assert retire.unknown_symbols == 1 and exige.unknown_symbols == 0


def test_etiquette_dans_la_graphie_du_modele_reconnue_et_sans_inconnu() -> None:
    # Cible écrite sans alif suscrit (`model_graphie`) : c'est toujours le texte du verset, et
    # elle ne demande plus aucun symbole inconnu au modèle.
    label = f"{BASMALA} {QUL}".replace(DAGGER_ALIF, "")

    def lattice_of(line: Mapping[str, Any]) -> CtcLattice:
        return lattice(label)

    graphie = LabelScorer(
        texts(),
        encode,
        lattice_of,
        unknown_symbol=UNK,
        target=lambda text: text.replace(DAGGER_ALIF, ""),
    ).score(entry(label), "train")
    assert graphie.error is None and graphie.basmala_in_text is True
    assert graphie.unknown_symbols == 0
    assert graphie.llr_per_frame == pytest.approx(0.0, abs=1e-9)
    # Sans la règle de graphie, la même étiquette ne serait pas reconnue comme le verset.
    assert scorer(label).score(entry(label), "train").error is QcFlag.TEXT_MISMATCH


# --- Ce que le modèle entend : débordement, troncature, convention de voyelles -----------------

TOLERANT = LabelQcConfig(min_llr_per_frame=-10.0, basmala_margin=0.05, edge_words=2)
"""Seuil hors jeu : seuls les mots entendus en trop ou en moins aux bords décident."""


def test_ce_que_le_modele_entend_est_garde() -> None:
    score = scorer(f"{QUL} {SAMAD}").score(entry(QUL), "train")
    assert score.heard == f"{QUL} {SAMAD}"


def test_debordement_sur_le_verset_voisin_nomme_meme_au_dessus_du_seuil() -> None:
    # Segment automatique trop long : il contient aussi le verset suivant. Sur un long verset, deux
    # mots de trop pèsent peu par trame ; le modèle, lui, les entend.
    score = scorer(f"{QUL} {SAMAD}").score(entry(QUL), "train")
    assert verdict(score, TOLERANT) is QcFlag.OVERFLOW


def test_troncature_nommee() -> None:
    score = scorer("قُلْ هُوَ").score(entry(QUL), "train")
    assert score.error is None
    assert verdict(score, TOLERANT) is QcFlag.TRUNCATED


def test_repetition_par_le_recitant_nommee() -> None:
    # Le récitant reprend un passage (34:3, « وَلَا أَكْبَرُ » dit deux fois, shard 384) : les deux
    # bords coïncident avec l'étiquette, les mots en plus sont à l'intérieur.
    score = scorer("قُلْ هُوَ قُلْ هُوَ اللَّهُ أَحَدٌ").score(entry(QUL), "train")
    assert verdict(score, TOLERANT) is QcFlag.REPEATED
    assert heard_edges("علم القران", "علم القران علم القران").inserted == 2


def test_un_seul_mot_de_trop_au_bord_est_tolere() -> None:
    # Un fragment du verset voisin (une syllabe, un mot) n'est pas un débordement : mesuré sur le
    # shard 384, les étiquettes justes en ont parfois un, jamais deux.
    score = scorer(f"{QUL} اللَّهُ").score(entry(QUL), "train")
    assert verdict(score, TOLERANT) is None


def test_convention_de_voyelles_ne_condamne_pas_une_etiquette_juste() -> None:
    spoken = QUL.replace("هُوَ", CONVENTION)
    sauvee = scorer(spoken, pause=1).score(entry(QUL), "train")
    assert sauvee.llr_per_frame is not None
    assert sauvee.llr_per_frame < CONFIG.min_llr_per_frame  # type: ignore[operator]
    assert verdict(sauvee, CONFIG) is None  # le modèle entend exactement ces mots
    sans_ecoute = scorer(spoken, pause=1, heard=False).score(entry(QUL), "train")
    assert verdict(sans_ecoute, CONFIG) is QcFlag.LOW_SCORE


def test_mot_repete_dans_le_verset_ne_fabrique_pas_de_troncature() -> None:
    # Voix réelle (micro) : « الرحيم » transcrit de travers, et « الرحمن » revient en fin de
    # passage ; aligné dans un seul sens, le second « الرحمن » s'accroche au premier et laisse deux
    # mots « manquants » à la fin. La fin se mesure en alignant à rebours.
    edges = heard_edges("بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ الرَّحْمَنُ", "بسم الله الرحمنح الرحمن")
    assert edges.missing == 0 and edges.extra == 0 and not edges.same


def test_bords_mesures_des_deux_cotes() -> None:
    edges = heard_edges("قل هو الله احد", "الله الصمد قل هو الله احد الله الصمد لم يلد")
    assert edges.extra == 4  # le plus grand des deux bords : 2 avant, 4 après
    assert heard_edges("قل هو الله احد", "الله احد").missing == 2


def test_hors_verset_1_aucune_hypothese_de_basmala() -> None:
    score = scorer(SAMAD).score(entry(SAMAD, ref=V2), "val")
    assert score.basmala_in_text is None and score.basmala_alt_llr is None
    assert verdict(score, CONFIG) is None


def test_texte_trop_long_pour_l_audio() -> None:
    # 2 trames pour 4 mots : le chemin contraint n'existe pas.
    score = scorer("قُلْ هُوَ", pause=0).score(entry(QUL), "train")
    assert score.error is QcFlag.NOT_ALIGNED and score.llr_per_frame is None
    assert verdict(score, CONFIG) is QcFlag.NOT_ALIGNED


def test_texte_different_du_corpus_n_est_pas_note() -> None:
    calls: list[str] = []
    score = scorer(QUL, calls).score(entry("قُلْ هُوَ"), "train")
    assert score.error is QcFlag.TEXT_MISMATCH
    assert calls == []  # aucun treillis calculé pour une étiquette déjà fausse


def test_ligne_non_coranique_refusee() -> None:
    with pytest.raises(ValueError, match="aqr_ref"):
        scorer(QUL).score(entry(QUL, ref=None), "train")


def test_score_aller_retour_json() -> None:
    score = scorer(f"{BASMALA} {QUL}").score(entry(QUL), "train")
    assert LabelScore.from_json(json.loads(json.dumps(score.to_json()))) == score
    failed = scorer(QUL).score(entry("قُلْ هُوَ"), "train")
    assert LabelScore.from_json(json.loads(json.dumps(failed.to_json()))) == failed


def test_seuil_non_calibre_refuse_de_juger() -> None:
    score = scorer(QUL).score(entry(QUL), "train")
    with pytest.raises(ValueError, match="min_llr_per_frame"):
        verdict(score, LabelQcConfig(min_llr_per_frame=None))


# --- Filtre et rapport --------------------------------------------------------------------------


def _scored(
    llr: float | None, name: str, error: QcFlag | None = None, unknown: int = 0
) -> LabelScore:
    return LabelScore(
        key=f"../../audio/tadabur/tadabur-7/{name}",
        split="train",
        ref="112:2",
        speaker="tadabur-7",
        duration=2.0,
        text=SAMAD,
        llr_per_frame=llr,
        variant=None if llr is None else "simple",
        frames=25,
        basmala_in_text=None,
        basmala_alt_llr=None,
        error=error,
        unknown_symbols=unknown,
    )


def test_le_filtre_garde_les_lignes_d_origine_a_l_identique() -> None:
    good, bad = entry(SAMAD, V2, "good.wav"), entry(SAMAD, V2, "bad.wav")
    lines = [json.dumps(good, ensure_ascii=False), json.dumps(bad, ensure_ascii=False)]
    scores = {
        good["audio_filepath"]: _scored(-0.1, "good.wav"),
        bad["audio_filepath"]: _scored(-2.0, "bad.wav"),
    }
    kept, rejected = filter_manifest(lines, scores, CONFIG)
    assert kept == [lines[0]]
    assert [(s.key, flag) for s, flag in rejected] == [(bad["audio_filepath"], QcFlag.LOW_SCORE)]


def test_le_filtre_exige_un_score_par_ligne() -> None:
    line = json.dumps(entry(SAMAD, V2, "inconnu.wav"), ensure_ascii=False)
    with pytest.raises(KeyError, match="score"):
        filter_manifest([line], {}, CONFIG)


def test_rapport_distribution_et_exemples_a_ecouter() -> None:
    llrs = [-0.01 * i for i in range(20)] + [-1.5, -3.0]
    scores = [_scored(v, f"{i}.wav", unknown=i % 2) for i, v in enumerate(llrs)]
    scores.append(_scored(None, "long.wav", QcFlag.NOT_ALIGNED))
    report = qc_report(scores, CONFIG)

    assert report["threshold"]["min_llr_per_frame"] == CONFIG.min_llr_per_frame
    assert report["scored"] == 23 and report["aligned"] == 22
    assert report["kept"]["count"] == 20
    # Étiquettes qui demandent au modèle un symbole qu'il ne connaît pas (`<unk>`) : à corriger
    # dans la cible d'entraînement, pas à écarter.
    assert report["unknown_symbols"] == {"labels": 11, "hours": round(22.0 / 3600, 4)}
    assert report["rejected"][QcFlag.LOW_SCORE.value]["count"] == 2
    assert report["rejected"][QcFlag.NOT_ALIGNED.value]["count"] == 1
    assert report["rejected"][QcFlag.LOW_SCORE.value]["hours"] == round(4.0 / 3600, 4)
    distribution = report["distribution"]
    assert distribution["min"] == -3.0 and distribution["max"] == 0.0
    assert distribution["quantiles"]["p50"] == pytest.approx(-0.105)
    assert sum(b["count"] for b in distribution["histogram"]) == 22
    assert len(distribution["histogram"]) == CONFIG.histogram_bins
    # Suggestion robuste (médiane − k × MAD) : aide au calibrage, jamais appliquée seule.
    assert distribution["robust_threshold"] < distribution["quantiles"]["p50"]
    # Les pires d'abord, ceux sans alignement en tête (rien n'explique l'audio).
    worst = [e["key"].rsplit("/", 1)[1] for e in report["rejected_examples"]]
    assert worst == ["long.wav", "21.wav", "20.wav"]
    assert report["rejected_examples"][1]["flag"] == QcFlag.LOW_SCORE.value
    assert "heard" in report["rejected_examples"][1]
