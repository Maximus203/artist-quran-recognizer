"""Cohérence documentaire : chemins `docs/...` cités, décision d'usage, libellé de licence.

Ces tests lisent seulement des fichiers du dépôt (aucun réseau, aucun audio). Ils empêchent un
document de pointer vers une page disparue, et la décision d'usage de dériver de sa trace
(`.artist/decision-log.md`) ou de la fiche des droits du lot 1.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
PROTOCOLE = "docs/evaluation/protocole-reglage-evaluation.md"
PROVENANCE = "docs/data-lots/ref-corpus-provenance.md"
RIGHTS = "docs/data-lots/RIGHTS.md"
LOT1_MANIFEST = "tests/fixtures/audio/manifest.yaml"
DECISION_LOG = ".artist/decision-log.md"

DOCS = (PROTOCOLE, PROVENANCE, RIGHTS, "docs/evaluation/normalisation.md")
STATUT = "provisoire — en attente de confirmation écrite du mainteneur"
LIBELLE_CANONIQUE = (
    "droits non établis : usage interne d'évaluation uniquement, jamais redistribué "
    "(docs/data-lots/ref-corpus-provenance.md)"
)
_DOC_PATH = re.compile(r"docs/[\w./-]*\w")


def _read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def _flat(text: str) -> str:
    return " ".join(text.split())


def _section(text: str, heading: str) -> str:
    assert heading in text, f"section absente : {heading}"
    return text.split(heading, 1)[1].split("\n## ", 1)[0]


@pytest.mark.parametrize("doc", DOCS)
def test_les_chemins_docs_cites_existent(doc: str) -> None:
    missing = sorted(p for p in set(_DOC_PATH.findall(_read(doc))) if not (ROOT / p).exists())
    assert not missing, f"{doc} cite des chemins introuvables : {missing}"


@pytest.mark.parametrize("doc", [PROTOCOLE, PROVENANCE])
def test_le_controle_des_chemins_voit_bien_des_citations(doc: str) -> None:
    assert _DOC_PATH.findall(_read(doc)), "l'expression de recherche ne trouve plus rien"


def test_la_decision_d_usage_est_explicite_et_provisoire() -> None:
    section = _section(_read(PROVENANCE), "## Décision d'usage")
    assert STATUT in section
    for heading in ("### Qui décide", "### Permis provisoirement", "### Interdit", "### Portée"):
        assert heading in section, heading
    for subject in ("EveryAyah", "Hugging Face", "lot 1", "RetaSy", "hors dépôt"):
        assert subject in section, subject


def test_la_decision_d_usage_est_tracee_dans_le_journal_de_decisions() -> None:
    entry = _section(_read(DECISION_LOG), "## 2026-10-09 — Décision d'usage des audios")
    assert STATUT in entry
    assert PROVENANCE in entry


def test_le_lot_1_n_est_pas_un_precedent() -> None:
    rights, provenance = _flat(_read(RIGHTS)), _flat(_read(PROVENANCE))
    assert PROVENANCE in rights and "Décision d'usage" in rights
    assert "pas un précédent" in rights and "pas un précédent" in provenance
    assert "ref-corpus-provenance.md" in _read("docs/data-lots/lot-1.yaml")
    protocole = _flat(_read(PROTOCOLE))
    assert "reste la référence de généralisation" not in protocole
    assert "pas une référence acquise" in protocole


def test_le_protocole_decrit_la_quarantaine_et_sa_trace() -> None:
    protocole = _read(PROTOCOLE)
    assert "quarantaine" in _section(protocole, "## Règles de réglage")
    assert "DataConfig.quarantine_split" in protocole
    assert "Quarantaine" in _read(DECISION_LOG)


def test_chaque_libelle_de_licence_du_lot_est_documente() -> None:
    provenance = _read(PROVENANCE)
    assert LIBELLE_CANONIQUE in _section(provenance, "## Libellé de licence canonique")
    manifest = yaml.safe_load(_read(LOT1_MANIFEST))
    labels = {case["license"] for case in manifest["cases"]}
    undocumented = sorted(label for label in labels if label not in provenance)
    assert not undocumented, f"libellés de licence non documentés : {undocumented}"
