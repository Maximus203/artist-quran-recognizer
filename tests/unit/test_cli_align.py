"""`aqr align` : alignement forcé d'une liste de versets DÉCLARÉE sur un passage (ADR-0006).

Composants factices injectés (aucun modèle) : la lecture de `--verses`, le contrat de sortie
`aqr.alignment/1` et les erreurs. La mesure sur un vrai modèle : scripts/measure_alignment.py.
"""

from __future__ import annotations

import io
import json
import math
from array import array
from pathlib import Path

import pytest

from aqr.alignment.forced import AlignmentConfig
from aqr.alignment.service import AlignmentService, parse_verse_spec
from aqr.cli import main
from aqr.corpus.alignment_text import AlignmentTexts, AlignmentVariant
from aqr.domain.models import TimeSpan, VerseRef, WordSpan
from aqr.domain.ports import AudioClip, CtcLattice

WORDS = {VerseRef(112, 1): 8, VerseRef(112, 2): 2, VerseRef(112, 3): 4, VerseRef(1, 7): 9}


def count(ref: VerseRef) -> int:
    return WORDS.get(ref, 8 if ref.ayah == 1 else 3)


# --- --verses ---------------------------------------------------------------------------------
def test_verset_entier_sans_la_basmala_de_tanzil():
    assert parse_verse_spec("112:1", count) == [WordSpan(VerseRef(112, 1), 5, 8)]


def test_suite_de_versets_dans_une_sourate():
    spans = parse_verse_spec("112:1-3", count)
    assert [s.ref for s in spans] == [VerseRef(112, 1), VerseRef(112, 2), VerseRef(112, 3)]


def test_suite_qui_traverse_les_sourates():
    spans = parse_verse_spec("21:111-22:2", count)
    assert [str(s.ref) for s in spans] == ["21:111", "21:112", "22:1", "22:2"]
    assert spans[2].first_word == 5  # basmala de 22:1 retirée


def test_plage_de_mots_et_repetition_dans_l_ordre():
    spans = parse_verse_spec("1:7, 1:7[5-9]", count)
    assert spans == [WordSpan(VerseRef(1, 7), 1, 9), WordSpan(VerseRef(1, 7), 5, 9)]


@pytest.mark.parametrize("spec", ["", "112", "112:9", "112:3-112:1", "1:7[0-2]", "1:7[3-12]", "x"])
def test_declaration_invalide(spec):
    with pytest.raises(ValueError):
        parse_verse_spec(spec, count)


# --- CLI ----------------------------------------------------------------------------------------
V = VerseRef(112, 2)
SYMBOLS = {"الله": 1, "الصمد": 2, "اللَّهُ": 3, "الصَّمَدُ": 4}
UNK = 5
"""Symbole `<unk>` : présent dans le treillis, jamais émis par le modèle."""


class _Model:
    engine = "fake-ctc@0"
    unknown_symbol: int | None = None

    def encode(self, text: str) -> tuple[int, ...]:
        return (SYMBOLS[text],)

    def lattice(self, clip: AudioClip, span: TimeSpan) -> CtcLattice:
        path = [0, 1, 0, 2, 0]
        rows = [[math.log(0.96 if v == s else 0.008) for v in range(UNK + 1)] for s in path]
        return CtcLattice(rows, 0, span.start_s, (span.end_s - span.start_s) / len(path))


class _ModelWithUnknown(_Model):
    """Le tokenizer rend `<unk>` pour une lettre de chaque mot (alif suscrit de Tanzil)."""

    unknown_symbol = UNK

    def encode(self, text: str) -> tuple[int, ...]:
        return (SYMBOLS[text], UNK)


def _service(model: _Model | None = None) -> AlignmentService:
    texts = AlignmentTexts(
        uthmani={V: ("ٱللَّهُ", "ٱلصَّمَدُ")},
        imlai={
            AlignmentVariant.BARE: {V: ("الله", "الصمد")},
            AlignmentVariant.VOCALIZED: {V: ("اللَّهُ", "الصَّمَدُ")},
        },
    )
    return AlignmentService(
        extract=lambda path: AudioClip(array("f", [0.2] * 16000 * 10), 16000, str(path)),
        model=model or _Model(),
        texts=texts,
        config=AlignmentConfig(energy_ratio=None),
        corpus_version="tanzil-test",
        max_passage_s=60.0,
    )


def run(tmp_path: Path, *args: str, model: _Model | None = None) -> tuple[int, str, str]:
    audio = tmp_path / "rec.wav"
    if not audio.exists():
        audio.write_bytes(b"RIFF")
    out, err = io.StringIO(), io.StringIO()
    code = main(
        ["align", str(audio), "--out-dir", str(tmp_path / "out"), *args],
        env={},
        out=out,
        err=err,
        aligner_factory=lambda options, env: _service(model),
    )
    return code, out.getvalue(), err.getvalue()


def test_sortie_alignment_json(tmp_path):
    code, out, err = run(tmp_path, "--verses", "112:2", "--at", "2-7")
    assert code == 0, err
    document = json.loads((tmp_path / "out" / "rec.alignment.json").read_text(encoding="utf-8"))
    assert document["schema"] == "aqr.alignment/2"
    assert document["kind"] == "forced_alignment"
    assert document["engine"]["model"] == "fake-ctc@0"
    [passage] = document["passages"]
    assert passage["declared"] == "112:2"
    assert passage["t"] == [2.0, 7.0]
    assert passage["variant"] == "simple_clean"
    span = passage["spans"][0]
    assert span["ref"] == "112:2" and span["words"] == [1, 2] and span["partial"] is False
    assert span["t"] == [pytest.approx(3.0), pytest.approx(6.0)]
    assert [w[0] for w in span["word_times"]] == [1, 2]
    assert passage["evidence"]["llr_per_frame"] == pytest.approx(0.0, abs=1e-6)
    assert "écrit" in out


def test_un_symbole_que_le_modele_n_emet_jamais_n_est_pas_exige(tmp_path):
    # Le modèle n'émet jamais `<unk>` : l'exiger pénaliserait tout texte qui en contient.
    code, _out, err = run(tmp_path, "--verses", "112:2", "--at", "2-7", model=_ModelWithUnknown())
    assert code == 0, err
    document = json.loads((tmp_path / "out" / "rec.alignment.json").read_text(encoding="utf-8"))
    [passage] = document["passages"]
    assert passage["evidence"]["llr_per_frame"] == pytest.approx(0.0, abs=1e-6)


def _plan(tmp_path: Path, passages: list[dict], sha: str | None = None) -> Path:
    import hashlib

    audio = tmp_path / "rec.wav"
    audio.write_bytes(b"RIFF")
    plan = tmp_path / "plan.json"
    source = {"sha256": sha or hashlib.sha256(b"RIFF").hexdigest(), "duration_s": 10.0}
    plan.write_text(
        json.dumps({"schema": "aqr.align-plan/1", "source": source, "passages": passages}),
        encoding="utf-8",
    )
    return plan


def test_plan_plusieurs_passages_un_en_erreur_n_arrete_pas_les_autres(tmp_path):
    plan = _plan(
        tmp_path,
        [
            {"t": [0, 5], "verses": "112:2"},
            {"t": [5, 6], "verses": "112:2,112:2,112:2"},
            {"t": [5, 10], "verses": "112:2[2-2]"},
        ],
    )
    code, _out, err = run(tmp_path, "--plan", str(plan))
    assert code == 0, err
    document = json.loads((tmp_path / "out" / "rec.alignment.json").read_text(encoding="utf-8"))
    first, second, third = document["passages"]
    assert first["spans"][0]["ref"] == "112:2"
    assert "ne tient pas" in second["error"] and "spans" not in second
    assert third["spans"][0]["partial"] is True
    assert "AVERTISSEMENT" in err


def test_plan_d_un_autre_audio_refuse(tmp_path):
    plan = _plan(tmp_path, [{"t": [0, 5], "verses": "112:2"}], sha="0" * 64)
    code, _out, err = run(tmp_path, "--plan", str(plan))
    assert code == 2 and "autre audio" in err


def test_plan_alignment_propose_des_passages(tmp_path):
    prediction = tmp_path / "x.recognition.json"
    prediction.write_text(
        json.dumps(
            {
                "schema": "aqr.recognition/1",
                "source": {"file": "x", "sha256": "ab" * 32, "duration_s": 100.0},
                "intervals": [
                    {
                        "kind": "verse",
                        "ref": "112:1",
                        "words": [5, 8],
                        "partial": False,
                        "status": "recognized",
                        "t": [10.0, 13.0],
                    },
                    {
                        "kind": "verse",
                        "ref": "112:2",
                        "words": [1, 2],
                        "partial": False,
                        "status": "recognized",
                        "t": [13.5, 15.0],
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    out, err = io.StringIO(), io.StringIO()
    target = tmp_path / "plan.json"
    assert (
        main(["plan-alignment", str(prediction), "--out", str(target)], env={}, out=out, err=err)
        == 0
    )
    plan = json.loads(target.read_text(encoding="utf-8"))
    assert plan["schema"] == "aqr.align-plan/1"
    assert plan["source"]["sha256"] == "ab" * 32
    assert plan["passages"] == [{"t": [9.0, 16.0], "verses": "112:1-112:2"}]


def test_plan_alignment_refuse_un_autre_document(tmp_path):
    other = tmp_path / "x.json"
    other.write_text(json.dumps({"schema": "aqr.alignment/2"}), encoding="utf-8")
    out, err = io.StringIO(), io.StringIO()
    assert main(["plan-alignment", str(other)], env={}, out=out, err=err) == 1


def test_pas_d_ecrasement_silencieux(tmp_path):
    assert run(tmp_path, "--verses", "112:2")[0] == 0
    code, _out, err = run(tmp_path, "--verses", "112:2")
    assert code == 1 and "--force" in err
    assert run(tmp_path, "--verses", "112:2", "--force")[0] == 0


def test_declaration_invalide_code_2(tmp_path):
    code, _out, err = run(tmp_path, "--verses", "112:9")
    assert code == 2 and "--verses" in err


def test_passage_trop_long_ou_hors_fichier(tmp_path):
    code, _out, err = run(tmp_path, "--verses", "112:2", "--at", "0-200")
    assert code == 1 and "passage" in err


def test_texte_qui_ne_tient_pas_dans_le_passage(tmp_path):
    code, _out, err = run(tmp_path, "--verses", "112:2,112:2,112:2", "--at", "0-1")
    assert code == 1 and "ne tient pas" in err


def test_fichier_absent(tmp_path):
    out, err = io.StringIO(), io.StringIO()
    code = main(
        ["align", str(tmp_path / "absent.wav"), "--verses", "112:2"],
        env={},
        out=out,
        err=err,
        aligner_factory=lambda options, env: _service(),
    )
    assert code == 1 and "introuvable" in err.getvalue()


def test_formules_declarees_a_leur_place():
    from aqr.corpus.alignment_text import Formula
    from aqr.domain.models import NonQuranKind

    spans = parse_verse_spec("takbir, 1:7, Amin", count)
    assert spans == [
        Formula(NonQuranKind.TAKBIR),
        WordSpan(VerseRef(1, 7), 1, 9),
        Formula(NonQuranKind.AMIN),
    ]
    with pytest.raises(ValueError):
        parse_verse_spec("french", count)
