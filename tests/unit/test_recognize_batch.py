"""scripts/recognize_batch.py : un lot ne laisse aucune sortie d'un autre run (run.json, purge,
écriture atomique). Reconnaissance factice injectée : ni modèle, ni corpus, ni réseau."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from aqr.data.manifest import Annotation, AudioCase, ExpectedItem, Manifest, WordRange
from aqr.domain.models import Status, TimeSpan, VerseRef
from aqr.pipeline.factory import RecognizerUnavailable
from aqr.pipeline.result import AbstentionReason, AbstentionSpan, EngineInfo, RecognitionResult

ROOT = Path(__file__).resolve().parents[2]
IDS = ("devA", "devB", "devC")


def _script(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _case(cid: str, audio: Path, split: str = "dev") -> AudioCase:
    return AudioCase(
        id=cid,
        file=audio.name,
        sha256=_sha(audio.read_bytes()),
        categorie=("C01",),
        recitant=f"r_{cid}",
        riwaya="hafs",
        langues=("ar",),
        license="x",
        duree_s=5.0,
        statut="annote",
        split=split,
        expected=(ExpectedItem((0.0, 5.0), VerseRef(67, 4), WordRange.all(), Status.RECOGNIZED),),
        annotation=Annotation("human", "rel-01"),
    )


class _Pipeline:
    """`pipeline.run(path)` factice : abstention sur toute la durée, moteur nommé `engine`."""

    def __init__(
        self,
        engine: str,
        *,
        fail: dict[str, BaseException] | None = None,
        on_run: Callable[[str], None] | None = None,
    ) -> None:
        self.engine, self.fail, self.on_run = engine, fail or {}, on_run
        self.calls: list[str] = []

    def run(self, path: Path) -> RecognitionResult:
        self.calls.append(path.stem)
        if self.on_run is not None:
            self.on_run(path.stem)
        if path.stem in self.fail:
            raise self.fail[path.stem]
        if not path.exists():
            raise FileNotFoundError(f"audio introuvable : {path}")
        return RecognitionResult(
            source_file=path.name,
            duration_s=5.0,
            intervals=(AbstentionSpan(TimeSpan(0.0, 5.0), AbstentionReason.SILENCE),),
            engine=EngineInfo(self.engine, "seg", "matcher", "decoder"),
            timing={"total_s": 1.0},
            decoder_config={},
            windows=1,
        )


def _factory(pipeline: _Pipeline | Exception):
    def build(options: Any, env: Any) -> Any:
        if isinstance(pipeline, Exception):
            raise pipeline
        return SimpleNamespace(pipeline=pipeline, renderer=object())

    return build


@pytest.fixture()
def world(tmp_path: Path):
    audio = tmp_path / "audio"
    audio.mkdir()
    cases = []
    for cid in IDS:
        path = audio / f"{cid}.mp3"
        path.write_bytes(f"octets de {cid}".encode())
        cases.append(_case(cid, path))
    manifest = tmp_path / "manifest.yaml"
    Manifest(cases=cases).save(manifest)
    return SimpleNamespace(tmp=tmp_path, audio=audio, manifest=manifest, out=tmp_path / "out")


def _batch(world, pipeline: _Pipeline | Exception, *extra: str) -> int:
    return _script("recognize_batch").main(
        [
            "--manifest", str(world.manifest),
            "--audio-dir", str(world.audio),
            "--out-dir", str(world.out),
            "--split", "dev",
            *extra,
        ],
        recognizer_factory=_factory(pipeline),
        env={},
    )  # fmt: skip


def _evaluate(world, *extra: str) -> tuple[int, Path]:
    report = world.tmp / "rapport.json"
    code = _script("evaluate").main(
        [
            "--manifest", str(world.manifest),
            "--predictions", str(world.out),
            "--out", str(report),
            "--min-reference-verses", "1",
            "--models-lock", str(ROOT / "models" / "LOCK.json"),
            *extra,
        ]
    )  # fmt: skip
    return code, report


def _run_json(world) -> dict[str, Any]:
    return json.loads((world.out / "run.json").read_text(encoding="utf-8"))


def _engine_of(world, cid: str) -> str:
    return json.loads((world.out / f"{cid}.json").read_text(encoding="utf-8"))["engine"]["asr"]


def _leftovers(world) -> list[str]:
    return sorted(p.name for p in world.out.iterdir() if p.name.endswith(".tmp"))


def test_succes_ecrit_les_sorties_et_un_run_json_complet(world):
    assert _batch(world, _Pipeline("moteur-A"), "--asr", "whisper") == 0
    run = _run_json(world)
    assert run["schema"] == "aqr.recognition-run/1" and run["status"] == "complete"
    assert run["asr"] == "whisper" and run["engine"]["asr"] == "moteur-A"
    assert run["planned"] == list(IDS) and run["failed"] == {}
    assert run["done"] == {
        cid: _sha((world.out / f"{cid}.json").read_bytes()) for cid in IDS
    }  # empreinte du fichier ÉCRIT
    assert run["manifest"]["sha256"] == _sha(world.manifest.read_bytes())
    assert run["options"]["split"] == "dev" and run["options"]["asr"] == "whisper"
    assert len(run["git"]["sha"]) == 40 and isinstance(run["git"]["dirty"], bool)
    timing = run["timing"]
    assert timing["started_at"] and timing["finished_at"] and timing["model_load_s"] >= 0
    assert _leftovers(world) == []


def test_timings_nomme_le_pic_du_processus_et_non_un_pic_par_cas(world):
    assert _batch(world, _Pipeline("moteur-A")) == 0
    timings = json.loads((world.out / "timings.json").read_text(encoding="utf-8"))
    assert timings["status"] == "complete" and [r["id"] for r in timings["cases"]] == list(IDS)
    for row in timings["cases"]:
        assert "peak_rss_mb" not in row  # pic cumulé du processus, pas celui du cas
        assert row["process_peak_rss_mb"] >= 0 and row["wall_s"] >= 0 and row["audio_s"] == 5.0


def test_relance_d_un_autre_moteur_avec_un_echec_ne_laisse_pas_l_ancienne_sortie(world, capsys):
    assert _batch(world, _Pipeline("moteur-A")) == 0
    assert _engine_of(world, "devB") == "moteur-A"
    code = _batch(world, _Pipeline("moteur-B", fail={"devB": RuntimeError("modèle en panne")}))
    assert code == 1
    assert not (world.out / "devB.json").exists()  # l'ancien fichier du moteur A est purgé
    assert _engine_of(world, "devA") == "moteur-B" and _engine_of(world, "devC") == "moteur-B"
    run = _run_json(world)
    assert run["status"] == "partial" and list(run["done"]) == ["devA", "devC"]
    assert "modèle en panne" in run["failed"]["devB"]
    assert "devB" in capsys.readouterr().err


def test_changement_de_moteur_purge_les_anciens_fichiers_meme_si_le_modele_ne_charge_pas(world):
    assert _batch(world, _Pipeline("moteur-A")) == 0
    assert _batch(world, RecognizerUnavailable("AQR_MODELS_DIR manquant")) == 2
    assert not [p for p in world.out.glob("dev*.json")]  # aucune sortie du moteur A ne survit
    timings = json.loads((world.out / "timings.json").read_text(encoding="utf-8"))
    assert timings["status"] == "interrupted" and timings["cases"] == []  # pas celui du run A
    run = _run_json(world)
    assert run["status"] == "interrupted" and run["done"] == {}
    assert "AQR_MODELS_DIR" in run["error"]
    assert _evaluate(world)[0] == 2  # run non complet : refusé


def test_la_purge_ne_touche_que_run_timings_et_les_cas_du_lot(world):
    world.out.mkdir()
    keep = {
        "notes.txt": "à moi",
        "devA.transcript.json": "{}",  # sortie d'un autre outil, même préfixe
        "hors-lot.json": "{}",
    }
    for name, text in keep.items():
        (world.out / name).write_text(text, encoding="utf-8")
    assert _batch(world, _Pipeline("moteur-A")) == 0
    for name, text in keep.items():
        assert (world.out / name).read_text(encoding="utf-8") == text


def test_run_json_est_ecrit_avant_le_premier_cas_et_apres_chaque_cas(world):
    seen: dict[str, dict[str, Any]] = {}

    def peek(cid: str) -> None:
        seen[cid] = _run_json(world)

    assert _batch(world, _Pipeline("moteur-A", on_run=peek)) == 0
    assert seen["devA"]["status"] == "running" and seen["devA"]["done"] == {}
    assert seen["devA"]["planned"] == list(IDS)  # le plan est connu dès le départ
    assert list(seen["devB"]["done"]) == ["devA"] and seen["devB"]["status"] == "running"
    assert list(seen["devC"]["done"]) == ["devA", "devB"]
    assert list(_run_json(world)["done"]) == list(IDS)


@pytest.mark.parametrize(
    "boom", [KeyboardInterrupt(), KeyError("bogue inattendu")], ids=["ctrl-c", "exception"]
)
def test_lot_interrompu_est_marque_interrupted_code_non_nul_et_evaluate_refuse(world, boom):
    pipeline = _Pipeline("moteur-A", fail={"devB": boom})
    assert _batch(world, pipeline) != 0
    assert pipeline.calls == ["devA", "devB"]  # devC jamais tenté
    run = _run_json(world)
    assert run["status"] == "interrupted" and list(run["done"]) == ["devA"]
    assert run["timing"]["finished_at"] and run["error"]
    assert (world.out / "devA.json").exists()  # l'état partiel est lisible mais jamais évaluable
    code, report = _evaluate(world)
    assert code == 2 and not report.exists()


def test_ecriture_qui_echoue_entre_le_tmp_et_le_remplacement_ne_laisse_rien(
    world, monkeypatch, capsys
):
    assert _batch(world, _Pipeline("moteur-A")) == 0  # anciennes sorties à purger
    real_replace = os.replace

    def flaky(src: Any, dst: Any) -> None:
        if Path(dst).name == "devB.json":
            raise OSError("disque plein")
        real_replace(src, dst)

    monkeypatch.setattr(os, "replace", flaky)
    assert _batch(world, _Pipeline("moteur-B")) == 1
    assert not (world.out / "devB.json").exists()  # ni l'ancien (purgé) ni un fichier partiel
    assert _leftovers(world) == []
    assert _engine_of(world, "devC") == "moteur-B"  # le lot continue
    run = _run_json(world)
    assert run["status"] == "partial" and "disque plein" in run["failed"]["devB"]
    assert "devB" not in run["done"]


def test_limit_ne_touche_pas_les_autres_cas_mais_evaluate_signale_les_manquants(world):
    assert _batch(world, _Pipeline("moteur-A")) == 0
    stale = (world.out / "devC.json").read_bytes()
    assert _batch(world, _Pipeline("moteur-B"), "--limit", "2") == 0
    assert (world.out / "devC.json").read_bytes() == stale  # hors lot : intact
    run = _run_json(world)
    assert run["planned"] == ["devA", "devB"] and run["status"] == "complete"
    code, report = _evaluate(world)
    assert code == 1  # un cas évaluable n'a pas de prédiction de CE run
    data = json.loads(report.read_text(encoding="utf-8"))
    assert data["missing_predictions"] == ["devC"]
    assert data["run"]["unlisted"] == ["devC"]  # le fichier est vu, signalé, jamais lu
    assert data["aggregate"]["overall"]["n_cases"] == 2


def test_run_complet_est_evaluable(world):
    assert _batch(world, _Pipeline("moteur-A")) == 0
    code, report = _evaluate(world)
    assert code == 0
    data = json.loads(report.read_text(encoding="utf-8"))
    assert data["run"]["verified"] is True and data["engine"]["asr"] == "moteur-A"


def test_test_exige_final_et_un_lot_vide_est_refuse_sans_rien_purger(world):
    assert _batch(world, _Pipeline("moteur-A")) == 0
    before = {p.name: p.read_bytes() for p in world.out.iterdir()}
    assert _batch(world, _Pipeline("moteur-B"), "--split", "test") == 2  # réservé sans --final
    assert _batch(world, _Pipeline("moteur-B"), "--only-condition", "inconnue") == 2  # lot vide
    assert {p.name: p.read_bytes() for p in world.out.iterdir()} == before


@pytest.mark.parametrize("bad_id", ["run", "timings", "../evil", "a/b"])
def test_un_identifiant_de_cas_ne_peut_pas_designer_un_fichier_du_lot_ni_sortir_du_dossier(
    world, bad_id
):
    audio = world.audio / "x.mp3"
    audio.write_bytes(b"x")
    saved = Manifest.load(world.manifest)
    saved.upsert(_case(bad_id, audio))  # `run.json` serait à la fois une sortie et l'état du lot
    saved.save(world.manifest)
    assert _batch(world, _Pipeline("moteur-A")) == 2
    assert not world.out.exists()  # rien n'est créé ni purgé


def test_le_flag_de_evaluate_ne_lit_pas_un_cas_perime_d_un_lot_interrompu(world):
    # sonde de relecture : lot A complet, lot B (--limit 2) interrompu ; devC reste celui du lot A
    assert _batch(world, _Pipeline("moteur")) == 0
    boom = {"devB": KeyboardInterrupt()}
    assert _batch(world, _Pipeline("moteur", fail=boom), "--limit", "2") != 0
    assert (world.out / "devC.json").exists()  # périmé, hors du lot B
    code, report = _evaluate(world, "--allow-unverified-run")
    assert code == 2 and not report.exists()  # run.json existe et n'est pas complete : refus


def test_run_json_et_timings_json_d_un_run_precedent_sont_purges_avant_le_premier_cas(world):
    world.out.mkdir()
    (world.out / "run.json").write_text(
        json.dumps({"schema": "aqr.recognition-run/1", "status": "complete", "asr": "ancien"}),
        encoding="utf-8",
    )
    (world.out / "timings.json").write_text('{"status": "complete", "asr": "ancien"}', "utf-8")
    seen: dict[str, Any] = {}

    def peek(cid: str) -> None:
        if not seen:  # avant le premier cas
            seen["timings"] = (world.out / "timings.json").exists()
            seen["asr"] = _run_json(world)["asr"]
            seen["status"] = _run_json(world)["status"]

    assert _batch(world, _Pipeline("moteur-A", on_run=peek), "--asr", "whisper") == 0
    assert seen == {"timings": False, "asr": "whisper", "status": "running"}


def test_echec_de_l_ecriture_finale_de_run_json_laisse_running_code_1_et_evaluate_refuse(
    world, monkeypatch, capsys
):
    real_replace = os.replace

    def refuse_final(src: Any, dst: Any) -> None:
        if Path(dst).name == "run.json" and '"status": "complete"' in Path(src).read_text("utf-8"):
            raise OSError("disque plein")
        real_replace(src, dst)

    monkeypatch.setattr(os, "replace", refuse_final)
    assert _batch(world, _Pipeline("moteur-A")) == 1  # jamais 0 : l'état final n'est pas écrit
    assert _run_json(world)["status"] == "running"  # dernier état écrit : lot non conclu
    assert "disque plein" in capsys.readouterr().err
    monkeypatch.undo()
    assert _evaluate(world)[0] == 2  # running n'est pas évaluable


def test_un_second_lot_sur_le_meme_dossier_est_refuse_pendant_que_le_premier_tourne(world, capsys):
    import threading

    started, release = threading.Event(), threading.Event()
    result: dict[str, int] = {}

    def block(cid: str) -> None:
        started.set()
        assert release.wait(timeout=30)

    first = threading.Thread(
        target=lambda: result.update(code=_batch(world, _Pipeline("moteur-A", on_run=block)))
    )
    first.start()
    try:
        assert started.wait(timeout=30)
        before = _run_json(world)
        assert _batch(world, _Pipeline("moteur-B")) == 2  # verrou pris : rien n'est purgé ni écrit
        assert "déjà utilisé" in capsys.readouterr().err
        assert _run_json(world) == before  # le run en cours n'a pas été touché
    finally:
        release.set()
        first.join(timeout=60)
    assert result["code"] == 0 and _run_json(world)["status"] == "complete"
    assert _engine_of(world, "devA") == "moteur-A"
    assert _batch(world, _Pipeline("moteur-B")) == 0  # verrou libéré en fin de lot


def test_le_verrou_est_libere_apres_un_lot_interrompu(world):
    assert _batch(world, _Pipeline("moteur-A", fail={"devA": KeyError("bogue")})) != 0
    assert _batch(world, _Pipeline("moteur-A")) == 0


def test_sigterm_est_converti_en_interruption_propre(world):
    import signal

    def protective(signum: int, frame: Any) -> None:  # le test ne doit jamais tuer pytest
        raise AssertionError("SIGTERM non converti par le lot")

    original = signal.signal(signal.SIGTERM, protective)

    def terminate(cid: str) -> None:
        if cid == "devB":
            os.kill(os.getpid(), signal.SIGTERM)

    try:
        code = _batch(world, _Pipeline("moteur-A", on_run=terminate))
        restored = signal.getsignal(signal.SIGTERM)
    finally:
        signal.signal(signal.SIGTERM, original)
    assert code != 0
    run = _run_json(world)
    assert run["status"] == "interrupted" and list(run["done"]) == ["devA"]
    assert "SIGTERM" in run["error"] and "AssertionError" not in run["error"]
    timings = json.loads((world.out / "timings.json").read_text(encoding="utf-8"))
    assert timings["status"] == "interrupted"
    assert restored is protective  # gestionnaire d'origine restauré en fin de lot
    assert _evaluate(world)[0] == 2


def test_un_dossier_nomme_comme_une_sortie_donne_une_erreur_claire_sans_rien_purger(world, capsys):
    assert _batch(world, _Pipeline("moteur-A")) == 0
    (world.out / "devB.json").unlink()
    (world.out / "devB.json").mkdir()  # un dossier à la place de la sortie de devB
    before = sorted(p.name for p in world.out.iterdir())
    assert _batch(world, _Pipeline("moteur-B")) == 2
    err = capsys.readouterr().err
    assert "devB.json" in err and "dossier" in err and "Traceback" not in err
    assert sorted(p.name for p in world.out.iterdir()) == before  # purge tout-ou-rien
