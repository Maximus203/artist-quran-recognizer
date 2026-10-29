"""Worker chaud : protocole JSON-lignes, moteur chargé une fois, erreurs sans arrêt du service."""

from __future__ import annotations

import io
import json

from aqr.app.worker import CachedFactory, serve
from aqr.cli import main
from aqr.pipeline.factory import RecognizeOptions


def _lines(*requests: object) -> io.StringIO:
    return io.StringIO("".join(json.dumps(r) + "\n" for r in requests))


def _replies(out: io.StringIO) -> list[dict]:
    return [json.loads(line) for line in out.getvalue().splitlines()]


def test_une_reponse_par_requete_dans_l_ordre():
    seen: list[list[str]] = []

    def run(argv, stdout, stderr):
        seen.append(list(argv))
        stdout.write(f"ok {argv[0]}")
        return 0

    out = io.StringIO()
    serve(_lines({"id": "a", "argv": ["recognize", "x"]}, {"id": "b", "argv": ["align"]}), out, run)
    assert seen == [["recognize", "x"], ["align"]]
    replies = _replies(out)
    assert replies[0] == {"event": "ready"}
    assert [(r["id"], r["code"], r["stdout"]) for r in replies[1:]] == [
        ("a", 0, "ok recognize"),
        ("b", 0, "ok align"),
    ]


def test_une_exception_ne_tue_pas_le_service():
    def run(argv, stdout, stderr):
        if argv[0] == "boom":
            raise RuntimeError("cuda out of memory")
        return 0

    out = io.StringIO()
    serve(_lines({"id": "1", "argv": ["boom"]}, {"id": "2", "argv": ["fine"]}), out, run)
    first, second = _replies(out)[1:]
    assert first["code"] == 1 and "cuda out of memory" in first["stderr"]
    assert second["code"] == 0


def test_ligne_illisible_ou_incomplete_est_refusee_sans_arret():
    out = io.StringIO()
    stdin = io.StringIO(
        'pas du json\n{"id": "x"}\n' + json.dumps({"id": "ok", "argv": ["a"]}) + "\n"
    )
    serve(stdin, out, lambda argv, so, se: 0)
    replies = _replies(out)[1:]
    assert [r.get("code") for r in replies] == [2, 2, 0]
    assert replies[2]["id"] == "ok"


def test_argparse_qui_quitte_est_un_code_de_retour():
    out = io.StringIO()
    serve(
        _lines({"id": "1", "argv": ["recognize", "--option-inconnue"]}),
        out,
        lambda argv, so, se: main(argv, out=so, err=se),
    )
    reply = _replies(out)[1]
    assert reply["code"] == 2 and reply["stderr"]


def test_le_moteur_n_est_construit_qu_une_fois_par_jeu_d_options():
    built: list[RecognizeOptions] = []

    def build(options, env):
        built.append(options)
        return object()

    cached = CachedFactory(build)
    a = RecognizeOptions(asr="cascade")
    assert cached(a, {}) is cached(a, {})
    assert len(built) == 1
    other = RecognizeOptions(asr="whisper")
    cached(other, {})
    assert len(built) == 2
    # un seul moteur gardé (mémoire GPU) : revenir au premier le reconstruit
    cached(a, {})
    assert len(built) == 3


def test_la_sortie_standard_du_processus_reste_propre():
    """Un `print` de bibliothèque ne s'intercale pas dans le protocole : il finit dans `stderr`."""
    out = io.StringIO()

    def run(argv, stdout, stderr):
        print("bruit d'une bibliothèque")
        return 0

    serve(_lines({"id": "1", "argv": ["x"]}), out, run)
    replies = _replies(out)  # chaque ligne est un JSON valide
    assert "bruit d'une bibliothèque" in replies[1]["stderr"]
    assert replies[1]["stdout"] == ""


def test_sous_commande_worker_via_main():
    out, err = io.StringIO(), io.StringIO()
    code = main(["worker"], out=out, err=err, stdin=_lines({"id": "1", "argv": ["--help"]}))
    assert code == 0
    assert _replies(out)[0] == {"event": "ready"}
    assert _replies(out)[1]["id"] == "1"
