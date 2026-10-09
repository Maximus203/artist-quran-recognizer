"""scripts/evaluate.py de bout en bout : manifeste et prédictions synthétiques."""

from __future__ import annotations

import importlib.util
import json
from dataclasses import replace
from pathlib import Path

import pytest

from aqr.data.config import DataConfig
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
    # ces tests lisent un dossier SANS run.json (anciennes prédictions) : mode explicite
    script = _script()
    return script.main(
        [
            "--manifest", str(manifest),
            "--predictions", str(preds),
            "--out", str(out),
            "--min-reference-verses", "5",
            "--allow-unverified-run",
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


def test_la_quarantaine_n_est_jamais_evaluee_meme_avec_final(world, capsys):
    tmp, manifest, preds = world
    quarantaine = DataConfig().quarantine_split
    saved = Manifest.load(manifest)
    saved.upsert(replace(_case("quaA", quarantaine, human=True)))
    saved.save(manifest)
    (preds / "quaA.json").write_text(
        json.dumps(_prediction(_case("quaA", "x", human=True), [])), "utf-8"
    )
    out = tmp / "report.json"
    for extra in ((), ("--final",)):
        with pytest.raises(SystemExit) as exc:
            _run(manifest, preds, out, "--split", quarantaine, *extra)
        assert exc.value.code == 2
        assert "jamais évaluée" in capsys.readouterr().err
    assert not out.exists()


def test_un_cas_en_quarantaine_est_absent_des_rapports_dev_et_test(world):
    tmp, manifest, preds = world
    saved = Manifest.load(manifest)
    saved.upsert(_case("quaA", DataConfig().quarantine_split, human=True))
    saved.save(manifest)
    (preds / "quaA.json").write_text(
        json.dumps(_prediction(_case("quaA", "x", human=True), [VERSE_OK])), "utf-8"
    )
    for extra in (("--split", "dev"), ("--split", "test", "--final")):
        out = tmp / "report.json"
        assert _run(manifest, preds, out, *extra) == 0
        text = out.read_text(encoding="utf-8")
        assert "quaA" not in text
        assert json.loads(text)["aggregate"]["overall"]["n_cases"] == 1  # devA / tesA seuls


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
            "--allow-unverified-run",
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
    strict_description = transcription["variants"]["strict-lettres"]["description"]
    assert (
        "plancher" in strict_description and "pas un taux d'erreur de l'ASR" in strict_description
    )
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


def test_baseline_sans_strict_version_refusee_de_bout_en_bout(world, capsys):
    # Rapport écrit avant le correctif strict-lettres : ses scores « stricts » n'en étaient pas.
    tmp, manifest, preds = world
    first = tmp / "first.json"
    assert _run_full(manifest, preds, first) == 0
    report = json.loads(first.read_text(encoding="utf-8"))
    assert report["normalization"]["strict_version"].startswith("aqr.normalize-strict/")
    del report["normalization"]["strict_version"]  # empreinte et dictionnaire restent identiques
    old = tmp / "old.json"
    old.write_text(json.dumps(report), encoding="utf-8")
    out = tmp / "second.json"
    capsys.readouterr()
    assert _run_full(manifest, preds, out, "--baseline", str(old)) == 2
    assert not out.exists()  # rien n'est écrit quand la comparaison est refusée
    err = capsys.readouterr().err
    assert "version stricte : absente (base)" in err and "None" not in err
    # la même base, complète, reste comparable
    assert _run_full(manifest, preds, out, "--baseline", str(first)) == 0


def test_split_test_exige_toujours_final_meme_avec_baseline(world, capsys):
    tmp, manifest, preds = world
    first = tmp / "first.json"
    assert _run_full(manifest, preds, first, "--split", "test", "--final") == 0
    out = tmp / "second.json"
    assert _run_full(manifest, preds, out, "--split", "test", "--baseline", str(first)) == 2
    assert not out.exists() and "réservé" in capsys.readouterr().err
    code = _run_full(manifest, preds, out, "--split", "test", "--final", "--baseline", str(first))
    assert code == 0


# --- run.json : on n'évalue que ce qu'un lot complet a écrit (PR #41) ----------------------------


def _sha_of(path: Path) -> str:
    import hashlib

    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_run(preds: Path, **over) -> dict:
    """run.json d'un lot (aqr.recognition-run/1) ; `done` = empreintes des fichiers présents."""
    present = sorted(p for p in preds.glob("*.json") if p.name != "run.json")
    document = {
        "schema": "aqr.recognition-run/1",
        "status": "complete",
        "asr": "synthetic",
        "engine": {"asr": "synthetic"},
        "options": {"split": "dev"},
        "git": {"sha": None, "dirty": None},
        "manifest": {"name": "manifest.yaml", "sha256": "m" * 64},
        "planned": [p.stem for p in present],
        "done": {p.stem: _sha_of(p) for p in present},
        "failed": {},
        "timing": {"started_at": "2026-10-09T10:00:00+00:00", "finished_at": None},
        "error": None,
    }
    document.update(over)
    (preds / "run.json").write_text(json.dumps(document), encoding="utf-8")
    return document


def _strict(manifest, preds, out, *extra):
    """Appel SANS --allow-unverified-run : le défaut sûr."""
    return _script().main(
        [
            "--manifest", str(manifest),
            "--predictions", str(preds),
            "--out", str(out),
            "--min-reference-verses", "5",
            "--models-lock", str(ROOT / "models" / "LOCK.json"),
            *extra,
        ]
    )  # fmt: skip


def _report(out: Path) -> dict:
    return json.loads(out.read_text(encoding="utf-8"))


def test_sans_run_json_le_defaut_est_un_refus_et_rien_n_est_ecrit(world, capsys):
    tmp, manifest, preds = world
    out = tmp / "report.json"
    assert _strict(manifest, preds, out) == 2
    assert not out.exists()
    err = capsys.readouterr().err
    assert "run.json" in err and "--allow-unverified-run" in err


@pytest.mark.parametrize("status", ["running", "partial", "interrupted"])
def test_un_lot_non_complet_est_refuse(world, capsys, status):
    tmp, manifest, preds = world
    _write_run(preds, status=status)
    out = tmp / "report.json"
    assert _strict(manifest, preds, out) == 2
    assert not out.exists()
    assert status in capsys.readouterr().err


def test_run_json_illisible_est_refuse(world, capsys):
    tmp, manifest, preds = world
    (preds / "run.json").write_text("{ pas du json", encoding="utf-8")
    out = tmp / "report.json"
    assert _strict(manifest, preds, out) == 2
    assert not out.exists() and "run.json" in capsys.readouterr().err


def test_lot_complet_est_evalue_et_le_rapport_porte_le_moteur_et_le_run(world):
    tmp, manifest, preds = world
    _write_run(preds, git={"sha": "a" * 40, "dirty": False})
    out = tmp / "report.json"
    assert _strict(manifest, preds, out) == 0
    report = _report(out)
    assert report["engine"] == {"asr": "synthetic"}
    run = report["run"]
    assert run["verified"] is True and run["status"] == "complete" and run["asr"] == "synthetic"
    assert run["git"] == {"sha": "a" * 40, "dirty": False}
    assert run["failed"] == {} and run["unlisted"] == []
    assert report["aggregate"]["overall"]["n_cases"] == 1


def test_allow_unverified_run_passe_et_le_dit_dans_le_rapport(world, capsys):
    tmp, manifest, preds = world
    out = tmp / "report.json"
    assert _strict(manifest, preds, out, "--allow-unverified-run") == 0
    run = _report(out)["run"]
    assert run["verified"] is False and "run.json absent" in run["reason"]
    assert "non vérifié" in capsys.readouterr().out
    # même option, run.json partiel : la raison dit pourquoi
    _write_run(preds, status="partial")
    assert _strict(manifest, preds, out, "--allow-unverified-run") == 0
    reason = _report(out)["run"]["reason"]
    assert "partial" in reason


def test_un_fichier_modifie_depuis_le_lot_est_refuse_et_pas_lu(world):
    tmp, manifest, preds = world
    _write_run(preds)
    case = _case("devA", "dev", human=True)
    (preds / "devA.json").write_text(  # même moteur, autre contenu : écrit après le lot
        json.dumps(_prediction(case, [VERSE_OK])), encoding="utf-8"
    )
    out = tmp / "report.json"
    assert _strict(manifest, preds, out) == 1
    report = _report(out)
    assert [r["id"] for r in report["refused"]] == ["devA"]
    assert (
        "run.json" in report["refused"][0]["reason"] and "sha256" in report["refused"][0]["reason"]
    )
    assert report["aggregate"] is None  # le fichier modifié n'a alimenté aucune métrique


def test_un_fichier_absent_de_done_n_est_jamais_lu(world, capsys):
    tmp, manifest, preds = world
    _write_run(preds, done={}, planned=[])  # devA.json existe sur disque, d'un autre run
    out = tmp / "report.json"
    assert _strict(manifest, preds, out) == 1
    report = _report(out)
    assert report["missing_predictions"] == ["devA"] and report["aggregate"] is None
    assert report["run"]["unlisted"] == ["devA"]
    assert "devA" in capsys.readouterr().err


def test_un_cas_en_echec_dans_le_lot_est_manquant_avec_son_message(world):
    tmp, manifest, preds = world
    (preds / "devA.json").unlink()
    _write_run(preds, planned=["devA"], done={}, failed={"devA": "RuntimeError: modèle en panne"})
    out = tmp / "report.json"
    assert _strict(manifest, preds, out) == 1
    report = _report(out)
    assert report["missing_predictions"] == ["devA"]
    assert report["run"]["failed"] == {"devA": "RuntimeError: modèle en panne"}


def test_deux_moteurs_dans_un_dossier_sont_refuses(world, capsys):
    tmp, manifest, preds = world
    other = _case("devC", "dev", human=True)
    saved = Manifest.load(manifest)
    saved.upsert(other)
    saved.save(manifest)
    foreign = _prediction(other, [VERSE_OK])
    foreign["engine"] = {"asr": "autre-moteur"}
    (preds / "devC.json").write_text(json.dumps(foreign), encoding="utf-8")
    out = tmp / "report.json"
    assert _strict(manifest, preds, out, "--allow-unverified-run") == 2  # anciennes prédictions
    assert not out.exists()
    err = capsys.readouterr().err
    assert "plusieurs moteurs" in err and "autre-moteur" in err and "synthetic" in err


def test_un_fichier_d_un_autre_moteur_que_celui_du_run_est_refuse(world, capsys):
    tmp, manifest, preds = world
    _write_run(preds, engine={"asr": "moteur-du-lot"})  # les sorties disent « synthetic »
    out = tmp / "report.json"
    assert _strict(manifest, preds, out) == 2
    assert not out.exists() and "plusieurs moteurs" in capsys.readouterr().err


@pytest.mark.parametrize("verified", [True, False], ids=["run-verifie", "mode-explicite"])
def test_des_cas_evaluables_sans_prediction_donnent_le_code_1(world, verified):
    tmp, manifest, preds = world
    extra = _case("devC", "dev", human=True)  # évaluable, jamais reconnu
    saved = Manifest.load(manifest)
    saved.upsert(extra)
    saved.save(manifest)
    if verified:
        _write_run(preds)
    out = tmp / "report.json"
    flags = () if verified else ("--allow-unverified-run",)
    assert _strict(manifest, preds, out, *flags) == 1
    report = _report(out)
    assert report["missing_predictions"] == ["devC"]
    assert report["aggregate"]["overall"]["n_cases"] == 1  # devA reste évalué et rapporté


def test_la_base_de_comparaison_signale_le_changement_de_moteur(world):
    tmp, manifest, preds = world
    first = tmp / "first.json"
    assert _run_full(manifest, preds, first) == 0
    case = _case("devA", "dev", human=True)
    swapped = _prediction(case, [VERSE_OK, VERSE_FALSE])
    swapped["engine"] = {"asr": "autre-moteur"}
    (preds / "devA.json").write_text(json.dumps(swapped), encoding="utf-8")
    second = tmp / "second.json"
    assert _run_full(manifest, preds, second, "--baseline", str(first)) == 0
    changes = _report(second)["comparison"]["context_changes"]
    assert any(c.startswith("moteur") and "autre-moteur" in c for c in changes)


def test_un_manifeste_modifie_depuis_le_lot_est_signale_sans_etre_refuse(world):
    # annoter après la reconnaissance est le flux normal : seul l'audio (sha256) est verrouillé
    tmp, manifest, preds = world
    out = tmp / "report.json"
    _write_run(preds, manifest={"name": "manifest.yaml", "sha256": _sha_of(manifest)})
    assert _strict(manifest, preds, out) == 0
    assert not any("manifeste modifié" in w for w in _report(out)["warnings"])
    _write_run(preds, manifest={"name": "manifest.yaml", "sha256": "0" * 64})
    assert _strict(manifest, preds, out) == 0
    assert any("manifeste modifié" in w for w in _report(out)["warnings"])
