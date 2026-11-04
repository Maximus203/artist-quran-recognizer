"""Contrôle d'un résultat `aqr.recognition/1` reçu de l'extérieur : l'arabe vient du corpus (I1) et
la traduction est celle de QuranEnc, sans modification (I2). Corpus réel ; traductions factices
(un dépôt en mémoire et, pour la ligne de commande, un cache de fichiers)."""

from __future__ import annotations

import copy
import hashlib
import io
import json
from pathlib import Path
from typing import Any

import pytest
from tests.support.export_docs import abstention, document, formula, verse

from aqr.cli import main
from aqr.corpus.checksums import CorpusChecksumError
from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.domain.models import NonQuranKind, VerseRef
from aqr.domain.ports import Translation
from aqr.rendering.formula_labels import FORMULA_LABELS_AR
from aqr.rendering.home_renderer import HomeRenderer
from aqr.rendering.verify_recognition import verify_recognition

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"

pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "quran-uthmani.txt").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)

TID = "french_hameedullah"
VERSION = "quranenc.com"
ATTRIBUTION = "QuranEnc.com — Muhammad Hamidullah (révision du Complexe du Roi Fahd)"
FORGED_AR = "نص مزيف لا يوجد في القرآن"


class FakeTranslations:
    """Un dépôt QuranEnc en mémoire : « Traduction S:A. » pour chaque verset."""

    def __init__(self, *, error: Exception | None = None) -> None:
        self.calls = 0
        self._error = error

    def get(self, ref: VerseRef, translation_id: str) -> Translation:
        self.calls += 1
        if self._error is not None:
            raise self._error
        if translation_id != TID:
            raise ValueError(f"translation_id inconnu : {translation_id!r}")
        return Translation(ref, f"Traduction {ref}.", TID, VERSION, ATTRIBUTION)


@pytest.fixture(scope="module")
def corpus() -> TanzilCorpusRepository:
    return TanzilCorpusRepository(CORPUS_DIR)


@pytest.fixture()
def renderer(corpus: TanzilCorpusRepository) -> HomeRenderer:
    return HomeRenderer(corpus, FakeTranslations())


def honest_verse(
    renderer: HomeRenderer, ref: str, t: tuple[float, float], words: tuple[int, int] | None = None
) -> dict[str, Any]:
    """Un intervalle tel que le moteur l'écrit : texte du corpus, traduction du dépôt."""
    parsed = VerseRef.parse(ref)
    total = len(renderer._corpus.words(parsed))
    first, last = words or (1, total)
    item = verse(ref, (first, last), t, partial=(first, last) != (1, total))
    item["text"] = renderer.passage_text(parsed, first, last)
    item["translation"] = renderer.translation_json(parsed, TID)
    return item


def check(doc: dict[str, Any], corpus: TanzilCorpusRepository, repo: Any = None):
    return verify_recognition(
        doc,
        corpus,
        FakeTranslations() if repo is None else repo,
        known_translation_ids={TID},
    )


# --- le chemin légitime ----------------------------------------------------------------------


def test_un_resultat_fidele_au_corpus_passe(corpus, renderer):
    doc = document(
        honest_verse(renderer, "112:1", (0, 3)),
        honest_verse(renderer, "2:255", (3, 9), words=(2, 5)),
        abstention((9, 10)),
    )
    result = check(doc, corpus)
    assert result.ok
    assert result.findings == () and result.unverifiable == ()
    assert result.checked >= 2


def test_un_resultat_sans_texte_ni_traduction_passe(corpus):
    """Une copie expurgée n'invente rien : l'absence de texte n'est pas une falsification."""
    doc = document(verse("112:1", (1, 4), (0, 3)), formula("french", (3, 5)))
    assert check(doc, corpus).ok


def test_la_basmala_et_les_libelles_de_formule_du_moteur_passent(corpus, renderer):
    basmala = {"kind": "non_quran", "label": "basmala", "t": [0, 2], **renderer.render_basmala(TID)}
    amin = formula("amin", (2, 3), label_ar=FORMULA_LABELS_AR[NonQuranKind.AMIN])
    assert check(document(basmala, amin), corpus).ok


# --- l'arabe inventé ou altéré (I1) ------------------------------------------------------------


def test_un_faux_texte_arabe_est_refuse(corpus, renderer):
    doc = document(honest_verse(renderer, "112:1", (0, 3)))
    doc["intervals"][0]["text"] = FORGED_AR
    result = check(doc, corpus)
    assert not result.ok
    (finding,) = result.findings
    assert (finding.index, finding.ref, finding.field) == (0, "112:1", "text")
    assert FORGED_AR not in finding.message  # le message ne recopie jamais le faux texte


def test_un_texte_vrai_mais_d_un_autre_verset_est_refuse(corpus, renderer):
    doc = document(honest_verse(renderer, "112:1", (0, 3)))
    doc["intervals"][0]["text"] = renderer.passage_text(VerseRef.parse("112:2"), 1, 3)
    assert [f.field for f in check(doc, corpus).findings] == ["text"]


def test_un_mot_change_dans_le_texte_est_refuse(corpus, renderer):
    doc = document(honest_verse(renderer, "2:255", (0, 5)))
    doc["intervals"][0]["text"] = doc["intervals"][0]["text"][:-1]  # un seul signe en moins
    assert [f.field for f in check(doc, corpus).findings] == ["text"]


def test_le_texte_d_une_plage_de_mots_doit_etre_celui_des_mots_declares(corpus, renderer):
    doc = document(honest_verse(renderer, "2:255", (0, 5), words=(2, 5)))
    doc["intervals"][0]["words"] = [1, 4]  # le texte est celui des mots 2 à 5
    assert [f.field for f in check(doc, corpus).findings] == ["text"]


def test_une_reference_inexistante_est_refusee(corpus):
    doc = document(verse("112:9", (1, 4), (0, 3)), verse("2:300", (1, 4), (3, 6)))
    result = check(doc, corpus)
    assert [(f.index, f.field) for f in result.findings] == [(0, "ref"), (1, "ref")]


def test_une_plage_de_mots_hors_du_verset_est_refusee(corpus):
    doc = document(verse("112:1", (1, 40), (0, 3)))
    assert [f.field for f in check(doc, corpus).findings] == ["words"]


def test_un_candidat_inexistant_est_refuse(corpus):
    doc = document(
        verse("112:1", (1, 4), (0, 3), status="uncertain", candidates=["112:1", "9:500"])
    )
    assert [f.field for f in check(doc, corpus).findings] == ["candidates"]


def test_une_basmala_falsifiee_est_refusee(corpus, renderer):
    basmala = {"kind": "non_quran", "label": "basmala", "t": [0, 2], **renderer.render_basmala(TID)}
    basmala["text"] = FORGED_AR
    assert [f.field for f in check(document(basmala), corpus).findings] == ["text"]


def test_un_faux_libelle_de_formule_est_refuse(corpus):
    doc = document(formula("takbir", (0, 2), label_ar=FORGED_AR))
    assert [f.field for f in check(doc, corpus).findings] == ["label_ar"]


def test_un_libelle_arabe_sur_une_zone_sans_formule_est_refuse(corpus):
    doc = document(formula("french", (0, 2), label_ar="الله أكبر"))
    assert [f.field for f in check(doc, corpus).findings] == ["label_ar"]


# --- la traduction altérée (I2) ----------------------------------------------------------------


def test_une_traduction_alteree_est_refusee(corpus, renderer):
    doc = document(honest_verse(renderer, "112:1", (0, 3)))
    doc["intervals"][0]["translation"]["text"] = "Traduction ALTÉRÉE par l'import"
    result = check(doc, corpus)
    assert [f.field for f in result.findings] == ["translation.text"]
    assert "ALTÉRÉE" not in result.findings[0].message


@pytest.mark.parametrize("key", ["version", "attribution"])
def test_une_provenance_modifiee_est_refusee(corpus, renderer, key):
    doc = document(honest_verse(renderer, "112:1", (0, 3)))
    doc["intervals"][0]["translation"][key] = "autre"
    assert [f.field for f in check(doc, corpus).findings] == [f"translation.{key}"]


def test_un_identifiant_de_traduction_inconnu_est_refuse(corpus, renderer):
    doc = document(honest_verse(renderer, "112:1", (0, 3)))
    doc["intervals"][0]["translation"]["translation_id"] = "french_inventee"
    assert [f.field for f in check(doc, corpus).findings] == ["translation.translation_id"]


def test_un_segment_ou_un_fragment_qui_n_est_pas_dans_la_traduction_est_refuse(corpus, renderer):
    doc = document(honest_verse(renderer, "2:255", (0, 5), words=(2, 5)))
    translation = doc["intervals"][0]["translation"]
    translation["segments"] = [
        {"words": [1, 2], "text": "Traduction"},
        {"words": [3, 5], "text": "FAUX"},
    ]
    translation["scope"] = "fragment"
    translation["fragment"] = {"words": [2, 5], "text": "Un fragment inventé"}
    fields = sorted(f.field for f in check(doc, corpus).findings)
    assert fields == ["translation.fragment", "translation.segments"]


def test_un_fragment_decoupe_dans_la_traduction_passe(corpus, renderer):
    doc = document(honest_verse(renderer, "2:255", (0, 5), words=(2, 5)))
    translation = doc["intervals"][0]["translation"]
    translation["segments"] = [
        {"words": [1, 2], "text": "Traduction"},
        {"words": [3, 5], "text": "2:255."},
    ]
    translation["scope"] = "fragment"
    translation["fragment"] = {"words": [3, 5], "text": "2:255."}
    assert check(doc, corpus).ok


# --- traduction invérifiable ---------------------------------------------------------------------


def test_sans_source_de_traduction_la_traduction_n_est_pas_verifiee(corpus, renderer):
    doc = document(honest_verse(renderer, "112:1", (0, 3)))
    result = verify_recognition(doc, corpus, None)
    assert result.findings == ()
    assert [f.field for f in result.unverifiable] == ["translation"]
    assert not result.ok


def test_source_injoignable_un_seul_essai_puis_invérifiable(corpus, renderer):
    repo = FakeTranslations(error=OSError("réseau coupé"))
    doc = document(honest_verse(renderer, "112:1", (0, 3)), honest_verse(renderer, "112:2", (3, 5)))
    result = check(doc, corpus, repo)
    assert repo.calls == 1  # le premier échec coupe les suivants
    assert result.findings == ()
    assert len(result.unverifiable) == 2


def test_cache_de_traduction_corrompu_est_invérifiable_pas_accepte(corpus, renderer):
    repo = FakeTranslations(error=CorpusChecksumError("cache corrompu"))
    doc = document(honest_verse(renderer, "112:1", (0, 3)))
    result = check(doc, corpus, repo)
    assert not result.ok and len(result.unverifiable) == 1


def test_la_cause_d_une_traduction_invérifiable_est_nommee(corpus, renderer):
    """Hors ligne, copie locale illisible, aucune source : trois causes, trois messages."""
    doc = document(honest_verse(renderer, "112:1", (0, 3)))
    offline = check(doc, corpus, FakeTranslations(error=OSError("réseau coupé")))
    assert [f.cause for f in offline.unverifiable] == ["offline"]
    local = check(doc, corpus, FakeTranslations(error=CorpusChecksumError("cache corrompu")))
    assert [f.cause for f in local.unverifiable] == ["local_copy"]
    none = verify_recognition(doc, corpus, None)
    assert [f.cause for f in none.unverifiable] == ["no_source"]


def test_une_falsification_prime_sur_l_invérifiable(corpus, renderer):
    doc = document(honest_verse(renderer, "112:1", (0, 3)))
    doc["intervals"][0]["text"] = FORGED_AR
    result = verify_recognition(doc, corpus, None)
    assert [f.field for f in result.findings] == ["text"]


def test_un_document_mal_forme_ne_plante_pas(corpus):
    result = verify_recognition({"intervals": "pas une liste"}, corpus, None)
    assert [f.field for f in result.findings] == ["intervals"]
    bad = document(verse("112:1", (1, 4), (0, 3)))
    bad["intervals"].append("n'importe quoi")
    assert [f.field for f in verify_recognition(bad, corpus, None).findings] == ["interval"]


# --- champs libres : affichés à l'écran, jamais du Coran inventé (N6) ----------------------------

FREE_FIELDS = ("riwaya", "engine", "warnings", "label")
FREE_FIELD_DOC = document(verse("112:1", (1, 4), (0, 3)))


def free_findings(result) -> list[str]:
    return sorted(f.field for f in result.findings)


def with_free(doc: dict[str, Any], **changes: Any) -> dict[str, Any]:
    out = copy.deepcopy(doc)
    out.update(changes)
    return out


def messages(result) -> str:
    return json.dumps([f.message for f in result.findings], ensure_ascii=False)


def test_les_champs_libres_du_vrai_moteur_passent(corpus, renderer):
    """Les valeurs EXACTES que le moteur écrit (constantes de `output` et de `factory`) ne sont
    jamais refusées : cascade, repli Silero, vérification acoustique indisponible…"""
    from aqr.pipeline.factory import ACOUSTIC_UNAVAILABLE, CONSTRAINED_UNAVAILABLE, SILERO_WARNING
    from aqr.pipeline.output import RIWAYA_NOTICE

    doc = document(honest_verse(renderer, "112:1", (0, 3)), formula("istiadha", (3, 4)))
    doc["engine"] = {
        "asr": "cascade(fastconformer-quran@b33af7936f9a -> whisper-base-quran@5c3c53fdf927/"
        "times-estimated, muno-streaming@0123456789ab/ctc-q8)",
        "segmenter": "silero-vad (non fiable par défaut)",
        "matcher": "flow-matcher (ADR-0004)",
        "decoder": "viterbi-decoder-v2",
        "constrained": False,
        "corpus": "tanzil.net hafs (2026-09-25T09:01:58.990153+00:00)",
        "acoustic": "fastconformer-quran@b33af7936f9a",
    }
    doc["riwaya"] = {"assumed": "hafs", "verified": False, "notice": RIWAYA_NOTICE}
    doc["warnings"] = [
        SILERO_WARNING,
        "repli Silero autorisé : " + SILERO_WARNING,
        f"{ACOUSTIC_UNAVAILABLE} : poids du FastConformer absents de D:\\models ; preuve textuelle",
        CONSTRAINED_UNAVAILABLE,
        "cascade : moteur whisper absent (whisper-base-quran), réécoute sans lui",
        "le segmenteur principal a échoué, repli Silero utilisé (CUDA out of memory)\nligne 2",
    ]
    result = check(doc, corpus)
    assert result.ok, result.findings


def test_la_sortie_reelle_de_build_json_passe_pour_chaque_categorie_non_coranique(corpus, renderer):
    """Non-régression : ce que `aqr recognize` écrit VRAIMENT (`build_json`, toutes les catégories
    de zone non coranique, riwaya, moteur) est accepté sans le moindre constat."""
    from aqr.domain.models import Detection, NonQuranSpan, Status, TimeSpan, WordSpan
    from aqr.pipeline.output import build_json
    from aqr.pipeline.result import EngineInfo, RecognitionResult

    kinds = [NonQuranSpan(TimeSpan(i, i + 1.0), kind) for i, kind in enumerate(NonQuranKind)]
    span = WordSpan(VerseRef(112, 1), 1, len(corpus.words(VerseRef(112, 1))))
    result = RecognitionResult(
        source_file="récitation 01.mp3",
        duration_s=60.0,
        intervals=(*kinds, Detection(span, TimeSpan(20.0, 24.0), Status.RECOGNIZED, 0.95)),
        engine=EngineInfo(
            "fastconformer-quran@b33af7936f9a",
            "recitation-segmenter-v2@5ee90364e709",
            "flow-matcher (ADR-0004)",
            "viterbi-decoder-v2",
            corpus="tanzil.net hafs (2026-09-25T09:01:58.990153+00:00)",
            acoustic="fastconformer-quran@b33af7936f9a",
        ),
        timing={"total_s": 5.0},
        decoder_config={"min_recognized_score": 0.75},
        windows=4,
        warnings=("repli Silero autorisé : segmenteur Silero VAD utilisé",),
    )
    doc = build_json(result, renderer, TID, source_sha256="ab" * 32)
    verdict = check(json.loads(json.dumps(doc)), corpus)
    assert verdict.ok, verdict.findings
    assert verdict.checked == len(kinds) + 1


REAL_RESULTS = sorted(
    (Path(__file__).resolve().parents[2] / "docs" / "evaluation").glob("**/*.redacted.json")
)


@pytest.mark.parametrize("path", REAL_RESULTS, ids=lambda p: p.name)
def test_les_vrais_resultats_du_moteur_n_ont_aucun_constat_sur_les_champs_libres(corpus, path):
    doc = json.loads(path.read_text(encoding="utf-8"))
    if doc.get("schema") != "aqr.recognition/1":
        pytest.skip("pas un résultat aqr.recognition/1")
    result = verify_recognition(doc, corpus, None, known_translation_ids={TID})
    assert [f for f in result.findings if f.field.split(".")[0] in FREE_FIELDS] == []


@pytest.mark.parametrize(
    "assumed", [FORGED_AR, "Qul huwa Allahu ahad", "", "HAFS", 3, None, ["hafs"]]
)
def test_une_riwaya_supposee_inconnue_est_refusee(corpus, assumed):
    doc = with_free(FREE_FIELD_DOC, riwaya={"assumed": assumed, "verified": False, "notice": "ok"})
    result = check(doc, corpus)
    assert free_findings(result) == ["riwaya.assumed"]
    assert FORGED_AR not in messages(result)


@pytest.mark.parametrize("assumed", ["hafs", "warsh"])
def test_les_riwayas_connues_passent(corpus, assumed):
    doc = with_free(
        FREE_FIELD_DOC,
        riwaya={"assumed": assumed, "verified": False, "notice": "Riwaya supposée."},
    )
    assert check(doc, corpus).ok


@pytest.mark.parametrize(
    "notice", [FORGED_AR, "Riwaya " + FORGED_AR, "x" * 1001, "a\x00b", "a\u202eb", 5, None]
)
def test_une_notice_de_riwaya_inventee_est_refusee(corpus, notice):
    doc = with_free(FREE_FIELD_DOC, riwaya={"assumed": "hafs", "verified": False, "notice": notice})
    result = check(doc, corpus)
    assert free_findings(result) == ["riwaya.notice"]
    assert FORGED_AR not in messages(result)


@pytest.mark.parametrize("riwaya", ["hafs", ["x"], 3])
def test_une_riwaya_qui_n_est_pas_un_objet_est_refusee(corpus, riwaya):
    assert free_findings(check(with_free(FREE_FIELD_DOC, riwaya=riwaya), corpus)) == ["riwaya"]


@pytest.mark.parametrize("key", ["asr", "segmenter", "matcher", "decoder", "corpus", "acoustic"])
@pytest.mark.parametrize(
    "value", [FORGED_AR, "moteur " + FORGED_AR, "x" * 301, "a\x00b", "a\u202eb", "a\u200bb", 7]
)
def test_un_champ_texte_du_moteur_invente_est_refuse(corpus, key, value):
    doc = copy.deepcopy(FREE_FIELD_DOC)
    doc["engine"][key] = value
    result = check(doc, corpus)
    assert free_findings(result) == [f"engine.{key}"]
    assert FORGED_AR not in messages(result)


def test_un_moteur_qui_n_est_pas_un_objet_est_refuse(corpus):
    assert free_findings(check(with_free(FREE_FIELD_DOC, engine="whisper"), corpus)) == ["engine"]


@pytest.mark.parametrize(
    "warnings", ["un seul", {"a": "b"}, [1], [None], ["ok"] * 201, ["x" * 2001]]
)
def test_des_avertissements_mal_formes_ou_demesures_sont_refuses(corpus, warnings):
    assert free_findings(check(with_free(FREE_FIELD_DOC, warnings=warnings), corpus)) == [
        "warnings"
    ]


def test_un_avertissement_peut_citer_un_chemin_arabe_il_est_masque_a_la_lecture(corpus):
    """Un message d'erreur d'un système en arabe n'est pas une falsification : l'import passe, le
    texte arabe n'est jamais montré (masqué par la lecture, `recognition.ts`)."""
    doc = with_free(FREE_FIELD_DOC, warnings=["poids absents de C:\\Users\\محمد\\models"])
    assert check(doc, corpus).ok


@pytest.mark.parametrize("label", [FORGED_AR, "parole libre", "frenchh", "", 4, None])
def test_un_libelle_de_zone_non_coranique_inconnu_est_refuse(corpus, label):
    result = check(document(formula(label, (0, 2))), corpus)
    assert free_findings(result) == ["label"]
    assert FORGED_AR not in messages(result)


@pytest.mark.parametrize(
    "label",
    [k.value for k in NonQuranKind if k is not NonQuranKind.BASMALA] + ["[isti'adha]", "âmîn"],
)
def test_les_libelles_connus_passent(corpus, label):
    assert check(document(formula(label, (0, 2))), corpus).ok


# --- ligne de commande ---------------------------------------------------------------------------


def seed_cache(cache: Path) -> None:
    """Le cache de traductions que l'adaptateur lit : une sourate par fichier, avec sa somme."""
    from aqr.domain.quran_structure import SURAH_COUNT, ayah_count

    folder = cache / "translations" / TID
    folder.mkdir(parents=True)
    for surah in range(1, SURAH_COUNT + 1):
        result = [
            {"aya": str(a), "translation": f"Traduction {surah}:{a}."}
            for a in range(1, ayah_count(surah) + 1)
        ]
        raw = json.dumps({"result": result}).encode("utf-8")
        (folder / f"{surah}.json").write_bytes(raw)
        (folder / f"{surah}.sha256").write_text(hashlib.sha256(raw).hexdigest(), encoding="utf-8")


def run_cli(*argv: str, cache: Path | None = None) -> tuple[int, dict[str, Any], str]:
    out, err = io.StringIO(), io.StringIO()
    env = {} if cache is None else {"AQR_CACHE_DIR": str(cache)}
    code = main(["verify-recognition", *argv], env=env, out=out, err=err)
    text = out.getvalue()
    return code, (json.loads(text) if text.strip() else {}), err.getvalue()


@pytest.fixture()
def cache(tmp_path: Path) -> Path:
    seed_cache(tmp_path / "cache")
    return tmp_path / "cache"


def write(tmp_path: Path, doc: dict[str, Any]) -> Path:
    path = tmp_path / "r.recognition.json"
    path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    return path


def test_cli_resultat_fidele_code_0(tmp_path, cache, renderer):
    path = write(tmp_path, document(honest_verse(renderer, "112:1", (0, 3))))
    code, payload, _ = run_cli(str(path), "--corpus-dir", str(CORPUS_DIR), cache=cache)
    assert code == 0 and payload["status"] == "ok" and payload["findings"] == []


def test_cli_resultat_falsifie_code_1_avec_les_constats(tmp_path, cache, renderer):
    doc = document(honest_verse(renderer, "112:1", (0, 3)))
    doc["intervals"][0]["text"] = FORGED_AR
    path = write(tmp_path, copy.deepcopy(doc))
    code, payload, _ = run_cli(str(path), "--corpus-dir", str(CORPUS_DIR), cache=cache)
    assert code == 1 and payload["status"] == "invalid"
    assert payload["findings"][0] == {
        "index": 0,
        "ref": "112:1",
        "field": "text",
        "message": payload["findings"][0]["message"],
    }
    assert FORGED_AR not in json.dumps(payload, ensure_ascii=False)


def test_cli_hors_ligne_sans_cache_code_4(tmp_path, renderer):
    path = write(tmp_path, document(honest_verse(renderer, "112:1", (0, 3))))
    code, payload, _ = run_cli(
        str(path), "--corpus-dir", str(CORPUS_DIR), "--no-translations", cache=tmp_path / "vide"
    )
    assert code == 4 and payload["status"] == "unverifiable"


def test_cli_fichier_illisible_code_1(tmp_path):
    path = tmp_path / "x.json"
    path.write_text("{ pas du json", encoding="utf-8")
    out, err = io.StringIO(), io.StringIO()
    code = main(
        ["verify-recognition", str(path), "--corpus-dir", str(CORPUS_DIR)], env={}, out=out, err=err
    )
    assert code == 1 and "ERREUR" in err.getvalue()


def test_cli_json_tres_imbrique_est_un_fichier_illisible_pas_un_plantage(tmp_path):
    """20 000 niveaux : l'analyseur JSON de Python dépasse sa pile (RecursionError). Le contrôle
    le dit en une ligne et sort avec 1, au lieu d'une trace qui ressemblait à une panne."""
    path = tmp_path / "x.json"
    path.write_text("[" * 20000 + "]" * 20000, encoding="utf-8")
    out, err = io.StringIO(), io.StringIO()
    code = main(
        ["verify-recognition", str(path), "--corpus-dir", str(CORPUS_DIR)], env={}, out=out, err=err
    )
    assert code == 1
    assert err.getvalue().startswith("ERREUR") and "imbriqué" in err.getvalue()


def test_cli_la_cause_d_une_traduction_invérifiable_est_dans_le_rapport(tmp_path, renderer):
    path = write(tmp_path, document(honest_verse(renderer, "112:1", (0, 3))))
    code, payload, _ = run_cli(
        str(path), "--corpus-dir", str(CORPUS_DIR), "--no-translations", cache=tmp_path / "vide"
    )
    assert code == 4
    assert payload["unverifiable"][0]["cause"] == "no_source"
