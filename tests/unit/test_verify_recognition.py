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
