"""`aqr engine-agent` : configuration invalide ou jeton refusé = message clair, code dédié."""

from __future__ import annotations

import io
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from aqr.cli import main

TOKEN = "qea_" + "A" * 43


def run(argv: list[str], env: dict[str, str]) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    code = main(argv, env=env, out=out, err=err)
    return code, out.getvalue(), err.getvalue()


def test_sans_configuration_dit_quoi_renseigner_et_sort_en_2() -> None:
    code, _, err = run(["engine-agent", "--once"], {})
    assert code == 2
    assert "AQR_ENGINE_URL" in err


def test_jeton_d_utilisateur_refuse_avant_tout_appel_reseau() -> None:
    env = {"AQR_ENGINE_URL": "https://atelier.example", "AQR_ENGINE_TOKEN": "qtr_" + "A" * 43}
    code, _, err = run(["engine-agent", "--once"], env)
    assert code == 2
    assert "jeton d'agent" in err
    assert "qtr_" not in err  # le jeton fautif n'est jamais répété


@pytest.fixture
def refusing_atelier() -> str:
    class Refuse(BaseHTTPRequestHandler):
        def log_message(self, *args: object) -> None:
            return

        def do_POST(self) -> None:
            self.send_response(401)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"{}")

    server = ThreadingHTTPServer(("127.0.0.1", 0), Refuse)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"  # type: ignore[misc]
    server.shutdown()
    server.server_close()


def test_jeton_revoque_sort_en_3_avec_un_message_qui_dit_quoi_faire(refusing_atelier: str) -> None:
    env = {"AQR_ENGINE_URL": refusing_atelier, "AQR_ENGINE_TOKEN": TOKEN, "AQR_ENGINE_WAIT_S": "0"}
    code, _, err = run(["engine-agent", "--once"], env)
    assert code == 3
    assert "refusé" in err and "administrateur" in err
    assert TOKEN not in err


def test_l_agent_journalise_son_demarrage_sans_jamais_le_jeton(refusing_atelier: str) -> None:
    # Sans journal, `journalctl` ne montre que « Started » : on ignore ce que fait l'agent.
    env = {"AQR_ENGINE_URL": refusing_atelier, "AQR_ENGINE_TOKEN": TOKEN, "AQR_ENGINE_WAIT_S": "0"}
    _, _, err = run(["engine-agent", "--once"], env)
    assert "agent_demarre" in err
    assert refusing_atelier in err  # l'adresse de l'atelier est dite, jamais le jeton
    assert TOKEN not in err and TOKEN[4:] not in err


def test_message_de_jeton_refuse_ne_cite_aucun_menu_inexistant(refusing_atelier: str) -> None:
    env = {"AQR_ENGINE_URL": refusing_atelier, "AQR_ENGINE_TOKEN": TOKEN, "AQR_ENGINE_WAIT_S": "0"}
    _, _, err = run(["engine-agent", "--once"], env)
    assert "Administration > Moteur" not in err
    assert "/api/admin/engine-agents" in err
