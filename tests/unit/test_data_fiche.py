"""Fiche d'accompagnement d'un enregistrement : schéma strict, erreurs lisibles."""

from __future__ import annotations

import pytest

from aqr.data.config import DataConfig
from aqr.data.fiche import FicheError, parse_fiche

CFG = DataConfig()


def _ok(**over: object) -> dict[str, object]:
    base: dict[str, object] = {
        "fichier": "2026-09-26_isha_mosquee-a.m4a",
        "categorie": ["C08", "C12"],
        "recitant": "imam_a",
        "riwaya": "hafs",
        "langues": ["ar"],
        "droits": "enregistré par moi, usage interne test",
    }
    base.update(over)
    return base


def test_fiche_valide_minimale():
    fiche = parse_fiche(_ok(), CFG)
    assert fiche.categorie == ("C08", "C12")
    assert fiche.recitant == "imam_a"
    assert fiche.lieu is None


def test_categorie_unique_en_chaine_acceptee():
    assert parse_fiche(_ok(categorie="C09"), CFG).categorie == ("C09",)


def test_champs_optionnels_conserves():
    fiche = parse_fiche(
        _ok(lieu="mosquée", contenu_approx="00:40 Fatiha", source="https://x.test"), CFG
    )
    assert fiche.lieu == "mosquée"
    assert fiche.source == "https://x.test"


@pytest.mark.parametrize(
    "field",
    ["fichier", "categorie", "recitant", "riwaya", "langues", "droits"],
)
def test_champ_obligatoire_manquant(field):
    data = _ok()
    del data[field]
    with pytest.raises(FicheError) as exc:
        parse_fiche(data, CFG)
    assert field in str(exc.value)


def test_cle_inconnue_refusee():
    with pytest.raises(FicheError, match="inconnue"):
        parse_fiche(_ok(recitnat="imam_a"), CFG)


def test_toutes_les_erreurs_sont_remontees_ensemble():
    with pytest.raises(FicheError) as exc:
        parse_fiche(_ok(categorie=["C99"], riwaya="warsh2", langues=[]), CFG)
    problems = exc.value.problems
    assert len(problems) == 3
    assert any("C99" in p for p in problems)
    assert any("riwaya" in p for p in problems)
    assert any("langues" in p for p in problems)


def test_recitant_doit_etre_un_identifiant_anonyme():
    with pytest.raises(FicheError, match="recitant"):
        parse_fiche(_ok(recitant="Cheikh Abdoulaye Diop"), CFG)


def test_un_yaml_qui_n_est_pas_un_dictionnaire_est_refuse():
    with pytest.raises(FicheError):
        parse_fiche(["pas", "un", "dict"], CFG)  # type: ignore[arg-type]
