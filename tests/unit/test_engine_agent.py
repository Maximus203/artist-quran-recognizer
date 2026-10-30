"""Agent du moteur à distance (ADR-0017, phase 2) : il appelle l'atelier, jamais l'inverse.

Un faux atelier HTTP (thread) reproduit le contrat des routes `/api/engine/*`
(`web/lib/engine-broker.ts`) :
réclamation (200 avec le bail, 204 sans analyse), audio, signal de vie, résultat, échec.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
from collections.abc import Callable, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from aqr.app.engine_agent import (
    AgentConfig,
    AgentRevoked,
    ConfigError,
    EngineAgent,
    RunOutcome,
    SubprocessRunner,
    backoff_seconds,
    config_from_env,
)

TOKEN = "qea_" + "A" * 43
AUDIO = b"RIFF....fake audio bytes" * 50
SHA = hashlib.sha256(AUDIO).hexdigest()
LEASE = "ab" * 16
RESULT = json.dumps({"schema": "aqr.recognition/1", "source": {"sha256": SHA}}).encode()


class FakeAtelier:
    """État partagé du faux atelier : ce qu'on lui offre, ce qu'il a reçu."""

    def __init__(self) -> None:
        self.job: dict | None = None
        self.audio = AUDIO
        self.calls: list[tuple[str, str]] = []
        self.heartbeat_replies: list[tuple[int, dict]] = []
        self.result: bytes | None = None
        self.failure: str | None = None
        self.claim_status = 200
        self.auth_seen: set[str | None] = set()


@pytest.fixture
def atelier() -> Iterator[tuple[FakeAtelier, str]]:
    state = FakeAtelier()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args: object) -> None:
            return

        def _reply(self, status: int, body: bytes = b"", ctype: str = "application/json") -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _read(self) -> bytes:
            return self.rfile.read(int(self.headers.get("Content-Length") or 0))

        def _route(self) -> None:
            state.calls.append((self.command, self.path.split("?")[0]))
            state.auth_seen.add(self.headers.get("Authorization"))
            if self.headers.get("Authorization") != f"Bearer {TOKEN}":
                return self._reply(401, b'{"error":"non"}')
            path = self.path.split("?")[0]
            if path == "/api/engine/claim":
                if state.claim_status != 200:
                    return self._reply(state.claim_status, b"{}")
                if state.job is None:
                    return self._reply(204)
                return self._reply(200, json.dumps(state.job).encode())
            if path.endswith("/audio"):
                return self._reply(200, state.audio, "application/octet-stream")
            if path.endswith("/heartbeat"):
                status, body = (
                    state.heartbeat_replies.pop(0)
                    if state.heartbeat_replies
                    else (200, {"cancel": False})
                )
                return self._reply(status, json.dumps(body).encode())
            if path.endswith("/result"):
                state.result = self._read()
                return self._reply(200, b'{"ok":true}')
            if path.endswith("/fail"):
                state.failure = json.loads(self._read())["message"]
                return self._reply(200, b'{"ok":true}')
            return self._reply(404, b"{}")

        do_GET = do_POST = do_PUT = _route

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield state, f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def job(**over: object) -> dict:
    base = {
        "lease": LEASE,
        "session": "s1",
        "asr": "cascade",
        "audio": {"path": f"/api/engine/leases/{LEASE}/audio", "sha256": SHA, "size": len(AUDIO)},
        "lease_s": 3,
    }
    return {**base, **over}


class StubRunner:
    """Remplace `aqr recognize` : écrit (ou non) le résultat, comme le vrai le ferait."""

    def __init__(
        self,
        write: bytes | None = RESULT,
        code: int = 0,
        stderr: str = "",
        wait_cancel: bool = False,
    ) -> None:
        self.write, self.code, self.stderr, self.wait_cancel = write, code, stderr, wait_cancel
        self.runs: list[tuple[Path, Path, str]] = []
        self.audio_seen: bytes | None = None
        self.cancelled = False

    def run(self, audio: Path, out_dir: Path, asr: str, cancel: threading.Event) -> RunOutcome:
        self.runs.append((audio, out_dir, asr))
        self.audio_seen = audio.read_bytes()
        if self.wait_cancel:
            self.cancelled = cancel.wait(10)
            return RunOutcome(code=None, stderr_tail="")
        if self.write is not None:
            (out_dir / f"{audio.stem}.recognition.json").write_bytes(self.write)
        return RunOutcome(code=self.code, stderr_tail=self.stderr)


def agent_for(url: str, runner: StubRunner, tmp_path: Path, **over: object) -> EngineAgent:
    config = AgentConfig(
        url=url,
        token=TOKEN,
        work_dir=tmp_path / "work",
        wait_s=1,
        models_dir=None,
        **over,  # type: ignore[arg-type]
    )
    return EngineAgent(config, runner)


class TestUneAnalyse:
    def test_chemin_nominal_telecharge_analyse_depose_et_nettoie(
        self, atelier: tuple[FakeAtelier, str], tmp_path: Path
    ) -> None:
        state, url = atelier
        state.job = job()
        runner = StubRunner()
        assert agent_for(url, runner, tmp_path).run_once() is True
        assert runner.audio_seen == AUDIO  # l'audio téléchargé est celui de l'atelier
        assert runner.runs[0][2] == "cascade"
        assert state.result == RESULT
        assert state.failure is None
        # Vie privée : aucun audio ni résultat ne reste sur la machine de l'agent.
        assert list((tmp_path / "work").iterdir()) == []

    def test_aucune_analyse_en_attente_ne_lance_rien(
        self, atelier: tuple[FakeAtelier, str], tmp_path: Path
    ) -> None:
        state, url = atelier
        runner = StubRunner()
        assert agent_for(url, runner, tmp_path).run_once() is False
        assert runner.runs == []
        assert [c[1] for c in state.calls] == ["/api/engine/claim"]

    def test_chaque_requete_porte_le_jeton_d_agent(
        self, atelier: tuple[FakeAtelier, str], tmp_path: Path
    ) -> None:
        state, url = atelier
        state.job = job()
        agent_for(url, StubRunner(), tmp_path).run_once()
        assert state.auth_seen == {f"Bearer {TOKEN}"}


class TestRefusDeTravailDouteux:
    def test_audio_alteré_est_signale_et_jamais_analyse(
        self, atelier: tuple[FakeAtelier, str], tmp_path: Path
    ) -> None:
        state, url = atelier
        state.job = job()
        state.audio = AUDIO[:-1] + b"X"  # même taille, autre contenu
        runner = StubRunner()
        agent_for(url, runner, tmp_path).run_once()
        assert runner.runs == []
        assert state.result is None
        assert state.failure is not None and "empreinte" in state.failure.lower()
        assert list((tmp_path / "work").iterdir()) == []

    def test_audio_tronque_est_signale(
        self, atelier: tuple[FakeAtelier, str], tmp_path: Path
    ) -> None:
        state, url = atelier
        state.job = job()
        state.audio = AUDIO[:10]
        runner = StubRunner()
        agent_for(url, runner, tmp_path).run_once()
        assert runner.runs == [] and state.failure is not None

    @pytest.mark.parametrize("asr", ["--force", "cascade; rm -rf /", "../x", "", "gpt"])
    def test_moteur_inconnu_jamais_passe_a_la_ligne_de_commande(
        self, atelier: tuple[FakeAtelier, str], tmp_path: Path, asr: str
    ) -> None:
        state, url = atelier
        state.job = job(asr=asr)
        runner = StubRunner()
        agent_for(url, runner, tmp_path).run_once()
        assert runner.runs == []
        assert state.failure is not None

    def test_chemin_d_audio_hors_du_bail_est_refuse(
        self, atelier: tuple[FakeAtelier, str], tmp_path: Path
    ) -> None:
        state, url = atelier
        bad = job()
        bad["audio"]["path"] = "https://evil.example/steal"
        state.job = bad
        runner = StubRunner()
        agent_for(url, runner, tmp_path).run_once()
        assert runner.runs == []
        assert all(c[1].startswith("/api/engine/") for c in state.calls)  # jamais ailleurs

    def test_taille_declaree_demesuree_est_refusee_sans_telechargement(
        self, atelier: tuple[FakeAtelier, str], tmp_path: Path
    ) -> None:
        state, url = atelier
        huge = job()
        huge["audio"]["size"] = 10**12
        state.job = huge
        runner = StubRunner()
        agent_for(url, runner, tmp_path).run_once()
        assert runner.runs == [] and state.failure is not None
        assert not any(c[1].endswith("/audio") for c in state.calls)


class TestEchecsDuMoteur:
    def test_code_de_sortie_non_nul_remonte_la_derniere_ligne(
        self, atelier: tuple[FakeAtelier, str], tmp_path: Path
    ) -> None:
        state, url = atelier
        state.job = job()
        runner = StubRunner(
            write=None, code=2, stderr="chargement\nERREUR modèle absent : fastconformer\n\n"
        )
        agent_for(url, runner, tmp_path).run_once()
        assert state.failure == "ERREUR modèle absent : fastconformer"
        assert state.result is None

    def test_message_d_echec_borne_et_sur_une_ligne(
        self, atelier: tuple[FakeAtelier, str], tmp_path: Path
    ) -> None:
        state, url = atelier
        state.job = job()
        runner = StubRunner(write=None, code=1, stderr="x" * 5000)
        agent_for(url, runner, tmp_path).run_once()
        assert state.failure is not None
        assert len(state.failure) <= 300 and "\n" not in state.failure

    def test_succes_sans_fichier_de_resultat_est_un_echec(
        self, atelier: tuple[FakeAtelier, str], tmp_path: Path
    ) -> None:
        state, url = atelier
        state.job = job()
        agent_for(url, StubRunner(write=None, code=0), tmp_path).run_once()
        assert state.result is None and state.failure is not None


class TestAnnulationEtBailPerdu:
    def test_annulation_signalee_au_signal_de_vie_arrete_le_moteur_sans_rien_deposer(
        self, atelier: tuple[FakeAtelier, str], tmp_path: Path
    ) -> None:
        state, url = atelier
        state.job = job(lease_s=3)  # signal de vie toutes les secondes
        state.heartbeat_replies = [(200, {"cancel": True})]
        runner = StubRunner(wait_cancel=True)
        agent_for(url, runner, tmp_path).run_once()
        assert runner.cancelled is True
        assert state.result is None and state.failure is None  # l'atelier le sait déjà
        assert list((tmp_path / "work").iterdir()) == []

    def test_bail_inconnu_au_signal_de_vie_abandonne_en_silence(
        self, atelier: tuple[FakeAtelier, str], tmp_path: Path
    ) -> None:
        state, url = atelier
        state.job = job(lease_s=3)
        state.heartbeat_replies = [(404, {"error": "Bail inconnu ou expiré"})]
        runner = StubRunner(wait_cancel=True)
        agent_for(url, runner, tmp_path).run_once()
        assert runner.cancelled is True
        assert state.result is None and state.failure is None


class TestJetonEtReseau:
    def test_jeton_revoque_arrete_l_agent_avec_un_message_clair(
        self, atelier: tuple[FakeAtelier, str], tmp_path: Path
    ) -> None:
        _, url = atelier
        config = AgentConfig(
            url=url, token="qea_" + "B" * 43, work_dir=tmp_path / "w", wait_s=1, models_dir=None
        )
        with pytest.raises(AgentRevoked):
            EngineAgent(config, StubRunner()).run_once()

    def test_erreur_serveur_remonte_comme_indisponibilite_temporaire(
        self, atelier: tuple[FakeAtelier, str], tmp_path: Path
    ) -> None:
        state, url = atelier
        state.claim_status = 503
        with pytest.raises(ConnectionError):
            agent_for(url, StubRunner(), tmp_path).run_once()

    def test_boucle_se_repose_apres_une_panne_puis_reprend(
        self, atelier: tuple[FakeAtelier, str], tmp_path: Path
    ) -> None:
        state, url = atelier
        state.claim_status = 503
        stop = threading.Event()
        sleeps: list[float] = []

        def sleeper(seconds: float) -> None:
            sleeps.append(seconds)
            state.claim_status = 200  # l'atelier revient
            state.job = job()
            if len(sleeps) >= 1 and state.result is not None:
                stop.set()

        runner = StubRunner()
        agent = agent_for(url, runner, tmp_path)
        threading.Timer(5, stop.set).start()
        agent.run_forever(stop, sleep=sleeper, max_iterations=3)
        assert sleeps and sleeps[0] >= 0.5
        assert state.result == RESULT

    def test_le_jeton_n_apparait_jamais_dans_les_journaux(
        self, atelier: tuple[FakeAtelier, str], tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        state, url = atelier
        state.job = job()
        with caplog.at_level(logging.DEBUG):
            agent_for(url, StubRunner(), tmp_path).run_once()
        assert caplog.records
        assert TOKEN not in caplog.text and TOKEN[4:] not in caplog.text

    def test_les_redirections_ne_sont_jamais_suivies(self, tmp_path: Path) -> None:
        # Un atelier (ou un intermédiaire) qui redirige ne doit pas recevoir le jeton ailleurs.
        hits: list[str | None] = []

        class Evil(BaseHTTPRequestHandler):
            def log_message(self, *a: object) -> None:
                return

            def do_POST(self) -> None:
                hits.append(self.headers.get("Authorization"))
                self.send_response(200)
                self.send_header("Content-Length", "0")
                self.end_headers()

        target = ThreadingHTTPServer(("127.0.0.1", 0), Evil)
        threading.Thread(target=target.serve_forever, daemon=True).start()

        class Redirect(BaseHTTPRequestHandler):
            def log_message(self, *a: object) -> None:
                return

            def do_POST(self) -> None:
                self.send_response(307)
                self.send_header("Location", f"http://127.0.0.1:{target.server_address[1]}/vol")
                self.send_header("Content-Length", "0")
                self.end_headers()

        origin = ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
        threading.Thread(target=origin.serve_forever, daemon=True).start()
        try:
            agent = agent_for(
                f"http://127.0.0.1:{origin.server_address[1]}", StubRunner(), tmp_path
            )
            with pytest.raises(ConnectionError):
                agent.run_once()
            assert hits == []
        finally:
            origin.shutdown()
            target.shutdown()


class TestRepos:
    def test_attente_croissante_bornee_et_jamais_nulle(self) -> None:
        waits = [backoff_seconds(n, jitter=lambda: 1.0) for n in range(12)]
        assert waits[0] >= 1
        assert waits == sorted(waits)
        assert max(waits) <= 60
        # Avec un aléa minimal, jamais sous la moitié (pas de rafale d'agents synchronisés).
        assert all(backoff_seconds(n, jitter=lambda: 0.0) >= 0.5 for n in range(12))


class TestConfiguration:
    def env(self, **over: str) -> dict[str, str]:
        base = {"AQR_ENGINE_URL": "https://atelier.example", "AQR_ENGINE_TOKEN": TOKEN}
        return {**base, **over}

    def test_valeurs_valides(self, tmp_path: Path) -> None:
        config = config_from_env(
            self.env(AQR_ENGINE_WORK_DIR=str(tmp_path), AQR_MODELS_DIR=str(tmp_path / "m"))
        )
        assert config.url == "https://atelier.example"
        assert config.work_dir == tmp_path
        assert config.models_dir == tmp_path / "m"

    def test_jeton_lu_dans_un_fichier(self, tmp_path: Path) -> None:
        file = tmp_path / "token"
        file.write_text(TOKEN + "\n", encoding="utf-8")
        env = {"AQR_ENGINE_URL": "https://atelier.example", "AQR_ENGINE_TOKEN_FILE": str(file)}
        assert config_from_env(env).token == TOKEN

    @pytest.mark.parametrize(
        "env",
        [
            {},
            {"AQR_ENGINE_URL": "https://a.example"},  # pas de jeton
            {
                "AQR_ENGINE_URL": "http://atelier.example",
                "AQR_ENGINE_TOKEN": TOKEN,
            },  # clair, hors boucle locale
            {"AQR_ENGINE_URL": "https://a.example/chemin", "AQR_ENGINE_TOKEN": TOKEN},
            {
                "AQR_ENGINE_URL": "https://a.example",
                "AQR_ENGINE_TOKEN": "qtr_" + "A" * 43,
            },  # jeton d'utilisateur
            {"AQR_ENGINE_URL": "https://a.example", "AQR_ENGINE_TOKEN": "qea_court"},
        ],
    )
    def test_configuration_invalide_refusee_avec_un_message(self, env: dict[str, str]) -> None:
        with pytest.raises(ConfigError):
            config_from_env(env)

    def test_http_clair_accepte_seulement_sur_la_boucle_locale(self) -> None:
        env = {"AQR_ENGINE_URL": "http://127.0.0.1:3000", "AQR_ENGINE_TOKEN": TOKEN}
        assert config_from_env(env).url == "http://127.0.0.1:3000"

    def test_le_jeton_n_est_jamais_dans_la_representation_de_la_configuration(self) -> None:
        config = config_from_env(self.env())
        assert TOKEN not in repr(config) and TOKEN not in str(config)


class TestLigneDeCommande:
    def test_meme_commande_que_l_atelier(self, tmp_path: Path) -> None:
        runner = SubprocessRunner(
            python="python3",
            models_dir=tmp_path / "models",
            corpus_dir=tmp_path / "corpus",
            lock_path=tmp_path / "LOCK.json",
        )
        argv = runner.argv(tmp_path / "source.mp3", tmp_path / "out", "cascade")
        assert argv[:5] == ["python3", "-m", "aqr.cli", "recognize", str(tmp_path / "source.mp3")]
        pairs = dict(zip(argv[5::2], argv[6::2], strict=False))
        assert pairs["--out-dir"] == str(tmp_path / "out")
        assert pairs["--asr"] == "cascade"
        assert pairs["--format"] == "json"
        assert pairs["--models-dir"] == str(tmp_path / "models")
        assert pairs["--corpus-dir"] == str(tmp_path / "corpus")
        assert pairs["--lock"] == str(tmp_path / "LOCK.json")


def test_tache_en_cours_ne_depend_pas_d_une_horloge_globale() -> None:
    # Garde-fou : `run_forever` reçoit son sommeil (testable), pas de time.sleep en dur.
    sig = EngineAgent.run_forever.__code__.co_varnames
    assert "sleep" in sig
    _: Callable[..., object] = EngineAgent.run_forever
