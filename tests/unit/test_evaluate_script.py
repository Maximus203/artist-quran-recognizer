"""scripts/evaluate.py de bout en bout : manifeste et prédictions synthétiques."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from aqr.data.manifest import (
    Annotation,
    AudioCase,
    ExpectedItem,
    Manifest,
    NonQuranItem,
    WordRange,
)
from aqr.domain.models import NonQuranKind, Status, VerseRef

ROOT = Path(__file__).resolve().parents[2]


def _script():
    spec = importlib.util.spec_from_file_location("evaluate", ROOT / "scripts" / "evaluate.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _case(cid: str, split: str, *, human: bool, sha: str | None = None) -> AudioCase:
    return AudioCase(
        id=cid,
        file=f"C01/{cid}.mp3",
        sha256=sha or cid[-1] * 64,
        categorie=("C01",),
        recitant=f"r_{cid}",
        riwaya="hafs",
        langues=("ar",),
        license="x",
        duree_s=100.0,
        statut="annote" if human else "a_annoter",
        split=split,
        expected=(
            (ExpectedItem((0.0, 6.0), VerseRef(67, 4), WordRange.all(), Status.RECOGNIZED),) * human
        ),
        non_quran=((NonQuranItem((6.0, 12.0), NonQuranKind.FRENCH),) if human else ()),
        annotation=Annotation("human", "rel-01") if human else None,
    )


def _prediction(case: AudioCase, intervals, sha: str | None = None) -> dict:
    return {
        "schema": "aqr.recognition/1",
        "source": {"file": f"{case.id}.mp3", "sha256": sha or case.sha256, "duration_s": 100.0},
        "engine": {"asr": "synthetic"},
        "decoder": {},
        "timing": {"total_s": 20.0},
        "intervals": intervals,
    }


VERSE_OK = {
    "kind": "verse",
    "ref": "67:4",
    "words": [1, 10],
    "status": "recognized",
    "t": [0.0, 6.0],
    "time_interpolated": False,
    "confidence": 1.0,
    "candidates": [],
}
VERSE_FALSE = {**VERSE_OK, "ref": "1:2", "t": [7.0, 10.0]}


@pytest.fixture()
def world(tmp_path: Path):
    cases = [
        _case("devA", "dev", human=True),
        _case("devB", "dev", human=False),  # non annoté : ignoré, jamais compté
        _case("tesA", "test", human=True),
    ]
    manifest = tmp_path / "manifest.yaml"
    Manifest(cases=cases).save(manifest)
    preds = tmp_path / "preds"
    preds.mkdir()
    (preds / "devA.json").write_text(
        json.dumps(_prediction(cases[0], [VERSE_OK, VERSE_FALSE])), encoding="utf-8"
    )
    (preds / "devB.json").write_text(json.dumps(_prediction(cases[1], [VERSE_OK])), "utf-8")
    (preds / "tesA.json").write_text(json.dumps(_prediction(cases[2], [VERSE_OK])), "utf-8")
    return tmp_path, manifest, preds


def _run(manifest, preds, out, *extra):
    script = _script()
    return script.main(
        [
            "--manifest", str(manifest),
            "--predictions", str(preds),
            "--out", str(out),
            "--min-reference-verses", "5",
            *extra,
        ]
    )  # fmt: skip


def test_dev_calcule_sur_les_seuls_cas_annotes_humainement(world, capsys):
    tmp, manifest, preds = world
    out = tmp / "report.json"
    assert _run(manifest, preds, out, "--split", "dev") == 0
    report = json.loads(out.read_text(encoding="utf-8"))
    overall = report["aggregate"]["overall"]
    assert overall["n_cases"] == 1 and overall["n_reference_verses"] == 1
    assert overall["n_false_verses"] == 1 and overall["n_recognized_predictions"] == 2
    assert overall["false_verse_rate"] == pytest.approx(0.5)
    assert overall["defensible"] is False  # 1 verset < 5 : échantillon trop petit
    assert report["split"] == "dev" and report["final"] is False
    assert report["policy"]["min_overlap"] == 0.5
    assert [s["id"] for s in report["skipped"]] == ["devB"]
    assert "pas évaluable" in report["skipped"][0]["reason"]
    printed = capsys.readouterr().out
    assert "1 cas" in printed and "1 verset" in printed and "non défendable" in printed


def test_le_jeu_test_est_refuse_sans_final(world, capsys):
    tmp, manifest, preds = world
    out = tmp / "report.json"
    assert _run(manifest, preds, out, "--split", "test") == 2
    assert not out.exists()
    assert "réservé" in capsys.readouterr().err
    assert _run(manifest, preds, out, "--split", "test", "--final") == 0
    assert json.loads(out.read_text(encoding="utf-8"))["final"] is True


def test_aucun_cas_annote_ne_donne_aucune_metrique_et_code_non_nul(tmp_path: Path, capsys):
    manifest = tmp_path / "m.yaml"
    Manifest(cases=[_case("devB", "dev", human=False)]).save(manifest)
    preds = tmp_path / "p"
    preds.mkdir()
    out = tmp_path / "r.json"
    assert _run(manifest, preds, out) != 0
    assert "aucun cas annoté par un humain : aucune métrique" in capsys.readouterr().err
    report = json.loads(out.read_text(encoding="utf-8"))
    assert report["aggregate"] is None and report["cases"] == []


def test_une_annotation_de_modele_n_ouvre_pas_la_porte(tmp_path: Path, capsys):
    from dataclasses import replace

    case = replace(
        _case("devA", "dev", human=True), annotation=Annotation("model_preannotation", None)
    )
    case = replace(case, statut="a_annoter")
    manifest = tmp_path / "m.yaml"
    Manifest(cases=[case]).save(manifest)
    preds = tmp_path / "p"
    preds.mkdir()
    (preds / "devA.json").write_text(json.dumps(_prediction(case, [VERSE_OK])), "utf-8")
    assert _run(manifest, preds, tmp_path / "r.json") != 0
    assert "aucune métrique" in capsys.readouterr().err


def test_prediction_manquante_et_mauvais_audio(world, capsys):
    tmp, manifest, preds = world
    (preds / "devA.json").unlink()
    out = tmp / "r.json"
    assert _run(manifest, preds, out) != 0  # rien d'évalué
    report = json.loads(out.read_text(encoding="utf-8"))
    assert report["missing_predictions"] == ["devA"] and report["aggregate"] is None
    case = _case("devA", "dev", human=True)
    (preds / "devA.json").write_text(
        json.dumps(_prediction(case, [VERSE_OK], sha="f" * 64)), encoding="utf-8"
    )
    assert _run(manifest, preds, out) == 1
    report = json.loads(out.read_text(encoding="utf-8"))
    assert report["refused"][0]["id"] == "devA" and "sha256" in report["refused"][0]["reason"]


def test_seuil_de_versets_obligatoire(world):
    _, manifest, preds = world
    with pytest.raises(SystemExit):
        _script().main(["--manifest", str(manifest), "--predictions", str(preds)])


# --- B3 : blocs vitesse / exactitude, transcription, faux positifs, base de comparaison ---------


class _FakeCorpus:
    """Mots Uthmani de 67:4 (début) : suffisant pour noter une transcription sans corpus réel."""

    def words(self, ref: VerseRef) -> tuple[str, ...]:
        assert ref == VerseRef(67, 4)
        return ("ثُمَّ", "ٱرْجِعِ", "ٱلْبَصَرَ")


def _transcript(case: AudioCase, text: str, *, sha: str | None = None, peak: float | None = None):
    run = {} if peak is None else {"peak_rss_mb": peak}
    return {
        "schema": "aqr.transcript/1",
        "source": {"sha256": sha or case.sha256},
        "engine": {"asr": "synthetic"},
        "text": text,
        "run": run,
    }


def _run_full(manifest, preds, out, *extra, **kwargs):
    script = _script()
    return script.main(
        [
            "--manifest", str(manifest),
            "--predictions", str(preds),
            "--out", str(out),
            "--min-reference-verses", "5",
            "--models-lock", str(ROOT / "models" / "LOCK.json"),
            *extra,
        ],
        **kwargs,
    )  # fmt: skip


def test_rapport_en_deux_blocs_avec_provenance_et_avertissements(world, capsys):
    tmp, manifest, preds = world
    out = tmp / "report.json"
    assert _run_full(manifest, preds, out, "--split", "dev") == 0
    report = json.loads(out.read_text(encoding="utf-8"))
    assert report["schema"] == "aqr.evaluation/2"
    assert set(report["vitesse"]) >= {"wall_s", "realtime_factor", "peak_ram_mb", "machine"}
    assert report["vitesse"]["wall_s"] == pytest.approx(20.0)
    assert report["vitesse"]["realtime_factor"] == pytest.approx(0.2)
    assert report["vitesse"]["machine"]["cores"] >= 1 and report["vitesse"]["machine"]["cpu_model"]
    assert report["vitesse"]["peak_ram_mb"] is None  # non mesuré, jamais inventé
    ident = report["exactitude"]["identification"]
    assert ident["verse_exact"]["hits"] == 1 and ident["verse_exact"]["total"] == 1
    assert ident["n_extra_refs"] == 1 and ident["range_exact"]["hits"] == 0
    assert (
        report["exactitude"]["localisation"] == report["aggregate"]
    )  # même objet, pas un recalcul
    assert report["git"]["sha"] and len(report["models"]["lock_sha256"]) == 64
    assert report["models"]["models"]  # empreintes de models/LOCK.json
    assert report["thresholds"]["match"] == {"min_overlap": 0.5}
    assert report["thresholds"]["min_reference_verses"] == 5
    assert report["normalization"]["version"].startswith("aqr.normalize/")
    # version de la normalisation stricte écrite à part : un rapport d'avant le correctif en manque
    assert report["normalization"]["strict_version"].startswith("aqr.normalize-strict/")
    assert report["split"] == "dev" and report["manifest"]["sha256"]
    lines = report["warnings"]
    assert "identification de verset != validation du tajwid" in lines
    assert "plafond optimiste si audio EveryAyah" in lines
    printed = capsys.readouterr().out
    assert "VITESSE" in printed and "EXACTITUDE" in printed
    assert "identification de verset != validation du tajwid" in printed


def test_transcription_non_fournie_est_dite_non_mesuree(world):
    tmp, manifest, preds = world
    out = tmp / "report.json"
    assert _run_full(manifest, preds, out) == 0
    transcription = json.loads(out.read_text(encoding="utf-8"))["exactitude"]["transcription"]
    assert transcription["measured"] is False and "--transcripts" in transcription["reason"]
    assert transcription["variants"] == {}


def test_wer_cer_deux_variantes_nommees(world):
    tmp, manifest, preds = world
    transcripts = tmp / "tr"
    transcripts.mkdir()
    case = _case("devA", "dev", human=True)
    # « ثم ارجع » sans « البصر » : 1 mot omis sur 3
    (transcripts / "devA.transcript.json").write_text(
        json.dumps(_transcript(case, "ثم ارجع", peak=1234.5)), encoding="utf-8"
    )
    out = tmp / "report.json"
    code = _run_full(
        manifest,
        preds,
        out,
        "--transcripts",
        str(transcripts),
        corpus=_FakeCorpus(),
        corrections={},
    )
    assert code == 0
    report = json.loads(out.read_text(encoding="utf-8"))
    transcription = report["exactitude"]["transcription"]
    assert transcription["measured"] is True and transcription["n_cases"] == 1
    assert set(transcription["variants"]) == {"tolerante", "strict-lettres"}
    for name in ("tolerante", "strict-lettres"):
        variant = transcription["variants"][name]
        assert variant["word_errors"] == 1 and variant["word_total"] == 3
        assert variant["wer"] == pytest.approx(1 / 3) and variant["description"]
        assert variant["cer"] is not None
    assert report["vitesse"]["peak_ram_mb"] == 1234.5
    assert report["normalization"]["fingerprint"]


def test_transcription_d_un_autre_audio_refusee(world, capsys):
    tmp, manifest, preds = world
    transcripts = tmp / "tr"
    transcripts.mkdir()
    case = _case("devA", "dev", human=True)
    (transcripts / "devA.transcript.json").write_text(
        json.dumps(_transcript(case, "ثم ارجع", sha="f" * 64)), encoding="utf-8"
    )
    out = tmp / "report.json"
    code = _run_full(
        manifest,
        preds,
        out,
        "--transcripts",
        str(transcripts),
        corpus=_FakeCorpus(),
        corrections={},
    )
    assert code == 1
    report = json.loads(out.read_text(encoding="utf-8"))
    assert report["exactitude"]["transcription"]["refused"][0]["id"] == "devA"
    assert "sha256" in capsys.readouterr().err


def test_faux_positifs_sur_silence_et_hors_cible(tmp_path: Path):
    def control(cid: str, kind: NonQuranKind) -> AudioCase:
        return AudioCase(
            id=cid, file=f"C10/{cid}.mp3", sha256=cid[-1] * 64, categorie=("C10",),
            recitant="r", riwaya="hafs", langues=("ar",), license="x", duree_s=100.0,
            statut="annote", split="dev", annotation=Annotation("human", "rel-01"),
            non_quran=(NonQuranItem((0.0, 90.0), kind),),
        )  # fmt: skip

    cases = [
        control("devS", NonQuranKind.SILENCE),
        control("devF", NonQuranKind.FRENCH),
        control("devG", NonQuranKind.ARABIC_SPEECH),
    ]
    manifest = tmp_path / "m.yaml"
    Manifest(cases=cases).save(manifest)
    preds = tmp_path / "p"
    preds.mkdir()
    (preds / "devS.json").write_text(json.dumps(_prediction(cases[0], [])), encoding="utf-8")
    (preds / "devF.json").write_text(
        json.dumps(_prediction(cases[1], [VERSE_FALSE, VERSE_OK])), encoding="utf-8"
    )
    (preds / "devG.json").write_text(json.dumps(_prediction(cases[2], [])), encoding="utf-8")
    out = tmp_path / "r.json"
    assert _run_full(manifest, preds, out) == 0
    ident = json.loads(out.read_text(encoding="utf-8"))["exactitude"]["identification"]
    assert ident["silence"] == {
        "n_cases": 1, "n_false_positive_cases": 0, "n_false_positive_verses": 0,
    }  # fmt: skip
    assert ident["off_target"] == {
        "n_cases": 2, "n_false_positive_cases": 1, "n_false_positive_verses": 2,
    }  # fmt: skip


def test_baseline_compare_deux_executions_du_meme_manifeste(world, capsys):
    tmp, manifest, preds = world
    first = tmp / "first.json"
    assert _run_full(manifest, preds, first) == 0
    # même manifeste, la seconde exécution corrige le faux verset
    case = _case("devA", "dev", human=True)
    (preds / "devA.json").write_text(json.dumps(_prediction(case, [VERSE_OK])), encoding="utf-8")
    second = tmp / "second.json"
    assert _run_full(manifest, preds, second, "--baseline", str(first)) == 0
    comparison = json.loads(second.read_text(encoding="utf-8"))["comparison"]
    assert comparison["baseline"].endswith("first.json")
    delta = comparison["metrics"]["exactitude.identification.n_extra_refs"]
    assert delta["baseline"] == 1.0 and delta["current"] == 0.0 and delta["delta"] == -1.0
    assert "COMPARAISON" in capsys.readouterr().out


def test_baseline_refusee_si_les_manifestes_different(world, capsys):
    tmp, manifest, preds = world
    first = tmp / "first.json"
    assert _run_full(manifest, preds, first) == 0
    other = tmp / "other.yaml"  # autre manifeste : un cas annoté de plus
    cases = [*Manifest.load(manifest).cases, _case("devC", "dev", human=True)]
    Manifest(cases=cases).save(other)
    (preds / "devC.json").write_text(
        json.dumps(_prediction(_case("devC", "dev", human=True), [VERSE_OK])), encoding="utf-8"
    )
    out = tmp / "second.json"
    assert _run_full(other, preds, out, "--baseline", str(first)) == 2
    assert not out.exists()  # rien n'est écrit quand la comparaison est refusée
    assert "manifeste" in capsys.readouterr().err


def test_baseline_illisible_ou_d_un_autre_schema_refusee(world, capsys):
    tmp, manifest, preds = world
    bad = tmp / "bad.json"
    bad.write_text("pas du json", encoding="utf-8")
    assert _run_full(manifest, preds, tmp / "o.json", "--baseline", str(bad)) == 2
    old = tmp / "old.json"
    old.write_text(json.dumps({"schema": "aqr.evaluation/1"}), encoding="utf-8")
    assert _run_full(manifest, preds, tmp / "o.json", "--baseline", str(old)) == 2
    assert not (tmp / "o.json").exists()
    assert "baseline" in capsys.readouterr().err


def test_split_test_exige_toujours_final_meme_avec_baseline(world, capsys):
    tmp, manifest, preds = world
    first = tmp / "first.json"
    assert _run_full(manifest, preds, first, "--split", "test", "--final") == 0
    out = tmp / "second.json"
    assert _run_full(manifest, preds, out, "--split", "test", "--baseline", str(first)) == 2
    assert not out.exists() and "réservé" in capsys.readouterr().err
    code = _run_full(manifest, preds, out, "--split", "test", "--final", "--baseline", str(first))
    assert code == 0
