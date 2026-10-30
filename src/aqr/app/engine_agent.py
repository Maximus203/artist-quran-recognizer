"""Agent du moteur à distance (ADR-0017, phase 2) : il APPELLE l'atelier, jamais l'inverse.

Boucle : réclamer une analyse (long polling) -> télécharger l'audio -> lancer `aqr recognize` ->
déposer `source.recognition.json` ; pendant ce temps, un signal de vie prolonge le bail et apprend
l'annulation.
Aucune connexion entrante : l'agent tourne derrière une box, sur Atlas ou sur un poste GPU.

Garde-fous : seul le jeton d'agent (`qea_…`) est utilisé, jamais journalisé ; les redirections ne
sont pas suivies (le jeton ne part nulle part ailleurs) ; le moteur et l'audio annoncés par
l'atelier sont vérifiés avant tout lancement ; l'audio et le résultat sont supprimés du disque
local à la fin de chaque analyse.
"""

from __future__ import annotations

import hashlib
import json
import logging
import random
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse

from aqr.pipeline.factory import ASR_CHOICES

LOGGER = logging.getLogger("aqr.engine_agent")
_TOKEN_RE = re.compile(r"^qea_[A-Za-z0-9_-]{43}$")
_LEASE_RE = re.compile(r"^[0-9a-f]{32}$")
_SHA_RE = re.compile(r"^[0-9a-f]{64}$")
_LOOPBACK = ("127.0.0.1", "localhost", "[::1]", "::1")
MAX_AUDIO_BYTES = 2_500_000_000  # un peu au-dessus de la vidéo de 2 Gio acceptée par l'atelier
MAX_RESULT_BYTES = 50 * 1024 * 1024  # même plafond que le courtier
MAX_WAIT_S = 25  # plafond du long polling côté atelier
MAX_MESSAGE = 300  # un message d'échec tient sur une ligne bornée
AUDIO_NAME = "source.bin"
RESULT_NAME = "source.recognition.json"
REPO_ROOT = Path(__file__).resolve().parents[3]


class ConfigError(ValueError):
    """Configuration de l'agent absente ou invalide (message destiné à celui qui l'installe)."""


class AgentRevoked(RuntimeError):
    """L'atelier refuse le jeton (révoqué ou jamais valide) : l'agent s'arrête, sans réessayer."""


@dataclass(frozen=True)
class AgentConfig:
    url: str
    token: str = field(repr=False)
    work_dir: Path
    models_dir: Path | None
    wait_s: int = 20
    corpus_dir: Path | None = None
    lock_path: Path | None = None
    python: str = sys.executable


def _is_loopback(host: str) -> bool:
    return host in _LOOPBACK


def config_from_env(env: Mapping[str, str]) -> AgentConfig:
    """Configuration de l'environnement ; jeton dans `AQR_ENGINE_TOKEN` ou un fichier."""
    raw_url = env.get("AQR_ENGINE_URL", "").strip()
    if not raw_url:
        raise ConfigError("AQR_ENGINE_URL manquant : adresse de l'atelier (https://…).")
    parsed = urlparse(raw_url)
    host = parsed.hostname or ""
    if parsed.scheme not in ("https", "http") or not host:
        raise ConfigError("AQR_ENGINE_URL doit être une adresse http(s) valide.")
    if parsed.scheme == "http" and not _is_loopback(host):
        raise ConfigError(
            "AQR_ENGINE_URL doit être en https (http n'est accepté que sur la boucle locale)."
        )
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment or parsed.username:
        raise ConfigError("AQR_ENGINE_URL : ni chemin, ni requête, ni identifiants.")
    token = env.get("AQR_ENGINE_TOKEN", "").strip()
    token_file = env.get("AQR_ENGINE_TOKEN_FILE", "").strip()
    if not token and token_file:
        try:
            token = Path(token_file).read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise ConfigError(f"AQR_ENGINE_TOKEN_FILE illisible : {exc.strerror or exc}") from exc
    if not token:
        raise ConfigError("Jeton d'agent manquant : AQR_ENGINE_TOKEN ou AQR_ENGINE_TOKEN_FILE.")
    if not _TOKEN_RE.match(token):
        raise ConfigError(
            "Ce n'est pas un jeton d'agent (qea_…) : un jeton d'utilisateur ne convient pas."
        )
    try:
        wait = int(env.get("AQR_ENGINE_WAIT_S", "20"))
    except ValueError as exc:
        raise ConfigError("AQR_ENGINE_WAIT_S doit être un nombre de secondes.") from exc

    def path(name: str) -> Path | None:
        value = env.get(name, "").strip()
        return Path(value) if value else None

    return AgentConfig(
        url=f"{parsed.scheme}://{parsed.netloc}",
        token=token,
        work_dir=path("AQR_ENGINE_WORK_DIR") or Path(tempfile.gettempdir()) / "aqr-engine-agent",
        models_dir=path("AQR_MODELS_DIR"),
        wait_s=max(0, min(MAX_WAIT_S, wait)),
        corpus_dir=path("AQR_CORPUS_DIR"),
        lock_path=path("AQR_LOCK_PATH"),
    )


def backoff_seconds(attempt: int, jitter: Callable[[], float] = random.random) -> float:
    """Attente avant de réessayer après une panne : exponentielle, bornée à 60 s, avec un aléa
    (entre la moitié et la totalité) pour que plusieurs agents ne frappent pas ensemble."""
    base = min(60.0, float(2 ** max(0, attempt)))
    return base * (0.5 + 0.5 * jitter())


def _log(level: int, event: str, **fields: object) -> None:
    """Journal unique de l'agent : `événement {json}`. Jamais le jeton, jamais l'audio."""
    LOGGER.log(level, "%s %s", event, json.dumps(fields, ensure_ascii=False, sort_keys=True))


def _one_line(text: str) -> str:
    lines = [ln.strip() for ln in text.replace("\r", "\n").split("\n") if ln.strip()]
    last = lines[-1] if lines else "échec sans message"
    clean = "".join(ch for ch in last if ch.isprintable())
    return clean[:MAX_MESSAGE]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


@dataclass(frozen=True)
class RunOutcome:
    """Fin d'un lancement du moteur : code de sortie (None si interrompu) et fin de stderr."""

    code: int | None
    stderr_tail: str


class Runner(Protocol):
    def run(self, audio: Path, out_dir: Path, asr: str, cancel: threading.Event) -> RunOutcome: ...


@dataclass(frozen=True)
class SubprocessRunner:
    """Lance `python -m aqr.cli recognize`, comme l'atelier (web/lib/python.ts)."""

    python: str = sys.executable
    models_dir: Path | None = None
    corpus_dir: Path | None = None
    lock_path: Path | None = None
    cwd: Path = REPO_ROOT

    def argv(self, audio: Path, out_dir: Path, asr: str) -> list[str]:
        argv = [self.python, "-m", "aqr.cli", "recognize", str(audio)]
        argv += ["--out-dir", str(out_dir), "--asr", asr, "--format", "json"]
        if self.models_dir is not None:
            argv += ["--models-dir", str(self.models_dir)]
        if self.corpus_dir is not None:
            argv += ["--corpus-dir", str(self.corpus_dir)]
        if self.lock_path is not None:
            argv += ["--lock", str(self.lock_path)]
        return argv

    def run(self, audio: Path, out_dir: Path, asr: str, cancel: threading.Event) -> RunOutcome:
        proc = subprocess.Popen(
            self.argv(audio, out_dir, asr),
            cwd=self.cwd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            errors="replace",
        )
        tail: list[str] = []

        def pump() -> None:
            assert proc.stderr is not None
            for line in proc.stderr:
                tail.append(line)
                del tail[:-200]

        reader = threading.Thread(target=pump, daemon=True)
        reader.start()
        cancelled = False
        while proc.poll() is None:
            if cancel.wait(0.5):
                cancelled = True
                proc.terminate()
                try:
                    proc.wait(10)
                except subprocess.TimeoutExpired:
                    proc.kill()
                break
        proc.wait()
        reader.join(2)
        return RunOutcome(code=None if cancelled else proc.returncode, stderr_tail="".join(tail))


class EngineAgent:
    def __init__(self, config: AgentConfig, runner: Runner) -> None:
        self._config = config
        self._runner = runner
        self._opener = urllib.request.build_opener(_NoRedirect)

    # ---- HTTP ----------------------------------------------------------------------------------

    def _request(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        *,
        timeout: float = 30.0,
        ctype: str | None = None,
    ) -> tuple[int, Any]:
        """Appel à l'atelier : (statut, réponse). 4xx rendus, le reste lève ConnectionError."""
        request = urllib.request.Request(
            self._config.url + path,
            data=body,
            method=method,
            headers={
                "Authorization": f"Bearer {self._config.token}",
                "User-Agent": "aqr-engine-agent/1",
                **({"Content-Type": ctype} if ctype else {}),
            },
        )
        try:
            response = self._opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403) and path.startswith("/api/engine/claim"):
                raise AgentRevoked(
                    "L'atelier a refusé le jeton de l'agent (révoqué ou invalide)."
                ) from exc
            if 400 <= exc.code < 500:
                return exc.code, exc
            reason = (
                "redirection refusée" if 300 <= exc.code < 400 else f"erreur serveur {exc.code}"
            )
            raise ConnectionError(f"{method} {path.split('?')[0]} : {reason}") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise ConnectionError(
                f"{method} {path.split('?')[0]} : atelier injoignable ({exc})"
            ) from exc
        return response.status, response

    def _json(self, response: Any) -> Any:
        with response:
            raw = response.read(1_000_000)
        return json.loads(raw) if raw else None

    def _claim(self) -> dict[str, Any] | None:
        status, response = self._request(
            "POST",
            f"/api/engine/claim?wait={self._config.wait_s}",
            b"",
            timeout=self._config.wait_s + 15,
        )
        if status == 204:
            response.close()
            return None
        if status == 200:
            data = self._json(response)
            return data if isinstance(data, dict) else None
        response.close()
        raise ConnectionError(f"réclamation : réponse inattendue ({status})")

    def _fail(self, lease: str, message: str) -> None:
        """Signale l'échec (au mieux : atelier injoignable, le bail expirera de lui-même)."""
        try:
            status, response = self._request(
                "POST",
                f"/api/engine/leases/{lease}/fail",
                json.dumps({"message": _one_line(message)}).encode(),
                ctype="application/json",
            )
            response.close()
            _log(logging.WARNING, "echec_signale", lease=lease[:8], statut=status)
        except (ConnectionError, AgentRevoked):
            _log(logging.WARNING, "echec_non_signale", lease=lease[:8])

    # ---- Une analyse ---------------------------------------------------------------------------

    @staticmethod
    def _validated(job: dict[str, Any]) -> tuple[str, str, str, int, str]:
        """(bail, moteur, chemin, taille, empreinte) ; ValueError si l'annonce est inattendue."""
        lease = str(job.get("lease", ""))
        if not _LEASE_RE.match(lease):
            raise ValueError("numéro de bail invalide")
        audio = job.get("audio") or {}
        asr = job.get("asr")
        if asr not in ASR_CHOICES:
            raise ValueError("moteur de reconnaissance inconnu de l'agent")
        path = audio.get("path")
        if path != f"/api/engine/leases/{lease}/audio":
            raise ValueError("chemin de l'audio hors du bail")
        size = audio.get("size")
        if not isinstance(size, int) or isinstance(size, bool) or not 0 < size <= MAX_AUDIO_BYTES:
            raise ValueError("taille de l'audio hors limites")
        sha = audio.get("sha256")
        if not isinstance(sha, str) or not _SHA_RE.match(sha):
            raise ValueError("empreinte de l'audio absente")
        return lease, str(asr), path, size, sha

    def _download(self, path: str, dest: Path, size: int, sha: str) -> None:
        status, response = self._request("GET", path, timeout=60.0)
        if status != 200:
            response.close()
            raise ValueError(f"audio indisponible ({status})")
        digest, total = hashlib.sha256(), 0
        with response, dest.open("wb") as out:
            while chunk := response.read(1 << 20):
                total += len(chunk)
                if total > size:
                    raise ValueError("audio plus grand que la taille annoncée")
                digest.update(chunk)
                out.write(chunk)
        if total != size:
            raise ValueError("audio incomplet : taille reçue différente de la taille annoncée")
        if digest.hexdigest() != sha:
            raise ValueError(
                "Empreinte de l'audio reçue différente de celle annoncée par l'atelier."
            )

    def _heartbeat_loop(
        self,
        lease: str,
        interval: float,
        done: threading.Event,
        cancel: threading.Event,
        lost: threading.Event,
    ) -> None:
        while not done.wait(interval):
            try:
                status, response = self._request(
                    "POST", f"/api/engine/leases/{lease}/heartbeat", b"", timeout=15
                )
            except ConnectionError:
                continue  # panne passagère : le prochain signal réessaiera, le bail a de la marge
            except AgentRevoked:
                lost.set()
                cancel.set()
                return
            if status == 404:
                response.close()
                lost.set()
                cancel.set()
                return
            if status == 200 and self._json(response).get("cancel"):
                cancel.set()
                return
            if status != 200:
                response.close()

    def _process(self, job: dict[str, Any]) -> None:
        try:
            lease, asr, audio_path, size, sha = self._validated(job)
        except ValueError as exc:
            lease = str(job.get("lease", ""))
            _log(logging.ERROR, "analyse_refusee", raison=str(exc))
            if _LEASE_RE.match(lease):
                self._fail(lease, f"L'agent refuse cette analyse : {exc}.")
            return
        work = self._config.work_dir / lease[:16]
        done, cancel, lost = threading.Event(), threading.Event(), threading.Event()
        beat = threading.Thread(
            target=self._heartbeat_loop,
            args=(lease, max(0.2, float(job.get("lease_s") or 90) / 3), done, cancel, lost),
            daemon=True,
        )
        try:
            work.mkdir(parents=True, exist_ok=True)
            audio = work / AUDIO_NAME
            beat.start()
            _log(logging.INFO, "analyse_prise", lease=lease[:8], moteur=asr, octets=size)
            try:
                self._download(audio_path, audio, size, sha)
            except ValueError as exc:
                self._fail(lease, str(exc))
                return
            outcome = self._runner.run(audio, work, asr, cancel)
            if cancel.is_set():
                _log(logging.INFO, "analyse_abandonnee", lease=lease[:8], bail_perdu=lost.is_set())
                return
            if outcome.code != 0:
                self._fail(lease, outcome.stderr_tail)
                return
            result = work / RESULT_NAME
            if not result.is_file():
                self._fail(lease, "Le moteur s'est terminé sans produire de résultat.")
                return
            body = result.read_bytes()
            if len(body) > MAX_RESULT_BYTES:
                self._fail(lease, "Le résultat dépasse la taille admise.")
                return
            status, response = self._request(
                "PUT",
                f"/api/engine/leases/{lease}/result",
                body,
                timeout=120.0,
                ctype="application/json",
            )
            response.close()
            _log(
                logging.INFO if status == 200 else logging.ERROR,
                "resultat_depose",
                lease=lease[:8],
                statut=status,
            )
        except ConnectionError as exc:
            _log(logging.ERROR, "analyse_interrompue_reseau", lease=lease[:8], detail=str(exc))
        except OSError as exc:
            _log(
                logging.ERROR,
                "erreur_locale",
                lease=lease[:8],
                detail=exc.strerror or type(exc).__name__,
            )
            self._fail(lease, f"Erreur locale de l'agent : {exc.strerror or type(exc).__name__}")
        finally:
            done.set()
            if beat.is_alive():
                beat.join(5)
            shutil.rmtree(
                work, ignore_errors=True
            )  # vie privée : ni audio ni résultat ne restent ici

    # ---- Boucle --------------------------------------------------------------------------------

    def run_once(self) -> bool:
        """Réclame et traite au plus UNE analyse ; vrai si elle en a pris une.

        Lève AgentRevoked (jeton refusé) ou ConnectionError (atelier indisponible).
        """
        job = self._claim()
        if job is None:
            return False
        self._process(job)
        return True

    def run_forever(
        self,
        stop: threading.Event,
        *,
        sleep: Callable[[float], None] | None = None,
        max_iterations: int | None = None,
    ) -> None:
        """Boucle jusqu'à `stop` ; une panne de l'atelier ne l'arrête pas (attente croissante)."""
        pause = sleep or (lambda seconds: stop.wait(seconds) and None)
        failures, iterations = 0, 0
        while not stop.is_set() and (max_iterations is None or iterations < max_iterations):
            iterations += 1
            try:
                worked = self.run_once()
            except ConnectionError as exc:
                delay = backoff_seconds(failures)
                failures += 1
                _log(
                    logging.WARNING,
                    "atelier_indisponible",
                    detail=str(exc),
                    nouvel_essai_s=round(delay, 1),
                )
                pause(delay)
                continue
            if failures:
                _log(logging.INFO, "atelier_retrouve", apres_pannes=failures)
            failures = 0
            if not worked and self._config.wait_s == 0:
                pause(1.0)


def build_runner(config: AgentConfig) -> SubprocessRunner:
    return SubprocessRunner(
        python=config.python,
        models_dir=config.models_dir,
        corpus_dir=config.corpus_dir,
        lock_path=config.lock_path,
    )
