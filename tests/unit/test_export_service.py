"""Export de bout en bout : contrôle de préparation, fichiers SRT / WebVTT / ASS / JSON, ligne de
commande. Corpus réel ; traductions QuranEnc factices (cache et réseau simulés)."""

from __future__ import annotations

import copy
import io
import json
from pathlib import Path
from typing import Any

import pytest
from tests.support.export_docs import abstention, document, formula, uncertain, verse
from tests.unit.test_export_analysis import decision_for

from aqr.cli import main
from aqr.domain.models import VerseRef
from aqr.domain.quran_structure import ayah_count
from aqr.export.options import ExportOptions, parse_options
from aqr.export.service import (
    Environment,
    ExportBlocked,
    corpus_verse,
    load_inputs,
    run_export,
    run_readiness,
)
from aqr.rendering.passages import Passages

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"

pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "quran-uthmani.txt").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)

SESSION = "5014015f-0000-4000-8000-000000000001"


def fake_quranenc(url: str) -> bytes:
    """Une sourate entière de traductions factices, comme l'API la rend."""
    surah = int(url.rstrip("/").rsplit("/", 1)[1])
    result = [
        {"aya": str(a), "translation": f"Traduction {surah}:{a}.[1]"}
        for a in range(1, ayah_count(surah) + 1)
    ]
    return json.dumps({"result": result}).encode("utf-8")


@pytest.fixture()
def env(tmp_path: Path) -> Environment:
    return Environment(
        corpus_dir=CORPUS_DIR,
        cache_dir=tmp_path / "cache",
        segments_dir=None,
        fetcher=fake_quranenc,
    )


UNC = uncertain("11:61", (1, 10), (48.2, 62.6), ["11:61", "7:73"])
INF = verse("112:3", (1, 4), (70.0, 73.0), status="inferred")
OK = verse("112:1", (5, 8), (1.0, 4.0))
DOC = document(
    OK, UNC, INF, abstention((80.0, 85.0), "below_threshold"), formula("takbir", (90.0, 91.0))
)


def write(tmp_path: Path, doc: dict[str, Any], *decisions: dict[str, Any]) -> tuple[Path, Path]:
    prediction = tmp_path / "prediction.recognition.json"
    prediction.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    decisions_path = tmp_path / "decisions.json"
    decisions_path.write_text(
        json.dumps(
            {
                "schema": "aqr.decisions/1",
                "session_id": SESSION,
                "prediction_sha256": None,
                "consent": {"training": True, "by": "cherif", "at": "2026-10-23T14:00:00Z"},
                "revision": 1,
                "updated_at": "2026-10-23T14:00:00Z",
                "decisions": list(decisions),
            }
        ),
        encoding="utf-8",
    )
    return prediction, decisions_path


def options(**changes: Any) -> ExportOptions:
    return parse_options(changes)


# --- contrôle de préparation -----------------------------------------------------------------


def test_le_controle_compte_les_passages_ambigus_et_les_non_coraniques_a_part(tmp_path, env):
    prediction, decisions = write(tmp_path, DOC)
    payload = run_readiness(load_inputs(prediction, decisions), options(), env)
    assert payload["schema"] == "aqr.export-readiness/1"
    assert payload["verdict"]["total"] == 2 and payload["verdict"]["ready"] is False
    assert payload["verses"] == 3
    assert payload["verdict"]["unresolved"] == 2 and payload["verdict"]["resolved"] == 0
    assert (payload["non_quran"]["abstentions"], payload["non_quran"]["formulas"]) == (1, 1)
    # le non coranique se VOIT (liste neutre) mais n'est dans aucune liste de passages à vérifier
    assert [i["kind"] for i in payload["non_quran"]["items"]] == ["abstention", "formula"]
    assert all(i["type"] in ("uncertain", "inferred") for i in payload["items"])
    assert [i["type"] for i in payload["items"]] == ["uncertain", "inferred"]
    assert payload["first_open"] == payload["items"][0]["key"]


def test_les_candidats_montrent_les_mots_qui_different(tmp_path, env):
    prediction, _ = write(tmp_path, DOC)
    payload = run_readiness(load_inputs(prediction), options(content="ar"), env)
    candidates = payload["items"][0]["candidates"]
    assert [c["ref"] for c in candidates] == ["11:61", "7:73"]
    flagged = [n for n, token in enumerate(candidates[0]["tokens"]) if token["diff"]]
    assert flagged == [3]  # seul le signe de pause qui suit le quatrième mot diffère
    assert payload["items"][0]["impact"] == "arabic_sign"


def test_la_liste_est_paginee_et_le_decompte_exact(tmp_path, env):
    many = [
        verse("112:3", (1, 4), (float(10 * n), float(10 * n + 3)), status="inferred")
        for n in range(25)
    ]
    prediction, _ = write(tmp_path, document(*many))
    inputs = load_inputs(prediction)
    first = run_readiness(inputs, options(), env, page=0, size=10)
    last = run_readiness(inputs, options(), env, page=2, size=10)
    assert first["verdict"]["total"] == 25 and first["page"] == {
        "index": 0,
        "size": 10,
        "total": 25,
        "pages": 3,
    }
    assert len(first["items"]) == 10 and len(last["items"]) == 5
    assert len(json.dumps(first)) < 100_000


def test_filtre_d_etat_et_page_du_premier_passage_ouvert(tmp_path, env):
    many = [
        verse("112:3", (1, 4), (float(10 * n), float(10 * n + 3)), status="inferred")
        for n in range(25)
    ]
    first = many[0]
    prediction, decisions = write(
        tmp_path,
        document(*many),
        decision_for(first, "inferred", "exclude", {"reason": "not_heard"}),
    )
    inputs = load_inputs(prediction, decisions)
    everything = run_readiness(inputs, options(), env, size=10)
    assert everything["first_open"] == everything["items"][1]["key"]  # le premier est résolu
    assert everything["first_open_page"] == 0
    opened = run_readiness(inputs, options(), env, size=10, state_filter="open")
    assert opened["page"]["total"] == 24 and all(i["state"] == "open" for i in opened["items"])
    assert (
        run_readiness(inputs, options(), env, size=10, state_filter="resolved")["page"]["total"]
        == 1
    )
    late = [
        verse("112:3", (1, 4), (float(10 * n), float(10 * n + 3)), status="inferred")
        for n in range(25)
    ]
    only_last = write(
        tmp_path,
        document(*late),
        *[
            decision_for(
                interval,
                "inferred",
                "exclude",
                {"reason": "not_heard"},
                id_=f"00000000-0000-4000-8000-{n:012d}",
            )
            for n, interval in enumerate(late[:20], start=1)
        ],
    )
    skipped = run_readiness(load_inputs(*only_last), options(), env, size=10)
    assert skipped["first_open_page"] == 2


def test_une_decision_fait_passer_le_passage_a_resolu(tmp_path, env):
    prediction, decisions = write(
        tmp_path,
        DOC,
        decision_for(UNC, "uncertain", "choose", {"ref": "11:61", "words": [1, 10]}),
    )
    payload = run_readiness(load_inputs(prediction, decisions), options(), env)
    assert payload["verdict"]["resolved"] == 1 and payload["verdict"]["unresolved"] == 1
    assert payload["items"][0]["state"] == "resolved"
    assert payload["items"][0]["decision"]["kind"] == "choose"


def test_une_decision_orpheline_est_signalee(tmp_path, env):
    moved = uncertain("11:61", (1, 10), (49.0, 62.6), ["11:61", "7:73"])
    prediction, decisions = write(
        tmp_path,
        document(OK, moved),
        decision_for(UNC, "uncertain", "choose", {"ref": "11:61", "words": [1, 10]}),
    )
    payload = run_readiness(load_inputs(prediction, decisions), options(), env)
    assert len(payload["orphans"]) == 1 and payload["verdict"]["unresolved"] == 1


# --- export ----------------------------------------------------------------------------------


def test_sans_correction_l_export_est_refuse_sauf_s_il_est_force(tmp_path, env):
    prediction, decisions = write(tmp_path, DOC)
    inputs = load_inputs(prediction, decisions)
    with pytest.raises(ExportBlocked) as blocked:
        run_export(inputs, options(), env)
    assert blocked.value.unresolved == 2
    forced = run_export(inputs, options(allow_unresolved=True), env)
    assert forced.summary["forced"] is True and forced.summary["unresolved"] == 2
    assert forced.summary["omitted_total"] == 2 and forced.summary["policy"] == "omit"


def test_un_export_tout_resolu_ne_demande_rien_et_porte_le_texte_du_corpus(tmp_path, env):
    prediction, decisions = write(
        tmp_path,
        DOC,
        decision_for(
            UNC,
            "uncertain",
            "choose",
            {"ref": "11:61", "words": [1, 10]},
            id_="0" * 8 + "-0000-4000-8000-00000000000a",
        ),
        decision_for(
            INF,
            "inferred",
            "exclude",
            {"reason": "not_heard"},
            id_="0" * 8 + "-0000-4000-8000-00000000000b",
        ),
    )
    result = run_export(load_inputs(prediction, decisions), options(content="ar", max_s=60), env)
    assert result.summary["forced"] is False and result.summary["unresolved"] == 0
    verses_text = [
        Passages_text("112:1", 5, 8),
        Passages_text("11:61", 1, 10),
    ]
    blocks = [b for b in result.content.strip().split("\n\n")]
    assert len(blocks) == 2
    for block, expected in zip(blocks, verses_text, strict=True):
        assert expected in block  # I1 : mot pour mot le corpus
    assert result.summary["omitted"][0]["reason"] == "excluded"


def Passages_text(ref: str, first: int, last: int) -> str:
    from aqr.corpus.tanzil_repository import TanzilCorpusRepository

    return Passages(TanzilCorpusRepository(CORPUS_DIR)).text(VerseRef.parse(ref), first, last)


def test_la_traduction_est_celle_de_quranenc_inchangee(tmp_path, env):
    prediction, _ = write(tmp_path, document(OK))
    result = run_export(load_inputs(prediction), options(content="fr"), env)
    assert "Traduction 112:1.[1]" in result.content  # le renvoi [1] est gardé (I2)
    stripped = run_export(load_inputs(prediction), options(content="fr", strip_notes=True), env)
    assert "[1]" not in stripped.content and "Traduction 112:1." in stripped.content
    assert stripped.summary["attribution"][0].endswith("Renvois de note retirés.")


def test_l_attribution_est_dans_vtt_et_ass_et_rappelee_pour_srt(tmp_path, env):
    prediction, _ = write(tmp_path, document(OK))
    inputs = load_inputs(prediction)
    vtt = run_export(inputs, options(format="vtt"), env)
    assert (
        "NOTE\nTexte coranique : Tanzil Project (CC-BY-3.0, tanzil.net), non modifié."
        in vtt.content
    )
    ass = run_export(inputs, options(format="ass"), env)
    assert "; Texte coranique : Tanzil Project" in ass.content
    srt = run_export(inputs, options(format="srt"), env)
    assert "Tanzil" not in srt.content and srt.summary["attribution"][0].startswith(
        "Texte coranique"
    )
    assert "QuranEnc" in " ".join(srt.summary["attribution"])


def test_le_json_exporte_ne_reecrit_pas_la_prediction(tmp_path, env):
    prediction, decisions = write(
        tmp_path,
        DOC,
        decision_for(UNC, "uncertain", "choose", {"ref": "11:61", "words": [1, 10]}),
    )
    inputs = load_inputs(prediction, decisions)
    result = run_export(inputs, options(format="json", allow_unresolved=True), env)
    exported = json.loads(result.content)
    assert exported["review"]["forced"] is True and exported["review"]["unresolved"] == 1
    assert exported["review"]["applied"] == 1 and exported["review"]["policy"] == "omit"
    chosen = exported["intervals"][1]
    assert chosen["status"] == "uncertain"  # I5 : le statut du moteur reste intact
    assert chosen["resolved"]["by"] == "human" and chosen["resolved"]["ref"] == "11:61"
    assert chosen["resolved"]["text"] == Passages_text("11:61", 1, 10)
    original = copy.deepcopy(DOC)
    for index, interval in enumerate(exported["intervals"]):
        interval.pop("resolved", None)
        assert interval == original["intervals"][index]
    rest = {k: v for k, v in exported.items() if k not in ("review", "intervals")}
    assert rest == {k: v for k, v in original.items() if k != "intervals"}


def test_annuler_toutes_les_decisions_redonne_l_export_sans_decision(tmp_path, env):
    prediction, decisions = write(
        tmp_path,
        DOC,
        decision_for(UNC, "uncertain", "choose", {"ref": "11:61", "words": [1, 10]}),
    )
    with_decision = json.loads(decisions.read_text(encoding="utf-8"))
    with_decision["decisions"][0]["withdrawn_at"] = "2026-10-23T15:00:00Z"
    decisions.write_text(json.dumps(with_decision), encoding="utf-8")
    withdrawn = run_export(
        load_inputs(prediction, decisions), options(format="json", allow_unresolved=True), env
    )
    bare = run_export(load_inputs(prediction), options(format="json", allow_unresolved=True), env)
    assert withdrawn.content == bare.content


def test_l_apercu_ne_bloque_pas_mais_dit_ce_qui_bloquerait(tmp_path, env):
    prediction, _ = write(tmp_path, DOC)
    result = run_export(load_inputs(prediction), options(), env, preview=3)
    assert result.summary["would_block"] is True
    assert result.summary["preview"]["cues"] and "1\n" in result.summary["preview"]["head"]


def test_hors_ligne_l_export_continue_sans_traduction_et_le_dit(tmp_path):
    def offline(url: str) -> bytes:
        raise OSError("pas de réseau")

    prediction, _ = write(tmp_path, document(OK))
    environment = Environment(
        corpus_dir=CORPUS_DIR, cache_dir=tmp_path / "vide", segments_dir=None, fetcher=offline
    )
    result = run_export(load_inputs(prediction), options(), environment)
    assert result.summary["cues"] == 1
    assert any("traduction indisponible" in w for w in result.summary["warnings"])


def test_corpus_verse_lit_le_corpus_et_refuse_ce_qui_n_existe_pas(env):
    good = corpus_verse("112:2", None, ExportOptions(), env)
    assert good["ok"] and good["tokens"] == good["verse_tokens"]
    assert good["translation"].startswith("Traduction 112:2")
    assert corpus_verse("115:1", None, ExportOptions(), env)["ok"] is False
    assert corpus_verse("2:300", None, ExportOptions(), env)["ok"] is False
    assert corpus_verse("112:2", (7, 9), ExportOptions(), env)["ok"] is False


# --- ligne de commande -----------------------------------------------------------------------


def run_cli(*argv: str) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    code = main(list(argv), env={}, out=out, err=err)
    return code, out.getvalue(), err.getvalue()


def test_cli_export_ecrit_le_fichier_et_refuse_les_ambiguites(tmp_path):
    prediction, decisions = write(tmp_path, DOC)
    out_file = tmp_path / "essai.srt"
    base = [
        "export-subtitles",
        str(prediction),
        "--decisions",
        str(decisions),
        "--corpus-dir",
        str(CORPUS_DIR),
        "--no-translations",
        "--options",
        '{"content": "ar"}',
    ]
    code, out, _ = run_cli(*base, "--out", str(out_file))
    assert code == 3 and not out_file.exists()
    assert json.loads(out) == {"error": "unresolved_items", "unresolved": 2}
    code, out, err = run_cli(*base, "--out", str(out_file), "--allow-unresolved")
    assert code == 0, err
    summary = json.loads(out)
    assert summary["forced"] is True and summary["file"] == "essai.srt"
    assert Passages_text("112:1", 5, 8) in out_file.read_text(encoding="utf-8")
    code, _, err = run_cli(*base, "--out", str(out_file), "--allow-unresolved")
    assert code == 1 and "--force" in err
    code, _, _ = run_cli(*base, "--out", str(out_file), "--allow-unresolved", "--force")
    assert code == 0


def test_cli_bom_et_options_invalides(tmp_path):
    prediction, _ = write(tmp_path, document(OK))
    out_file = tmp_path / "bom.vtt"
    common = ["--corpus-dir", str(CORPUS_DIR), "--no-translations"]
    code, _, err = run_cli(
        "export-subtitles",
        str(prediction),
        *common,
        "--out",
        str(out_file),
        "--options",
        '{"format": "vtt", "content": "ar", "bom": true}',
    )
    assert code == 0, err
    assert out_file.read_bytes().startswith(b"\xef\xbb\xbfWEBVTT")
    code, _, err = run_cli(
        "export-subtitles",
        str(prediction),
        *common,
        "--out",
        str(tmp_path / "x"),
        "--options",
        '{"format": "doc"}',
    )
    assert code == 1 and "format" in err
    code, _, _ = run_cli("export-subtitles", str(prediction), *common)
    assert code == 2


def test_cli_readiness_et_corpus_verse(tmp_path):
    prediction, decisions = write(tmp_path, DOC)
    code, out, err = run_cli(
        "export-readiness",
        str(prediction),
        "--decisions",
        str(decisions),
        "--corpus-dir",
        str(CORPUS_DIR),
        "--no-translations",
        "--blocking-tags",
        "wrong_verse",
        "--size",
        "1",
    )
    assert code == 0, err
    payload = json.loads(out)
    assert payload["page"]["pages"] == 2 and len(payload["items"]) == 1
    code, out, _ = run_cli(
        "corpus-verse",
        "112:1",
        "--words",
        "5-8",
        "--corpus-dir",
        str(CORPUS_DIR),
        "--no-translations",
    )
    assert code == 0 and json.loads(out)["words"] == [5, 8]
    code, _, _ = run_cli(
        "corpus-verse", "115:9", "--corpus-dir", str(CORPUS_DIR), "--no-translations"
    )
    assert code == 1


def test_la_politique_marqueur_donne_les_memes_lignes_que_aqr_recognize(tmp_path, env):
    """Un seul rendu : `aqr recognize --format srt` et l'export forcé « marqueur » écrivent les
    mêmes légendes pour un incertain, un supposé et un reconnu."""
    from aqr.corpus.tanzil_repository import TanzilCorpusRepository
    from aqr.domain.models import Detection, Status, TimeSpan, WordSpan
    from aqr.rendering.home_renderer import HomeRenderer

    corpus = TanzilCorpusRepository(CORPUS_DIR)
    renderer = HomeRenderer(corpus, None)  # type: ignore[arg-type]  # pas de traduction ici
    detections = [
        Detection(WordSpan(VerseRef(112, 1), 5, 8), TimeSpan(1.0, 4.0), Status.RECOGNIZED, 0.9),
        Detection(
            WordSpan(VerseRef(11, 61), 1, 10),
            TimeSpan(48.2, 62.6),
            Status.UNCERTAIN,
            0.7,
            candidates=(VerseRef(11, 61), VerseRef(7, 73)),
        ),
        Detection(
            WordSpan(VerseRef(112, 3), 1, 4),
            TimeSpan(70.0, 73.0),
            Status.INFERRED,
            0.5,
            time_interpolated=True,
        ),
    ]
    legacy = [renderer.caption(d) for d in detections]
    prediction, _ = write(tmp_path, document(OK, UNC, INF))
    result = run_export(
        load_inputs(prediction),
        options(content="ar", policy="marker", allow_unresolved=True, rtl=False, max_s=60, min_s=0),
        env,
    )
    lines = [b.split("\n")[2] for b in result.content.strip().split("\n\n")]
    assert lines == legacy
