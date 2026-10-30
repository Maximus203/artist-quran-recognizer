"""Agent à modèles chauds : un service `aqr worker` garde le moteur chargé entre deux analyses.

Un faux service reproduit le protocole de `aqr.app.worker` (une ligne `{"event": "ready"}`, puis
une réponse JSON par requête `{"id", "argv"}`), piloté par le nom de l'audio : `crash`, `slow`,
`fail`, `noisy`.
"""

from __future__ import annotations

import json
import sys
import textwrap
import threading
import time
from pathlib import Path
from typing import ClassVar

import pytest

from aqr.app.engine_agent import (
    AgentConfig,
    SubprocessRunner,
    WarmRunner,
    build_runner,
    config_from_env,
    recognize_argv,
)

FAKE = textwrap.dedent(
    """
    import json, os, sys, time
    delay = float(os.environ.get("FAKE_READY_DELAY", "0"))
    time.sleep(delay)
    print(json.dumps({"event": "ready"}), flush=True)
    for line in sys.stdin:
        request = json.loads(line)
        argv = request["argv"]
        name = os.path.basename(argv[1])
        out_dir = argv[argv.index("--out-dir") + 1]
        if "crash" in name:
            os._exit(3)
        if "slow" in name:
            time.sleep(60)
        if "noisy" in name:
            sys.stderr.write("x" * 400_000 + "\\n")
            sys.stderr.flush()
        if "fail" in name:
            print(json.dumps({"id": request["id"], "code": 2, "stdout": "",
                              "stderr": "chargement\\nERREUR modele absent\\n"}), flush=True)
            continue
        stem = os.path.splitext(name)[0]
        with open(os.path.join(out_dir, stem + ".recognition.json"), "w") as f:
            json.dump({"pid": os.getpid(), "argv": argv}, f)
        print(json.dumps({"id": request["id"], "code": 0, "stdout": "", "stderr": ""}), flush=True)
    """
)


@pytest.fixture
def fake(tmp_path: Path) -> list[str]:
    script = tmp_path / "fake_worker.py"
    script.write_text(FAKE, encoding="utf-8")
    return [sys.executable, str(script)]


def runner(command: list[str], tmp_path: Path, **over: object) -> WarmRunner:
    return WarmRunner(
        python="python3",
        models_dir=tmp_path / "models",
        corpus_dir=tmp_path / "corpus",
        lock_path=tmp_path / "LOCK.json",
        worker_command=command,
        cwd=tmp_path,
        ready_timeout_s=10,
        idle_s=60,
        **over,  # type: ignore[arg-type]
    )


def analyse(r: WarmRunner, tmp_path: Path, name: str, cancel: threading.Event | None = None):
    out = tmp_path / f"out-{name}-{time.monotonic_ns()}"
    out.mkdir()
    audio = tmp_path / f"{name}.mp3"
    audio.write_bytes(b"x")
    outcome = r.run(audio, out, "cascade", cancel or threading.Event())
    result = out / f"{name}.recognition.json"
    return outcome, (json.loads(result.read_text()) if result.exists() else None)


def test_le_meme_service_sert_deux_analyses_de_suite(fake: list[str], tmp_path: Path) -> None:
    r = runner(fake, tmp_path)
    try:
        one, first = analyse(r, tmp_path, "un")
        two, second = analyse(r, tmp_path, "deux")
        assert one.code == 0 and two.code == 0
        assert first is not None and second is not None
        assert first["pid"] == second["pid"]  # les modèles ne sont chargés qu'une fois
    finally:
        r.close()


def test_la_requete_est_celle_de_la_ligne_de_commande_habituelle(
    fake: list[str], tmp_path: Path
) -> None:
    r = runner(fake, tmp_path)
    try:
        _, result = analyse(r, tmp_path, "un")
        assert result is not None
        audio = tmp_path / "un.mp3"
        expected = recognize_argv(
            audio,
            Path(result["argv"][result["argv"].index("--out-dir") + 1]),
            "cascade",
            models_dir=tmp_path / "models",
            corpus_dir=tmp_path / "corpus",
            lock_path=tmp_path / "LOCK.json",
        )
        assert result["argv"] == expected
        # Même ligne que le processus à la demande, sans « python -m aqr.cli ».
        assert SubprocessRunner(
            python="python3",
            models_dir=tmp_path / "models",
            corpus_dir=tmp_path / "corpus",
            lock_path=tmp_path / "LOCK.json",
        ).argv(audio, tmp_path, "cascade")[3:] == recognize_argv(
            audio,
            tmp_path,
            "cascade",
            models_dir=tmp_path / "models",
            corpus_dir=tmp_path / "corpus",
            lock_path=tmp_path / "LOCK.json",
        )
    finally:
        r.close()


def test_un_echec_du_moteur_remonte_son_message_et_le_service_reste_en_vie(
    fake: list[str], tmp_path: Path
) -> None:
    r = runner(fake, tmp_path)
    try:
        ok, first = analyse(r, tmp_path, "avant")
        bad, _ = analyse(r, tmp_path, "fail")
        after, third = analyse(r, tmp_path, "apres")
        assert bad.code == 2 and "ERREUR modele absent" in bad.stderr_tail
        assert ok.code == after.code == 0
        assert first is not None and third is not None
        assert first["pid"] == third["pid"]  # pas de rechargement après une erreur normale
    finally:
        r.close()


def test_le_service_qui_tombe_en_pleine_analyse_est_signale_puis_relance(
    fake: list[str], tmp_path: Path
) -> None:
    r = runner(fake, tmp_path)
    try:
        _, first = analyse(r, tmp_path, "avant")
        crashed, _ = analyse(r, tmp_path, "crash")
        assert crashed.code == 1
        assert "arrêté" in crashed.stderr_tail
        _, again = analyse(r, tmp_path, "apres")
        assert first is not None and again is not None
        assert first["pid"] != again["pid"]  # un nouveau service a été lancé
    finally:
        r.close()


def test_annuler_tue_le_service_sans_rien_deposer_et_le_suivant_repart_propre(
    fake: list[str], tmp_path: Path
) -> None:
    r = runner(fake, tmp_path)
    cancel = threading.Event()
    threading.Timer(0.8, cancel.set).start()
    try:
        started = time.monotonic()
        outcome, result = analyse(r, tmp_path, "slow", cancel)
        assert outcome.code is None and result is None
        assert time.monotonic() - started < 10  # pas 60 s : le service est arrêté
        _, again = analyse(r, tmp_path, "apres")
        assert again is not None
    finally:
        r.close()


def test_la_sortie_d_erreur_bruyante_du_service_ne_le_bloque_pas(
    fake: list[str], tmp_path: Path
) -> None:
    r = runner(fake, tmp_path)
    try:
        outcome, result = analyse(r, tmp_path, "noisy")
        assert (
            outcome.code == 0 and result is not None
        )  # 400 Ko d'erreurs lus, pas de blocage du tube
    finally:
        r.close()


def test_un_service_qui_ne_dit_jamais_ready_est_signale(
    fake: list[str], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FAKE_READY_DELAY", "30")
    r = WarmRunner(
        python="python3",
        models_dir=None,
        corpus_dir=None,
        lock_path=None,
        worker_command=fake,
        cwd=tmp_path,
        ready_timeout_s=1.0,
        idle_s=60,
    )
    try:
        outcome, result = analyse(r, tmp_path, "un")
        assert outcome.code == 1 and "ne démarre pas" in outcome.stderr_tail
        assert result is None
    finally:
        r.close()


def test_le_service_inactif_est_arrete_pour_rendre_la_memoire(
    fake: list[str], tmp_path: Path
) -> None:
    r = WarmRunner(
        python="python3",
        models_dir=None,
        corpus_dir=None,
        lock_path=None,
        worker_command=fake,
        cwd=tmp_path,
        ready_timeout_s=10,
        idle_s=0.6,
    )
    try:
        _, first = analyse(r, tmp_path, "un")
        assert r.running
        deadline = time.monotonic() + 8
        while r.running and time.monotonic() < deadline:
            time.sleep(0.2)
        assert not r.running  # arrêté : modèles déchargés de la mémoire
        _, again = analyse(r, tmp_path, "deux")  # le suivant le relance tout seul
        assert first is not None and again is not None
        assert first["pid"] != again["pid"]
    finally:
        r.close()


def test_close_arrete_le_service(fake: list[str], tmp_path: Path) -> None:
    r = runner(fake, tmp_path)
    analyse(r, tmp_path, "un")
    assert r.running
    r.close()
    assert not r.running
    r.close()  # idempotent


class TestConfiguration:
    ENV: ClassVar[dict[str, str]] = {
        "AQR_ENGINE_URL": "https://atelier.example",
        "AQR_ENGINE_TOKEN": "qea_" + "A" * 43,
    }

    def test_modeles_chauds_par_defaut_avec_arret_apres_inactivite(self) -> None:
        config = config_from_env(self.ENV)
        assert config.warm is True and config.warm_idle_s == 600
        assert isinstance(build_runner(config), WarmRunner)

    @pytest.mark.parametrize("value", ["0", "false", "off", "non"])
    def test_peut_etre_desactive(self, value: str) -> None:
        config = config_from_env({**self.ENV, "AQR_ENGINE_WARM": value})
        assert config.warm is False
        assert isinstance(build_runner(config), SubprocessRunner)

    @pytest.mark.parametrize(
        ("value", "expected"), [("120", 120), ("5", 600), ("999999", 600), ("abc", 600)]
    )
    def test_delai_d_inactivite_borne(self, value: str, expected: int) -> None:
        assert (
            config_from_env({**self.ENV, "AQR_ENGINE_WARM_IDLE_S": value}).warm_idle_s == expected
        )


def test_la_configuration_ne_montre_jamais_le_jeton() -> None:
    config = AgentConfig(
        url="https://a.example", token="qea_" + "B" * 43, work_dir=Path("."), models_dir=None
    )
    assert "BBBB" not in repr(config)
