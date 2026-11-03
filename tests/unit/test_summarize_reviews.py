"""Triage des revues humaines (scripts/summarize_reviews.py) : logique pure, sans audio ni modèle.

Un signalement de revue (`aqr.review/2`) est un temps, une plage, des puces et un commentaire ; le
script y joint ce que le moteur avait fait là (intervalles voisins, vérifications acoustiques) pour
transformer la revue en cas de test.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def _module():
    spec = importlib.util.spec_from_file_location(
        "summarize_reviews", ROOT / "scripts" / "summarize_reviews.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # requis par @dataclass
    spec.loader.exec_module(module)
    return module


S = _module()


def verse(ref, words, t, status="recognized", **extra):
    return {
        "kind": "verse",
        "ref": ref,
        "words": words,
        "status": status,
        "t": t,
        "repetition": False,
        "confidence": 0.75,
        **extra,
    }


def abstention(t, reason="below_threshold", score=0.47):
    return {"kind": "abstention", "reason": reason, "t": t, "best_score": score}


PREDICTION = {
    "schema": "aqr.recognition/1",
    "intervals": [
        verse("12:20", [1, 9], [531.66, 552.7]),
        abstention([555.755, 577.77]),
        verse("12:21", [13, 23], [578.27, 607.63]),
        verse("17:73", [1, 10], [610.82, 636.98], promoted_by="neighbor"),
        verse("1:1", [2, 4], [2.23, 9.51], status="uncertain", candidates=["1:1", "6:45"]),
    ],
    "acoustic_checks": [
        {
            "kind": "head",
            "t": [555.755, 577.77],
            "verses": "12:21[1-2]",
            "llr_per_frame": -0.479,
            "accepted": False,
            "text_similarity": 0.2917,
        },
        {
            "kind": "chain",
            "t": [1.43, 30.9],
            "verses": "1:1[2-4],1:2[1-4]",
            "llr_per_frame": -0.2491,
            "accepted": True,
        },
    ],
}


def annotation(start, end, tags, description="", **extra):
    return {
        "id": "58cefeb6-85c0-4347-84c8-ca387a9506f0",
        "mode": "point" if end is None else "range",
        "start_s": start,
        "end_s": end,
        "tags": tags,
        "type": "missing_verse",
        "description": description,
        "expected_ref": "12:21",
        "target_index": None,
        "status": "confirmed",
        "tester": "Cherif",
        **extra,
    }


def write_session(root: Path, name: str, annotations, prediction=PREDICTION) -> Path:
    folder = root / name
    folder.mkdir()
    (folder / "session.json").write_text(json.dumps({"id": name, "name": f"{name}.mp3"}))
    (folder / "prediction.recognition.json").write_text(json.dumps(prediction))
    review = {"schema": "aqr.review/2", "session_id": name, "annotations": annotations}
    (folder / "review.json").write_text(json.dumps(review))
    return folder


# --- Les intervalles et les vérifications qui recouvrent un signalement ---------------------------
def test_les_intervalles_voisins_d_une_plage_sont_ceux_qui_la_recouvrent_a_la_marge_pres():
    ann = annotation(555.8, 582.5, ["missing_verse"])
    near = S.neighbours(PREDICTION["intervals"], ann, margin_s=3.5)
    assert [(i, iv["kind"]) for i, iv in near] == [(0, "verse"), (1, "abstention"), (2, "verse")]
    far = S.neighbours(PREDICTION["intervals"], ann, margin_s=0.0)
    assert [i for i, _ in far] == [1, 2]  # le verset précédent finit avant la plage


def test_un_point_est_une_plage_de_largeur_nulle():
    ann = annotation(560.0, None, ["other"])
    assert [i for i, _ in S.neighbours(PREDICTION["intervals"], ann, margin_s=0.0)] == [1]


def test_les_verifications_acoustiques_qui_recouvrent_le_signalement():
    ann = annotation(555.8, 582.5, ["missing_verse"])
    (check,) = S.overlapping_checks(PREDICTION["acoustic_checks"], ann, margin_s=0.0)
    assert check["kind"] == "head" and check["accepted"] is False


# --- Rendu ----------------------------------------------------------------------------------------
def test_le_rendu_montre_statut_ref_mots_repetition_et_promotion():
    ann = annotation(2.0, 12.0, ["missing_verse"])
    text = S.render_annotation("lot3-04", ann, PREDICTION, margin_s=1.0, tester="T1")
    assert "1:1 [2-4] uncertain" in text
    assert "t=[2.23, 9.51]" in text
    assert "candidats 1:1, 6:45" in text
    assert "chain" in text and "llr -0.2491" in text and "accepté" in text


def test_une_abstention_est_montree_avec_sa_raison_et_son_meilleur_score():
    text = S.render_annotation("s", annotation(555.8, 582.5, ["x"]), PREDICTION, 1.0, "T1")
    assert "abstention below_threshold" in text and "0.47" in text
    assert "12:21 [13-23] recognized" in text


def test_promoted_by_et_repetition_sont_visibles():
    prediction = {
        "intervals": [verse("17:76", [1, 13], [753.0, 780.0], promoted_by="gap", repetition=True)]
    }
    text = S.render_annotation("s", annotation(755.0, 760.0, ["x"]), prediction, 0.0, "T1")
    assert "repetition" in text and "promoted_by=gap" in text


def test_les_verifications_de_trou_montrent_leur_role_et_leurs_preuves():
    prediction = {
        "intervals": [],
        "acoustic_checks": [
            {
                "kind": "gap",
                "role": "between",
                "t": [552.7, 578.27],
                "verses": "12:21[1-12]",
                "llr_per_frame": -0.3864,
                "passage_llr_per_frame": -0.3292,
                "text_similarity": 0.7191,
                "words": 12,
                "weak_words": 1,
                "accepted": True,
            }
        ],
    }
    text = S.render_annotation("s", annotation(555.8, 582.5, ["x"]), prediction, 0.0, "T1")
    assert "gap/between" in text and "12:21[1-12]" in text and "sim 0.7191" in text
    assert "mots 12" in text and "faibles 1" in text


# --- Groupement par puces, identité des testeurs --------------------------------------------------
def test_les_signalements_sont_groupes_par_puce_principale(tmp_path):
    write_session(
        tmp_path,
        "a",
        [
            annotation(1.0, 5.0, ["missing_verse", "start_late"]),
            annotation(10.0, 12.0, ["repetition_missed"]),
            annotation(20.0, None, []),
        ],
    )
    report = S.report(tmp_path, margin_s=1.0, console=True)
    order = [
        report.index(f"== {tag}") for tag in ("(sans puce)", "missing_verse", "repetition_missed")
    ]
    assert order == sorted(order)  # ordre alphabétique, « sans puce » d'abord
    assert "start_late" in report  # les puces secondaires restent visibles sur la ligne
    assert (
        "== start_late" not in report
    )  # mais un signalement n'est listé que sous sa puce principale


def test_la_console_montre_un_pseudonyme_stable_jamais_le_nom(tmp_path):
    write_session(tmp_path, "a", [annotation(1.0, 5.0, ["x"], tester="Cherif")])
    first = S.report(tmp_path, margin_s=1.0, console=True)
    again = S.report(tmp_path, margin_s=1.0, console=True)
    assert "Cherif" not in first and first == again
    assert "testeur T" in first


def test_le_rapport_ecrit_dans_un_fichier_ne_contient_aucune_identite(tmp_path):
    write_session(tmp_path, "a", [annotation(1.0, 5.0, ["x"], tester="Cherif", updated_by="Awa")])
    text = S.report(tmp_path, margin_s=1.0, console=False)
    assert "Cherif" not in text and "Awa" not in text and "testeur" not in text


def test_le_commentaire_est_conserve(tmp_path):
    write_session(tmp_path, "a", [annotation(1.0, 5.0, ["x"], "Le début n'est pas reconnu.")])
    assert "Le début n'est pas reconnu." in S.report(tmp_path, margin_s=1.0, console=False)


def test_seules_les_sessions_avec_revue_sont_lues(tmp_path):
    write_session(tmp_path, "avec", [annotation(1.0, 5.0, ["x"])])
    (tmp_path / "sans").mkdir()
    (tmp_path / "sans" / "session.json").write_text("{}")
    assert "avec" in S.report(tmp_path, margin_s=1.0, console=False)
    assert "sans" not in S.report(tmp_path, margin_s=1.0, console=False)


def test_les_brouillons_sont_ignores_si_demande(tmp_path):
    write_session(
        tmp_path, "a", [annotation(1.0, 5.0, ["x"]), annotation(9.0, 10.0, ["y"], status="draft")]
    )
    everything = S.report(tmp_path, margin_s=1.0, console=False)
    confirmed = S.report(tmp_path, margin_s=1.0, console=False, only_confirmed=True)
    assert "== y" in everything and "== y" not in confirmed


def test_sans_prediction_le_signalement_est_tout_de_meme_liste(tmp_path):
    folder = write_session(tmp_path, "a", [annotation(1.0, 5.0, ["x"])])
    (folder / "prediction.recognition.json").unlink()
    assert "aucune prédiction" in S.report(tmp_path, margin_s=1.0, console=False)


def test_un_dossier_sans_revue_donne_un_rapport_vide_clair(tmp_path):
    assert "aucun signalement" in S.report(tmp_path, margin_s=1.0, console=False)


def test_main_ecrit_le_fichier_sans_identite_et_la_console_avec_pseudonyme(tmp_path, capsys):
    write_session(tmp_path, "a", [annotation(1.0, 5.0, ["x"], tester="Cherif")])
    target = tmp_path / "rapport.txt"
    assert S.main([str(tmp_path), "--out", str(target)]) == 0
    assert "Cherif" not in target.read_text(encoding="utf-8")
    assert capsys.readouterr().out == ""
    assert S.main([str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "Cherif" not in out and "testeur T" in out


def test_main_refuse_un_dossier_absent(tmp_path):
    with pytest.raises(SystemExit):
        S.main([str(tmp_path / "nulle-part")])
