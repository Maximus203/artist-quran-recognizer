"""Calque de décisions humaines `aqr.decisions/1` (ADR-0014) : lecture stricte, empreinte
d'intervalle, décisions actives, réconciliation après une nouvelle analyse.

Aucune dépendance au corpus : le calque ne porte que des références, des plages de mots et des
temps.
"""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

import pytest

from aqr.decisions import (
    SCHEMA,
    Decision,
    DecisionsError,
    active_decisions,
    canonical_interval,
    decisions_digest,
    interval_fingerprint,
    parse_decisions,
    reconcile,
    target_key,
)

VECTORS = (
    Path(__file__).resolve().parents[1] / "fixtures" / "decisions" / "fingerprint-vectors.json"
)
SESSION = "5014015f-0000-4000-8000-000000000001"
PREDICTION = "9c41" + "0" * 60

UNCERTAIN = {
    "kind": "verse",
    "ref": "11:61",
    "words": [1, 10],
    "partial": True,
    "status": "uncertain",
    "t": [48.2, 62.6],
    "time_interpolated": False,
    "confidence": 0.75,
    "candidates": ["11:61", "7:73"],
    "repetition": False,
    "text": None,
    "translation": None,
}
RECOGNIZED = {
    "kind": "verse",
    "ref": "112:1",
    "words": [1, 4],
    "partial": False,
    "status": "recognized",
    "t": [1.0, 4.5],
    "candidates": [],
    "repetition": False,
}


def _decision(
    fingerprint: str | None = None,
    *,
    id_: str = "00000000-0000-4000-8000-000000000001",
    kind: str = "choose",
    value: dict | None = None,
    decided_at: str = "2026-10-23T14:02:11Z",
    revision: int = 1,
    review_ids: list[str] | None = None,
    withdrawn_at: str | None = None,
    superseded_by: str | None = None,
    index: int | None = 0,
) -> dict:
    fingerprint = interval_fingerprint(UNCERTAIN) if fingerprint is None else fingerprint
    return {
        "id": id_,
        "kind": kind,
        "target": {
            "fingerprint": fingerprint or None,
            "index": index,
            "snapshot": {"kind": "verse", "status": "uncertain", "ref": "11:61", "t": [48.2, 62.6]},
            "review_ids": review_ids or [],
        },
        "value": value if value is not None else {"ref": "11:61", "words": [1, 10]},
        "evidence": {"listened": True, "listened_s": 14.4, "device": "desktop"},
        "use_for_training": True,
        "decided_by": "cherif",
        "decided_at": decided_at,
        "revision": revision,
        "superseded_by": superseded_by,
        "withdrawn_at": withdrawn_at,
    }


def _document(*decisions: dict, training: bool = True) -> dict:
    return {
        "schema": SCHEMA,
        "session_id": SESSION,
        "prediction_sha256": PREDICTION,
        "consent": {"training": training, "by": "cherif", "at": "2026-10-23T14:00:00Z"},
        "revision": 3,
        "updated_at": "2026-10-23T14:02:11Z",
        "decisions": list(decisions),
    }


# --- empreinte ------------------------------------------------------------------------------


def test_la_forme_canonique_ne_garde_que_ce_que_le_moteur_a_dit() -> None:
    noisy = {**UNCERTAIN, "confidence": 0.1, "text": "x", "translation": {"text": "y"}}
    assert canonical_interval(noisy) == canonical_interval(UNCERTAIN)
    assert canonical_interval(UNCERTAIN) == {
        "candidates": ["11:61", "7:73"],
        "kind": "verse",
        "ref": "11:61",
        "status": "uncertain",
        "t": [48200, 62600],
        "words": [1, 10],
    }


def test_l_empreinte_est_le_sha256_du_json_canonique() -> None:
    text = json.dumps(
        canonical_interval(UNCERTAIN), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    assert interval_fingerprint(UNCERTAIN) == hashlib.sha256(text.encode("utf-8")).hexdigest()


@pytest.mark.parametrize(
    "change",
    [
        {"ref": "7:73"},
        {"words": [1, 9]},
        {"status": "recognized", "candidates": []},
        {"candidates": ["7:73", "11:61"]},  # l'ordre du moteur compte
        {"t": [48.201, 62.6]},
    ],
)
def test_toute_difference_de_ce_que_dit_le_moteur_change_l_empreinte(change: dict) -> None:
    assert interval_fingerprint({**UNCERTAIN, **change}) != interval_fingerprint(UNCERTAIN)


def test_les_temps_sont_arrondis_a_la_milliseconde_au_demi_vers_le_haut() -> None:
    # floor(x * 1000 + 0.5), identique en TypeScript : jamais l'arrondi bancaire de Python.
    assert canonical_interval({**UNCERTAIN, "t": [1.0005, 2.0015]})["t"] == [1001, 2002]
    assert canonical_interval({**UNCERTAIN, "t": [0.285, 1.005]})["t"] == [285, 1005]


def test_seul_un_verset_a_une_empreinte() -> None:
    with pytest.raises(DecisionsError):
        interval_fingerprint({"kind": "abstention", "reason": "silence", "t": [0.0, 1.0]})


def test_les_vecteurs_partages_avec_le_serveur_web() -> None:
    """Les mêmes vecteurs servent le test TypeScript : même empreinte dans les deux langages."""
    vectors = json.loads(VECTORS.read_text(encoding="utf-8"))
    assert len(vectors) >= 5
    for vector in vectors:
        assert interval_fingerprint(vector["interval"]) == vector["fingerprint"], vector["name"]


# --- lecture stricte ------------------------------------------------------------------------


def test_un_document_valide_se_lit() -> None:
    document = parse_decisions(_document(_decision()))
    assert document.session_id == SESSION and document.revision == 3
    assert document.consent.training is True and document.consent.by == "cherif"
    (decision,) = document.decisions
    assert decision.kind == "choose" and decision.value.ref == "11:61"
    assert decision.value.words == (1, 10) and decision.evidence.listened_s == 14.4
    assert decision.active and decision.target.fingerprint == interval_fingerprint(UNCERTAIN)


def test_un_document_vide_est_valide() -> None:
    assert parse_decisions(_document()).decisions == ()


@pytest.mark.parametrize(
    ("patch", "message"),
    [
        (lambda d: d.update(schema="aqr.decisions/2"), "schéma"),
        (lambda d: d.update(session_id="pas-un-uuid"), "session_id"),
        (lambda d: d["decisions"][0].update(kind="inventer"), "kind"),
        (lambda d: d["decisions"][0]["value"].update(ref="0:1"), "ref"),
        (lambda d: d["decisions"][0]["value"].update(ref="115:1"), "ref"),
        (lambda d: d["decisions"][0]["value"].update(ref="2:300"), "ref"),
        (lambda d: d["decisions"][0]["value"].update(words=[5, 2]), "words"),
        (lambda d: d["decisions"][0]["value"].update(words=[0, 2]), "words"),
        (lambda d: d["decisions"][0]["value"].pop("ref"), "ref"),
        (lambda d: d["decisions"][0]["target"].update(fingerprint="zz"), "fingerprint"),
        (lambda d: d["decisions"][0]["evidence"].update(listened_s=-1), "listened_s"),
        (lambda d: d["decisions"][0].update(id="a"), "id"),
        (lambda d: d["decisions"][0].update(decided_at="hier"), "decided_at"),
        (lambda d: d["decisions"][0].update(revision=0), "revision"),
        (lambda d: d["decisions"].append(copy.deepcopy(d["decisions"][0])), "en double"),
    ],
)
def test_un_document_incoherent_est_refuse(patch, message: str) -> None:
    raw = _document(_decision())
    patch(raw)
    with pytest.raises(DecisionsError, match=message):
        parse_decisions(raw)


@pytest.mark.parametrize(
    ("kind", "value"),
    [
        ("exclude", {"reason": "pas_une_raison"}),
        ("exclude", {}),
        ("translation_scope", {"scope": "tout"}),
        ("adjust_time", {}),
        ("adjust_time", {"t": [3.0, 3.0]}),
        ("choose", {"ref": "11:61", "words": [1, 10], "t": [-1.0, 3.0]}),
    ],
)
def test_la_valeur_depend_du_genre_de_decision(kind: str, value: dict) -> None:
    with pytest.raises(DecisionsError):
        parse_decisions(_document(_decision(kind=kind, value=value)))


@pytest.mark.parametrize(
    ("kind", "value"),
    [
        ("exclude", {"reason": "not_quran"}),
        ("exclude", {"reason": "not_heard"}),
        ("exclude", {"reason": "unwanted"}),
        ("translation_scope", {"scope": "fragment"}),
        ("adjust_time", {"t": [48.0, 63.0]}),
        ("confirm_inferred", {}),
        ("confirm_partial", {}),
        ("ignore", {}),
        ("dismiss_report", {}),
        ("set_ref", {"ref": "17:74", "words": [1, 13], "t": [10.0, 20.0]}),
    ],
)
def test_chaque_genre_de_decision_a_sa_valeur(kind: str, value: dict) -> None:
    (decision,) = parse_decisions(_document(_decision(kind=kind, value=value))).decisions
    assert decision.kind == kind


def test_une_cible_sans_empreinte_vise_un_signalement() -> None:
    review_id = "11111111-1111-4111-8111-111111111111"
    raw = _decision(
        "",
        kind="set_ref",
        value={"ref": "112:3", "words": [1, 4], "t": [30.0, 33.0]},
        review_ids=[review_id],
        index=None,
    )
    (decision,) = parse_decisions(_document(raw)).decisions
    assert decision.target.fingerprint is None and decision.target.review_ids == (review_id,)
    assert target_key(decision) == f"report:{review_id}"


def test_une_cible_sans_empreinte_ni_signalement_est_refusee() -> None:
    with pytest.raises(DecisionsError, match="cible"):
        parse_decisions(_document(_decision("", index=None)))


def test_un_signalement_sans_intervalle_ne_se_corrige_pas_par_un_choix() -> None:
    raw = _decision(
        "",
        kind="choose",
        review_ids=["11111111-1111-4111-8111-111111111111"],
        index=None,
    )
    with pytest.raises(DecisionsError, match="signalement"):
        parse_decisions(_document(raw))


def test_la_cible_d_une_correction_de_temps_ou_de_choix_exige_ses_temps_pour_un_signalement() -> (
    None
):
    raw = _decision(
        "",
        kind="set_ref",
        value={"ref": "112:3", "words": [1, 4]},
        review_ids=["11111111-1111-4111-8111-111111111111"],
        index=None,
    )
    with pytest.raises(DecisionsError, match="t"):
        parse_decisions(_document(raw))


# --- décisions actives ----------------------------------------------------------------------


def test_une_decision_annulee_ou_remplacee_n_est_pas_active() -> None:
    document = parse_decisions(
        _document(
            _decision(
                id_="00000000-0000-4000-8000-00000000000a", withdrawn_at="2026-10-23T15:00:00Z"
            ),
            _decision(
                id_="00000000-0000-4000-8000-00000000000b",
                superseded_by="00000000-0000-4000-8000-00000000000c",
            ),
            _decision(id_="00000000-0000-4000-8000-00000000000c"),
        )
    )
    assert [d.id[-1] for d in active_decisions(document)] == ["c"]


def test_deux_decisions_actives_sur_la_meme_cible_la_plus_recente_gagne() -> None:
    document = parse_decisions(
        _document(
            _decision(
                id_="00000000-0000-4000-8000-00000000000a", decided_at="2026-10-23T14:00:00Z"
            ),
            _decision(
                id_="00000000-0000-4000-8000-00000000000b", decided_at="2026-10-23T14:05:00Z"
            ),
        )
    )
    assert [d.id[-1] for d in active_decisions(document)] == ["b"]


def test_l_empreinte_des_decisions_ignore_les_annulees() -> None:
    kept = parse_decisions(_document(_decision()))
    with_withdrawn = parse_decisions(
        _document(
            _decision(),
            _decision(
                id_="00000000-0000-4000-8000-00000000000a",
                fingerprint=interval_fingerprint(RECOGNIZED),
                withdrawn_at="2026-10-23T15:00:00Z",
            ),
        )
    )
    assert decisions_digest(active_decisions(kept)) == decisions_digest(
        active_decisions(with_withdrawn)
    )
    assert decisions_digest(()) == hashlib.sha256(b"[]").hexdigest()


# --- réconciliation -------------------------------------------------------------------------


def _decisions(*raw: dict) -> list[Decision]:
    return list(parse_decisions(_document(*raw)).decisions)


def test_une_decision_se_retrouve_par_l_empreinte_de_son_intervalle() -> None:
    result = reconcile([RECOGNIZED, UNCERTAIN], _decisions(_decision(index=0)))
    # l'indice n'est qu'un indice : l'empreinte fait foi
    assert list(result.applied) == [1] and not result.orphans


def test_une_decision_dont_l_intervalle_a_change_devient_orpheline() -> None:
    moved = {**UNCERTAIN, "t": [48.5, 62.6]}
    result = reconcile([RECOGNIZED, moved], _decisions(_decision()))
    assert not result.applied and [d.id for d in result.orphans] == [
        "00000000-0000-4000-8000-000000000001"
    ]


def test_reconcilier_ne_modifie_rien() -> None:
    intervals = [copy.deepcopy(UNCERTAIN)]
    before = json.dumps(intervals, sort_keys=True)
    reconcile(intervals, _decisions(_decision()))
    assert json.dumps(intervals, sort_keys=True) == before


def test_une_decision_annulee_n_est_ni_appliquee_ni_orpheline() -> None:
    result = reconcile([UNCERTAIN], _decisions(_decision(withdrawn_at="2026-10-23T15:00:00Z")))
    assert not result.applied and not result.orphans and not result.reports


def test_les_decisions_de_signalement_sont_rendues_a_part() -> None:
    raw = _decision(
        "",
        kind="dismiss_report",
        value={},
        review_ids=["11111111-1111-4111-8111-111111111111"],
        index=None,
    )
    result = reconcile([UNCERTAIN], _decisions(raw))
    assert [d.kind for d in result.reports] == ["dismiss_report"]
    assert not result.applied and not result.orphans


def test_les_intervalles_qui_ne_sont_pas_des_versets_n_ont_pas_d_empreinte() -> None:
    abstention = {"kind": "abstention", "reason": "silence", "t": [0.0, 1.0], "best_score": None}
    result = reconcile([abstention, UNCERTAIN], _decisions(_decision(index=1)))
    assert list(result.applied) == [1]
