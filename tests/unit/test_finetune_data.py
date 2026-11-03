"""Jeu de fine-tuning (étape C) : texte, découpage par locuteur, exclusions, manifestes NeMo."""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass, replace
from pathlib import Path

import pytest

from aqr.data.config import FinetuneConfig
from aqr.data.finetune import (
    BuildContext,
    QuranNgramIndex,
    Rejection,
    Utterance,
    clean_non_quran_text,
    corpus_alphabet,
    merge_parts,
    process_utterances,
    quran_target_text,
    safe_name,
    speaker_split,
    tadabur_ref,
    tadabur_speaker,
    write_part,
)
from aqr.data.finetune_sources import EXCLUDED_TADABUR_RECITERS, FINETUNE_SOURCES, TADABUR
from aqr.domain.models import VerseRef

CFG = FinetuneConfig()
BASMALA = ("بِسْمِ", "اللَّهِ", "الرَّحْمَـٰنِ", "الرَّحِيمِ")
SIMPLE: dict[VerseRef, tuple[str, ...]] = {
    VerseRef(1, 1): BASMALA,
    VerseRef(2, 1): (*BASMALA, "الم"),
    VerseRef(9, 1): ("بَرَاءَةٌ", "مِّنَ", "اللَّهِ", "وَرَسُولِهِ"),
    VerseRef(19, 95): ("وَكُلُّهُمْ", "آتِيهِ", "يَوْمَ", "الْقِيَامَةِ", "فَرْدًا"),
    VerseRef(55, 1): ("الرَّحْمَـٰنُ",),
}


# --- Tadabur : référence et texte -------------------------------------------------------------


def test_tadabur_numerote_les_sourates_a_partir_de_zero() -> None:
    # Constat sur la révision épinglée : S18 A95 porte le texte de 19:95 (Maryam).
    assert tadabur_ref(18, 95) == VerseRef(19, 95)
    assert tadabur_ref(0, 1) == VerseRef(1, 1)
    assert tadabur_ref(113, 6) == VerseRef(114, 6)


@pytest.mark.parametrize(("surah_id", "ayah_id"), [(114, 1), (-1, 1), (0, 0), (0, 8)])
def test_tadabur_reference_invalide(surah_id: int, ayah_id: int) -> None:
    with pytest.raises(ValueError):
        tadabur_ref(surah_id, ayah_id)


def test_texte_cible_vient_du_corpus_et_non_de_la_source() -> None:
    # La source écrit « اتيه » sans hamza ni voyelles : le texte retenu est celui du corpus.
    text = quran_target_text(
        VerseRef(19, 95), SIMPLE[VerseRef(19, 95)], "وكلهم اتيه يوم القيامة فردا"
    )
    assert text == "وَكُلُّهُمْ آتِيهِ يَوْمَ الْقِيَامَةِ فَرْدًا"


def test_texte_different_du_corpus_refuse() -> None:
    assert quran_target_text(VerseRef(19, 95), SIMPLE[VerseRef(19, 95)], "وكلهم اتيه يوم") is None


def test_basmala_du_verset_un_suit_ce_que_dit_la_source() -> None:
    words = SIMPLE[VerseRef(2, 1)]
    assert quran_target_text(VerseRef(2, 1), words, "الم") == "الم"
    assert quran_target_text(VerseRef(2, 1), words, "بسم الله الرحمن الرحيم الم") == " ".join(words)
    # Al-Fatiha : la basmala EST le verset 1 ; At-Tawbah n'en a pas.
    assert quran_target_text(VerseRef(1, 1), BASMALA, "بسم الله الرحمن الرحيم") == " ".join(BASMALA)
    assert quran_target_text(VerseRef(9, 1), SIMPLE[VerseRef(9, 1)], "براءة من الله ورسوله")


# --- Découpage par locuteur -----------------------------------------------------------------


def test_decoupage_par_locuteur_deterministe_et_proche_du_ratio() -> None:
    speakers = [tadabur_speaker(i) for i in range(2000)]
    first = [speaker_split(s, CFG) for s in speakers]
    assert first == [speaker_split(s, CFG) for s in speakers]
    share = first.count(CFG.val_split) / len(first)
    assert abs(share - CFG.val_ratio) < 0.01
    assert set(first) == {CFG.train_split, CFG.val_split}


def test_le_sel_change_l_affectation() -> None:
    other = FinetuneConfig(split_seed="autre-sel")
    speakers = [tadabur_speaker(i) for i in range(500)]
    assert [speaker_split(s, CFG) for s in speakers] != [speaker_split(s, other) for s in speakers]


# --- Parole non coranique -------------------------------------------------------------------


ALPHABET = corpus_alphabet(" ".join(w) for w in SIMPLE.values()) | corpus_alphabet(
    ["أقدر تعاونك معنا كتاب سافرت إلى الخارج في البداية ربما كان الناس ؤ ئ ء ة ى ض ظ ط ث ش ج خ ز"]
)


def test_alphabet_tire_du_corpus() -> None:
    assert "ب" in ALPHABET and "َ" in ALPHABET
    assert " " not in ALPHABET and "1" not in ALPHABET


def test_nettoyage_retire_la_ponctuation_et_garde_les_voyelles() -> None:
    assert clean_non_quran_text("أقدر تعاونك معنا.", ALPHABET) == "أقدر تعاونك معنا"
    assert clean_non_quran_text("« كتاب »، كتاب؟", ALPHABET) == "كتاب كتاب"
    assert clean_non_quran_text("كِتَابٌ", ALPHABET) == "كِتَابٌ"


@pytest.mark.parametrize("text", ["بعد زلزال 1755", "كتاب abc", "کتاب", "١٢ كتاب"])
def test_caracteres_hors_alphabet_refuses(text: str) -> None:
    # Chiffres et lettres étrangères : il faudrait les verbaliser, on n'invente pas leur lecture.
    assert clean_non_quran_text(text, ALPHABET) is None


def test_texte_vide_apres_nettoyage() -> None:
    assert clean_non_quran_text(" ... ؟ ", ALPHABET) == ""


def test_index_detecte_un_verset_dans_une_phrase_non_coranique() -> None:
    index = QuranNgramIndex(SIMPLE.values(), n=4)
    assert index.contains_quran("وكلهم آتيه يوم القيامة فردا")
    assert index.contains_quran("قال وكلهم اتيه يوم القيامه")  # graphie normalisée
    assert not index.contains_quran("سافرت إلى الخارج في البداية")
    assert not index.contains_quran("يوم القيامة")  # trop court et pas un verset entier
    assert index.contains_quran("الرحمن")  # phrase courte = verset entier (55:1)


# --- Traitement d'une unité ----------------------------------------------------------------


@dataclass
class FakeAudio:
    duration: float
    saved: list[Path]

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"RIFF")
        self.saved.append(path)


class FakeDecoder:
    def __init__(self) -> None:
        self.saved: list[Path] = []

    def __call__(self, data: bytes) -> FakeAudio:
        if data == b"casse":
            raise ValueError("illisible")
        return FakeAudio(float(data.decode()), self.saved)


def context(tmp_path: Path, source: str) -> BuildContext:
    return BuildContext(
        spec=FINETUNE_SOURCES[source],
        config=CFG,
        simple_words=SIMPLE,
        alphabet=ALPHABET,
        quran_index=QuranNgramIndex(SIMPLE.values(), n=CFG.quran_ngram),
        excluded={tadabur_speaker(i): v for i, v in EXCLUDED_TADABUR_RECITERS.items()},
        audio_root=tmp_path / "audio",
        manifest_dir=tmp_path / "manifests" / source,
    )


def tadabur_utt(speaker: int, utt: str, ref: VerseRef | None, text: str, audio: str) -> Utterance:
    return Utterance(
        speaker=tadabur_speaker(speaker),
        utt_id=utt,
        text=text,
        ref=ref,
        split=None,
        audio=audio.encode(),
        declared_duration=float(audio) if audio.replace(".", "").isdigit() else None,
    )


def non_quran_utt(utt: str, text: str, audio: str, split: str = "train") -> Utterance:
    # Découpage officiel à locuteurs disjoints : un locuteur par jeu.
    return Utterance(
        speaker=f"cv-{split}", utt_id=utt, text=text, ref=None, split=split, audio=audio.encode()
    )


def test_unite_tadabur_garde_rejette_et_compte(tmp_path: Path) -> None:
    ctx = context(tmp_path, TADABUR)
    decoder = FakeDecoder()
    utts: Iterable[Utterance] = [
        tadabur_utt(500, "ok", VerseRef(19, 95), "وكلهم اتيه يوم القيامة فردا", "4.0"),
        tadabur_utt(33, "exclu", VerseRef(19, 95), "وكلهم اتيه يوم القيامة فردا", "5.0"),
        tadabur_utt(500, "mauvais-texte", VerseRef(19, 95), "الم", "2.0"),
        tadabur_utt(500, "sans-ref", None, "الم", "2.0"),
        tadabur_utt(500, "trop-long", VerseRef(55, 1), "الرحمن", "61.0"),
        tadabur_utt(500, "illisible", VerseRef(55, 1), "الرحمن", "casse"),
    ]
    part = process_utterances(utts, ctx, decoder)
    split = speaker_split(tadabur_speaker(500), CFG)
    assert [e.text for e in part.entries[split]] == ["وَكُلُّهُمْ آتِيهِ يَوْمَ الْقِيَامَةِ فَرْدًا"]
    entry = part.entries[split][0]
    assert entry.duration == 4.0 and entry.ref == "19:95" and entry.speaker == "tadabur-500"
    # Chemin relatif au manifeste, en « / » : portable entre Windows, WSL et Linux.
    assert entry.audio_filepath == "../../audio/tadabur/tadabur-500/ok.wav"
    written = tmp_path / "audio" / TADABUR / "tadabur-500" / "ok.wav"
    assert (ctx.manifest_dir / entry.audio_filepath).resolve() == written.resolve()
    assert decoder.saved == [written]  # rien d'autre n'est écrit
    report = part.report
    assert report.kept[split].count == 1 and report.kept[split].seconds == 4.0
    assert report.rejected[Rejection.EXCLUDED_VOICE].count == 1
    assert report.rejected[Rejection.EXCLUDED_VOICE].seconds == 5.0
    assert report.excluded_voices == {"tadabur-33": 5.0}
    assert report.rejected[Rejection.TEXT_MISMATCH].count == 1
    assert report.rejected[Rejection.BAD_REF].count == 1
    assert report.rejected[Rejection.DURATION].count == 1
    assert report.rejected[Rejection.UNREADABLE].count == 1


def test_unite_non_coranique_ecarte_le_coran_et_garde_le_split_officiel(tmp_path: Path) -> None:
    ctx = context(tmp_path, "common-voice-ar")
    part = process_utterances(
        [
            non_quran_utt("a", "أقدر تعاونك معنا.", "2.5"),
            non_quran_utt("b", "وكلهم آتيه يوم القيامة فردا", "3.0"),
            non_quran_utt("c", "بعد زلزال 1755", "3.0"),
            non_quran_utt("d", "؟", "1.0"),
            non_quran_utt("e", "سافرت إلى الخارج", "2.0", split="val"),
        ],
        ctx,
        FakeDecoder(),
    )
    assert [e.text for e in part.entries["train"]] == ["أقدر تعاونك معنا"]
    assert [e.text for e in part.entries["val"]] == ["سافرت إلى الخارج"]
    assert part.entries["train"][0].ref is None
    assert part.report.rejected[Rejection.CONTAINS_QURAN].count == 1
    assert part.report.rejected[Rejection.ALPHABET].count == 1
    assert part.report.rejected[Rejection.EMPTY].count == 1


def test_cible_sans_caractere_inconnu_du_modele(tmp_path: Path) -> None:
    # L'alif suscrit (U+0670) et le tatweel (U+0640) de la graphie Tanzil sont `<unk>` pour le
    # tokenizer du modèle, qui ne les émet jamais : la cible prend la graphie qu'il écrit déjà
    # (« الرَّحْمَنُ »), pour la récitation comme pour la parole non coranique.
    ctx = context(tmp_path, TADABUR)
    part = process_utterances(
        [tadabur_utt(500, "rahman", VerseRef(55, 1), "الرحمن", "1.0")], ctx, FakeDecoder()
    )
    split = speaker_split(tadabur_speaker(500), CFG)
    assert [e.text for e in part.entries[split]] == ["الرَّحْمَنُ"]

    ctx = context(tmp_path, "common-voice-ar")
    part = process_utterances([non_quran_utt("t", "الكتـاب لهٰم", "2.0")], ctx, FakeDecoder())
    assert [e.text for e in part.entries["train"]] == ["الكتاب لهم"]


def test_caracteres_retires_de_la_cible_configures() -> None:
    assert CFG.target_drop_chars == ("ٰ", "ـ")


@pytest.mark.parametrize(
    ("raw", "safe"),
    [
        ("tadabur_spk0041_S18_A95_7b537dd3_000073", "tadabur_spk0041_S18_A95_7b537dd3_000073"),
        ("..\..\evil", "_.._evil"),
        ("../x", "_x"),
        ("..", "_"),
        ("a b/c", "a_b_c"),
    ],
)
def test_nom_de_fichier_sur(raw: str, safe: str) -> None:
    assert safe_name(raw) == safe
    assert "/" not in safe_name(raw) and "\\" not in safe_name(raw)


# --- Manifestes NeMo ------------------------------------------------------------------------


def test_parts_fusionnees_en_manifestes_nemo(tmp_path: Path) -> None:
    ctx = context(tmp_path, "common-voice-ar")
    manifests = tmp_path / "manifests" / "common-voice-ar"
    for name, utts in {
        "u2": [non_quran_utt("b", "سافرت إلى الخارج", "2.0", split="val")],
        "u1": [non_quran_utt("a", "أقدر تعاونك معنا", "2.5"), non_quran_utt("c", "1", "1.0")],
    }.items():
        write_part(manifests / "parts", name, process_utterances(utts, ctx, FakeDecoder()))
    summary = merge_parts(manifests, CFG)

    train = (manifests / "train.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(train) == 1
    line = json.loads(train[0])
    assert set(line) == {
        "audio_filepath",
        "duration",
        "text",
        "aqr_source",
        "aqr_speaker",
        "aqr_ref",
    }
    assert line["text"] == "أقدر تعاونك معنا" and line["duration"] == 2.5
    assert "أقدر" in train[0]  # UTF-8 lisible, pas d'échappement \u
    assert len((manifests / "val.jsonl").read_text(encoding="utf-8").splitlines()) == 1
    assert summary["parts"] == ["u1", "u2"]
    assert summary["kept"]["train"] == {"count": 1, "hours": round(2.5 / 3600, 4), "speakers": 1}
    # Common Voice n'annonce pas de durée : l'écart est compté, sa durée dite inconnue (pas 0 h).
    assert summary["rejected"][Rejection.ALPHABET.value] == {
        "count": 1,
        "hours": 0.0,
        "without_duration": 1,
    }
    assert json.loads((manifests / "report.json").read_text(encoding="utf-8")) == summary


def test_fusion_refuse_un_locuteur_des_deux_cotes(tmp_path: Path) -> None:
    ctx = context(tmp_path, "common-voice-ar")
    manifests = tmp_path / "manifests"
    utts = [non_quran_utt("a", "أقدر تعاونك معنا", "2.5")]
    utts.append(
        replace(non_quran_utt("b", "سافرت إلى الخارج", "2.0", split="val"), speaker="cv-train")
    )
    write_part(manifests / "parts", "u1", process_utterances(utts, ctx, FakeDecoder()))
    with pytest.raises(ValueError, match="cv-train"):
        merge_parts(manifests, CFG)


def test_fusion_sans_part_refusee(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        merge_parts(tmp_path / "vide", CFG)


# --- Registre ----------------------------------------------------------------------------------


def test_exclusions_couvrent_les_voix_test_du_depot() -> None:
    splits = {v.split for v in EXCLUDED_TADABUR_RECITERS.values()}
    assert splits == {"test", "dev"}
    tests = {i for i, v in EXCLUDED_TADABUR_RECITERS.items() if v.split == "test"}
    assert tests == {2, 33, 128}
    assert all(v.reason for v in EXCLUDED_TADABUR_RECITERS.values())


def test_registre_sans_everyayah_ni_lot1() -> None:
    repos = " ".join(s.repo_id.lower() for s in FINETUNE_SOURCES.values())
    assert "everyayah" not in repos and "aqr-audio" not in repos
    assert [s.key for s in FINETUNE_SOURCES.values() if s.quran] == [TADABUR]
