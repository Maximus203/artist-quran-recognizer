"""Index de la documentation et notes de version : contrôles de `scripts/check_docs_index.py`
et squelette de `scripts/new_release_note.py`. Lit seulement des fichiers (aucun réseau)."""

from __future__ import annotations

import datetime
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import check_docs_index as check  # noqa: E402
import new_release_note as note  # noqa: E402

ENTRY = (
    "## 2026-10-22 — Un titre\nÉtiquettes : technique\nPR : #1\n\n**Ce qui change.** Du texte.\n"
)
NOTES = "# Notes de version\n\n<!-- format -->\n\n" + ENTRY


def _repo(tmp_path: Path, entries: list[dict[str, str]], notes: str = NOTES) -> Path:
    (tmp_path / "docs" / "adr").mkdir(parents=True)
    (tmp_path / "docs" / "adr" / "0001-x.md").write_text("# ADR\n", encoding="utf-8")
    (tmp_path / "docs" / "a.md").write_text("# A\n", encoding="utf-8")
    (tmp_path / "docs" / "RELEASE-NOTES.md").write_text(notes, encoding="utf-8")
    (tmp_path / "docs" / "docs-index.json").write_text(
        json.dumps(entries, ensure_ascii=False), encoding="utf-8"
    )
    return tmp_path


def _doc(slug: str, file: str, section: str = "Architecture") -> dict[str, str]:
    return {"slug": slug, "title": "T", "section": section, "file": file, "summary": "S"}


GOOD = [_doc("a", "docs/a.md"), _doc("adr-1", "docs/adr/0001-x.md", "Décisions")]


# --- le dépôt réel ---------------------------------------------------------------------------


def test_l_index_du_depot_est_conforme() -> None:
    assert check.check_index(ROOT) == []


def test_les_notes_de_version_du_depot_sont_conformes() -> None:
    assert check.check_release_notes(ROOT) == []


def test_l_index_du_depot_couvre_les_documents_demandes() -> None:
    slugs = {e["slug"] for e in json.loads((ROOT / check.INDEX).read_text(encoding="utf-8"))}
    expected = {"systeme-en-bref", "architecture-atelier", "release-notes", "plan"}
    expected |= {f"adr-000{n}" for n in range(1, 10)}
    assert expected <= slugs


# --- index : refus --------------------------------------------------------------------------


def test_un_index_conforme_passe(tmp_path: Path) -> None:
    assert check.check_index(_repo(tmp_path, GOOD)) == []


def test_slug_en_double_refuse(tmp_path: Path) -> None:
    entries = [*GOOD, _doc("a", "docs/adr/0001-x.md")]
    errors = check.check_index(_repo(tmp_path, entries))
    assert any("slug en double" in e for e in errors)


def test_fichier_introuvable_refuse(tmp_path: Path) -> None:
    errors = check.check_index(_repo(tmp_path, [*GOOD, _doc("b", "docs/absent.md")]))
    assert any("introuvable" in e for e in errors)


@pytest.mark.parametrize("file", ["README.md", "docs/../README.md", "docs/a.txt"])
def test_fichier_hors_de_docs_ou_non_markdown_refuse(tmp_path: Path, file: str) -> None:
    errors = check.check_index(_repo(tmp_path, [*GOOD, _doc("b", file)]))
    assert any("sous docs/" in e for e in errors)


def test_section_inconnue_refusee(tmp_path: Path) -> None:
    errors = check.check_index(_repo(tmp_path, [_doc("a", "docs/a.md", "Divers"), *GOOD[1:]]))
    assert any("section inconnue" in e for e in errors)


def test_fichier_indexe_deux_fois_refuse(tmp_path: Path) -> None:
    errors = check.check_index(_repo(tmp_path, [*GOOD, _doc("b", "docs/a.md")]))
    assert any("déjà indexé" in e for e in errors)


def test_adr_non_indexee_refusee(tmp_path: Path) -> None:
    errors = check.check_index(_repo(tmp_path, GOOD[:1]))
    assert any("n'est pas indexée" in e for e in errors)


def test_champ_manquant_ou_en_trop_refuse(tmp_path: Path) -> None:
    bad = {"slug": "a", "title": "T", "section": "Architecture", "file": "docs/a.md"}
    assert check.check_index(_repo(tmp_path, [bad, *GOOD[1:]]))
    extra = {**GOOD[0], "auteur": "x"}
    assert check.check_index(_repo(tmp_path / "x", [extra, *GOOD[1:]]))


def test_json_invalide_refuse(tmp_path: Path) -> None:
    root = _repo(tmp_path, GOOD)
    (root / check.INDEX).write_text("[", encoding="utf-8")
    assert any("JSON invalide" in e for e in check.check_index(root))


@pytest.mark.parametrize(
    ("content", "label"),
    [
        ("contact : someone@example.org", "adresse e-mail"),
        ("le fichier de recitant_L", "identifiant de locuteur"),
        ("jeton hf_" + "a" * 30, "jeton ou clé"),
        ("verset " + " ".join(["كلمة"] * 9), "mots arabes"),
    ],
)
def test_contenu_interdit_dans_un_document_indexe_refuse(
    tmp_path: Path, content: str, label: str
) -> None:
    root = _repo(tmp_path, GOOD)
    (root / "docs" / "a.md").write_text(content, encoding="utf-8")
    assert any(label in e for e in check.check_index(root))


def test_quelques_mots_arabes_sont_tolerees(tmp_path: Path) -> None:
    root = _repo(tmp_path, GOOD)
    (root / "docs" / "a.md").write_text("exemple : " + " ".join(["كلمة"] * 8), encoding="utf-8")
    assert check.check_index(root) == []


# --- notes de version -------------------------------------------------------------------------


def _notes_errors(tmp_path: Path, notes: str) -> list[str]:
    return check.check_release_notes(_repo(tmp_path, GOOD, notes))


def test_notes_conformes_passent(tmp_path: Path) -> None:
    older = "\n## 2026-10-01 — Avant\nÉtiquettes : utilisateur, décision\nPR : #1, #2\n\nTexte.\n"
    assert _notes_errors(tmp_path, NOTES + older) == []


@pytest.mark.parametrize(
    ("notes", "fragment"),
    [
        ("Notes\n" + ENTRY, "première ligne"),
        (
            "# Notes de version\n\n## 22/10/2026 — Titre\nÉtiquettes : technique\nPR : -\n",
            "titre attendu",
        ),
        ("# Notes de version\n\n" + ENTRY.replace("technique", "bruit"), "étiquettes valides"),
        ("# Notes de version\n\n" + ENTRY.replace("PR : #1", "PR : 1"), "PR : #NN"),
        ("# Notes de version\n\n" + ENTRY.replace("Étiquettes", "Tags"), "Étiquettes"),
        ("# Notes de version\n\nrien\n", "aucune entrée"),
        (NOTES.replace("Du texte.", "<à compléter>"), "squelette non rempli"),
    ],
)
def test_notes_non_conformes_refusees(tmp_path: Path, notes: str, fragment: str) -> None:
    assert any(fragment in e for e in _notes_errors(tmp_path, notes))


def test_ordre_chronologique_inverse_exige(tmp_path: Path) -> None:
    newer_after_older = NOTES + "\n" + ENTRY.replace("2026-10-22", "2026-10-30")
    assert any("postérieure" in e for e in _notes_errors(tmp_path, newer_after_older))


# --- squelette d'entrée -----------------------------------------------------------------------


def test_le_squelette_est_insere_en_tete(tmp_path: Path) -> None:
    out = note.insert_entry(
        NOTES, note.build_entry("Nouveau", ["utilisateur"], [69], datetime.date(2026, 10, 23))
    )
    assert out.index("## 2026-10-23 — Nouveau") < out.index("## 2026-10-22 — Un titre")
    assert out.startswith("# Notes de version\n\n<!-- format -->")
    assert "Étiquettes : utilisateur\nPR : #69\n" in out


def test_le_squelette_non_rempli_est_refuse_puis_accepte_une_fois_complete(
    tmp_path: Path,
) -> None:
    out = note.insert_entry(
        NOTES,
        note.build_entry("Nouveau", ["technique", "décision"], [], datetime.date(2026, 10, 23)),
    )
    assert any("squelette" in e for e in _notes_errors(tmp_path, out))
    filled = out.replace(note.PLACEHOLDER + " (renvoyer", "Fait. (renvoyer")
    filled = filled.replace(note.PLACEHOLDER, "Un changement.")
    assert _notes_errors(tmp_path / "ok", filled) == []


def test_insertion_dans_un_fichier_sans_entree() -> None:
    entry = note.build_entry("Premier", ["technique"], [], datetime.date(2026, 1, 2))
    out = note.insert_entry("# Notes de version\n", entry)
    assert out.endswith(entry) and "PR : -\n" in out


@pytest.mark.parametrize(
    ("title", "tags"), [("", ["technique"]), ("T", []), ("T", ["bruit"]), ("T", ["technique"] * 2)]
)
def test_entree_invalide_refusee(title: str, tags: list[str]) -> None:
    with pytest.raises(ValueError):
        note.build_entry(title, tags, [], datetime.date(2026, 1, 2))


def test_parse_prs() -> None:
    assert note.parse_prs("69") == [69]
    assert note.parse_prs("#69, 70") == [69, 70]
    assert note.parse_prs("-") == []
    with pytest.raises(ValueError):
        note.parse_prs("abc")


def test_la_ligne_de_commande_ecrit_le_fichier(tmp_path: Path) -> None:
    target = tmp_path / "RELEASE-NOTES.md"
    target.write_text(NOTES, encoding="utf-8")
    code = note.main(
        [
            "Un essai",
            "--tags",
            "utilisateur",
            "--pr",
            "7",
            "--date",
            "2026-11-01",
            "--file",
            str(target),
        ]
    )
    assert code == 0
    assert target.read_text(encoding="utf-8").startswith(
        "# Notes de version\n\n<!-- format -->\n\n## 2026-11-01 — Un essai\n"
    )
    assert note.main(["x", "--tags", "bruit", "--file", str(target)]) == 2


# --- habitudes : modèles de PR et consignes ------------------------------------------------------

CASE_DOCUMENTATION = "- [ ] Notes de version / documentation mises à jour ("


@pytest.mark.parametrize(
    "template", ["docs/templates/pull-request.md", ".github/PULL_REQUEST_TEMPLATE.md"]
)
def test_les_deux_modeles_de_pr_portent_la_case_documentation(template: str) -> None:
    assert CASE_DOCUMENTATION in (ROOT / template).read_text(encoding="utf-8")


def test_les_consignes_des_agents_decrivent_la_documentation_vivante() -> None:
    agents = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
    section = agents.split("## Documentation vivante", 1)[1].split("\n## ", 1)[0]
    for needle in ("docs/RELEASE-NOTES.md", "docs/docs-index.json", "new_release_note.py"):
        assert needle in section, needle
