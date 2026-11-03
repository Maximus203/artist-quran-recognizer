"""Quels passages de la partie coranique sont ambigus (conception §3), selon ce qu'on exporte."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest
from tests.support.export_docs import (
    abstention,
    document,
    formula,
    fragment_translation,
    uncertain,
    verse,
)

from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.decisions import interval_fingerprint, parse_decisions
from aqr.domain.models import VerseRef
from aqr.export.analysis import Analysis, Context, ReviewNote, analyze, read_review
from aqr.export.options import ExportOptions
from aqr.rendering.passages import Passages

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"

pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "quran-uthmani.txt").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)

SESSION = "5014015f-0000-4000-8000-000000000001"


class FakeTranslations:
    """Traductions factices par verset : le texte d'un verset, ou rien (hors ligne)."""

    def __init__(self, texts: Mapping[str, str]) -> None:
        self._texts = texts

    def passage(self, ref: VerseRef, words: tuple[int, int] | None) -> Mapping[str, Any] | None:
        text = self._texts.get(str(ref))
        return None if text is None else {"text": text, "scope": "verse"}


@pytest.fixture(scope="module")
def passages() -> Passages:
    return Passages(TanzilCorpusRepository(CORPUS_DIR))


def ctx_of(
    passages: Passages,
    *,
    content: str = "ar_fr",
    show_ref: bool = False,
    texts: Mapping[str, str] | None = None,
    blocking: frozenset[str] = frozenset(),
) -> Context:
    return Context(
        passages=passages,
        options=ExportOptions(content=content, show_ref=show_ref),
        translations=None if texts is None else FakeTranslations(texts),
        blocking_tags=blocking,
    )


def decisions_of(*raw: dict[str, Any]) -> Any:
    return parse_decisions(
        {
            "schema": "aqr.decisions/1",
            "session_id": SESSION,
            "prediction_sha256": None,
            "consent": {"training": True, "by": "cherif", "at": "2026-10-23T14:00:00Z"},
            "revision": 1,
            "updated_at": "2026-10-23T14:00:00Z",
            "decisions": list(raw),
        }
    )


def decision_for(
    interval: dict[str, Any],
    item: str,
    kind: str,
    value: dict[str, Any],
    *,
    id_: str = "00000000-0000-4000-8000-000000000001",
) -> dict[str, Any]:
    return {
        "id": id_,
        "kind": kind,
        "target": {
            "fingerprint": interval_fingerprint(interval),
            "item": item,
            "index": None,
            "snapshot": {},
            "review_ids": [],
        },
        "value": value,
        "evidence": {"listened": True, "listened_s": 5.0, "device": "desktop"},
        "use_for_training": True,
        "decided_by": "cherif",
        "decided_at": "2026-10-23T14:02:11Z",
        "revision": 1,
    }


def only(analysis: Analysis, kind: str) -> list[Any]:
    return [i for i in analysis.items if i.type == kind]


TRANSLATIONS = {
    "11:61": "traduction A",
    "7:73": "traduction B",
    "55:13": "Lequel donc des bienfaits de votre Seigneur démentirez-vous ?",
    "55:16": "Lequel donc des bienfaits de votre Seigneur démentirez-vous ?",
}


# --- incertains : l'impact dépend de ce qu'on exporte ----------------------------------------


def test_un_signe_de_pause_qui_diffère_se_compte_a_part(passages):
    doc = document(uncertain("11:61", (1, 10), (48.2, 62.6), ["11:61", "7:73"]))
    (item,) = only(analyze(doc, None, [], ctx_of(passages, content="ar")), "uncertain")
    assert item.impact == "arabic_sign" and item.effective and item.state == "open"


def test_les_lettres_qui_different_comptent_en_arabe_seul(passages):
    doc = document(uncertain("112:2", (1, 2), (1.0, 3.0), ["112:2", "112:3"]))
    (item,) = only(analyze(doc, None, [], ctx_of(passages, content="ar")), "uncertain")
    assert item.impact == "arabic" and item.effective


def test_meme_arabe_et_meme_traduction_ne_bloque_rien_sauf_si_la_reference_est_affichee(passages):
    doc = document(uncertain("55:13", (1, 4), (10.0, 14.0), ["55:13", "55:16"]))
    quiet = analyze(doc, None, [], ctx_of(passages, texts=TRANSLATIONS))
    (item,) = only(quiet, "uncertain")
    assert item.impact == "reference" and not item.effective
    assert not quiet.unresolved and not quiet.counted
    shown = analyze(doc, None, [], ctx_of(passages, texts=TRANSLATIONS, show_ref=True))
    assert shown.unresolved and shown.unresolved[0].effective


def test_une_traduction_qui_diffère_ne_compte_que_si_la_traduction_est_exportee(passages):
    doc = document(uncertain("55:13", (1, 4), (10.0, 14.0), ["55:13", "55:16"]))
    texts = {"55:13": "A", "55:16": "B"}
    with_translation = analyze(doc, None, [], ctx_of(passages, texts=texts))
    assert with_translation.unresolved[0].impact == "translation"
    arabic_only = analyze(doc, None, [], ctx_of(passages, content="ar", texts=texts))
    assert not arabic_only.unresolved


def test_une_traduction_inconnue_est_comptee_par_prudence(passages):
    doc = document(uncertain("55:13", (1, 4), (10.0, 14.0), ["55:13", "55:16"]))
    offline = analyze(doc, None, [], ctx_of(passages, texts={}))
    assert offline.unresolved and offline.unresolved[0].impact == "translation"
    assert not analyze(doc, None, [], ctx_of(passages, content="ar", texts={})).unresolved


def test_changer_le_contenu_recompte(passages):
    doc = document(
        uncertain("11:61", (1, 10), (48.2, 62.6), ["11:61", "7:73"]),
        uncertain("55:13", (1, 4), (70.0, 74.0), ["55:13", "55:16"]),
    )
    both = analyze(doc, None, [], ctx_of(passages, texts=TRANSLATIONS))
    assert len(both.unresolved) == 1  # le signe de pause ; 55:13/55:16 sont identiques
    fr_only = analyze(doc, None, [], ctx_of(passages, content="fr", texts=TRANSLATIONS))
    assert len(fr_only.unresolved) == 1 and fr_only.unresolved[0].impact == "arabic_sign"


# --- supposés, coupures, approximations ------------------------------------------------------


def test_un_verset_suppose_est_a_verifier(passages):
    doc = document(verse("112:3", (1, 4), (30.0, 33.0), status="inferred"))
    (item,) = only(analyze(doc, None, [], ctx_of(passages)), "inferred")
    assert item.effective and item.state == "open"


def test_une_coupure_en_fin_de_verset_suivie_d_une_abstention(passages):
    doc = document(
        verse("17:74", (1, 3), (10.0, 14.0)),
        abstention((15.0, 18.0), "below_threshold"),
    )
    (item,) = only(analyze(doc, None, [], ctx_of(passages)), "cut")
    assert item.details["sides"] == ["end"]


@pytest.mark.parametrize(
    "after",
    [
        abstention((15.0, 18.0), "silence"),  # le lecteur s'arrête
        abstention((30.0, 33.0), "below_threshold"),  # trop loin : le décodeur ne fusionne plus
        formula("takbir", (15.0, 16.0)),
    ],
)
def test_pas_de_coupure_quand_le_lecteur_s_est_arrete(passages, after):
    doc = document(verse("17:74", (1, 3), (10.0, 14.0)), after)
    assert not only(analyze(doc, None, [], ctx_of(passages)), "cut")


def test_pas_de_coupure_en_fin_de_fichier_ni_pour_un_verset_complet(passages):
    assert not only(
        analyze(document(verse("17:74", (1, 3), (10.0, 14.0))), None, [], ctx_of(passages)), "cut"
    )
    full = document(verse("112:3", (1, 4), (10.0, 14.0)), abstention((15.0, 18.0)))
    assert not only(analyze(full, None, [], ctx_of(passages)), "cut")


def test_un_verset_partiel_suivi_du_verset_suivant_est_une_coupure(passages):
    doc = document(verse("112:2", (1, 1), (10.0, 12.0)), verse("112:3", (1, 4), (12.5, 15.0)))
    (item,) = only(analyze(doc, None, [], ctx_of(passages)), "cut")
    assert item.ref == "112:2" and item.details["sides"] == ["end"]


def test_un_verset_qui_continue_ou_qui_se_repete_n_est_pas_coupe(passages):
    continues = document(verse("17:74", (1, 3), (10.0, 14.0)), verse("17:74", (4, 9), (14.5, 20.0)))
    assert not only(analyze(continues, None, [], ctx_of(passages)), "cut")
    repeated = document(
        verse("17:74", (1, 3), (10.0, 14.0), repetition=True), abstention((15.0, 18.0))
    )
    assert not only(analyze(repeated, None, [], ctx_of(passages)), "cut")


def test_debut_manquant_apres_la_basmala_concatenee(passages):
    after_basmala = document(abstention((1.0, 4.0)), verse("112:1", (5, 8), (4.5, 8.0)))
    assert not only(analyze(after_basmala, None, [], ctx_of(passages)), "cut")
    missing = document(abstention((1.0, 4.0)), verse("112:1", (6, 8), (4.5, 8.0)))
    (item,) = only(analyze(missing, None, [], ctx_of(passages)), "cut")
    assert item.details["sides"] == ["start"]


def test_le_seuil_des_coupures_vient_du_json_jamais_du_code(passages):
    doc = document(
        verse("17:74", (1, 3), (10.0, 14.0)), abstention((15.0, 18.0)), merge_max_gap_s=0.5
    )
    assert not only(analyze(doc, None, [], ctx_of(passages)), "cut")
    unset = document(
        verse("17:74", (1, 3), (10.0, 14.0)), abstention((15.0, 18.0)), merge_max_gap_s=None
    )
    result = analyze(unset, None, [], ctx_of(passages))
    assert not only(result, "cut") and "merge_max_gap_s" in result.warnings[0]


def test_une_traduction_approximative_ne_concerne_que_la_traduction(passages):
    approx = fragment_translation("texte entier", "morceau", (9, 17), approximate=True)
    doc = document(verse("11:61", (9, 17), (10.0, 20.0), translation=approx))
    both = analyze(doc, None, [], ctx_of(passages))
    assert [i.type for i in both.unresolved] == ["approx"]
    assert not analyze(doc, None, [], ctx_of(passages, content="ar")).unresolved
    exact = fragment_translation("texte entier", "morceau", (9, 17), approximate=False)
    assert not only(
        analyze(
            document(verse("11:61", (9, 17), (10.0, 20.0), translation=exact)),
            None,
            [],
            ctx_of(passages),
        ),
        "approx",
    )


# --- ce qui ne compte jamais -----------------------------------------------------------------


def test_les_formules_et_les_abstentions_ne_comptent_jamais(passages):
    doc = document(
        formula("istiadha", (0.0, 3.0), label_ar="x"),
        formula("basmala", (3.5, 6.0), basmala=True, ref="1:1"),
        abstention((7.0, 9.0), "empty_transcript"),
        abstention((9.0, 12.0), "below_threshold"),
        verse("112:1", (5, 8), (12.5, 15.0)),
    )
    result = analyze(doc, None, [], ctx_of(passages))
    assert not result.items and result.formulas == 2 and result.abstentions == 2


def test_un_verset_reconnu_est_toujours_considere_sur(passages):
    doc = document(
        verse("112:1", (5, 8), (1.0, 4.0)),
        verse("112:2", (1, 2), (4.5, 6.0)),
        verse("112:3", (1, 4), (6.5, 9.0)),
        verse("112:4", (1, 5), (9.5, 12.0)),
    )
    assert not analyze(doc, None, [], ctx_of(passages)).items


# --- signalements de revue -------------------------------------------------------------------


def note(id_: str, start: float, end: float, *tags: str, status: str = "confirmed") -> dict:
    return {
        "id": id_,
        "start_s": start,
        "end_s": end,
        "tags": list(tags),
        "status": status,
        "tester": "amina",
        "description": "À revoir",
        "expected_ref": None,
    }


def review_of(*annotations: dict) -> list[ReviewNote]:
    return read_review({"annotations": list(annotations)})


N1 = "11111111-1111-4111-8111-111111111111"
N2 = "22222222-2222-4222-8222-222222222222"
N3 = "33333333-3333-4333-8333-333333333333"
BLOCKING = frozenset({"wrong_verse", "start_late"})


def test_seul_un_signalement_confirme_et_bloquant_compte(passages):
    doc = document(verse("112:3", (1, 4), (10.0, 14.0)))
    notes = review_of(
        note(N1, 11.0, 12.0, "wrong_verse", status="draft"),
        note(N2, 11.0, 12.0, "noise"),  # pas une ambiguïté de la partie arabe
        note(N3, 11.0, 12.0, "wrong_verse"),
    )
    result = analyze(doc, None, notes, ctx_of(passages, blocking=BLOCKING))
    (item,) = only(result, "report")
    assert item.review_ids == (N3,) and item.index == 0 and item.state == "open"


def test_les_signalements_d_un_meme_verset_ne_font_qu_un_passage(passages):
    doc = document(verse("112:3", (1, 4), (10.0, 14.0)))
    notes = review_of(note(N1, 11.0, 12.0, "wrong_verse"), note(N2, 12.5, 13.0, "start_late"))
    (item,) = only(analyze(doc, None, notes, ctx_of(passages, blocking=BLOCKING)), "report")
    assert item.review_ids == (N1, N2)


def test_un_signalement_pose_sur_un_passage_deja_a_verifier_lui_est_rattache(passages):
    doc = document(uncertain("11:61", (1, 10), (48.2, 62.6), ["11:61", "7:73"]))
    notes = review_of(note(N1, 50.0, 51.0, "wrong_verse"))
    result = analyze(doc, None, notes, ctx_of(passages, blocking=BLOCKING))
    assert [i.type for i in result.items] == ["uncertain"]
    assert result.items[0].related_reports == (N1,)


def test_un_signalement_hors_de_tout_intervalle_est_un_passage_seul(passages):
    doc = document(verse("112:3", (1, 4), (10.0, 14.0)))
    notes = review_of(note(N1, 40.0, 42.0, "wrong_verse"))
    (item,) = only(analyze(doc, None, notes, ctx_of(passages, blocking=BLOCKING)), "report")
    assert item.fingerprint is None and item.key == f"report:{N1}#report"


# --- état d'un passage selon les décisions ---------------------------------------------------


def test_une_decision_resout_le_passage_une_ignoree_sort_du_compteur(passages):
    interval = uncertain("11:61", (1, 10), (48.2, 62.6), ["11:61", "7:73"])
    doc = document(interval)
    chosen = decisions_of(
        decision_for(interval, "uncertain", "choose", {"ref": "11:61", "words": [1, 10]})
    )
    result = analyze(doc, chosen, [], ctx_of(passages))
    assert result.items[0].state == "resolved" and not result.unresolved
    ignored = decisions_of(decision_for(interval, "uncertain", "ignore", {}))
    result = analyze(doc, ignored, [], ctx_of(passages))
    assert result.items[0].state == "ignored" and not result.unresolved and result.ignored


def test_une_decision_orpheline_ne_resout_rien(passages):
    old = uncertain("11:61", (1, 10), (48.2, 62.6), ["11:61", "7:73"])
    moved = uncertain("11:61", (1, 10), (48.5, 62.6), ["11:61", "7:73"])
    stale = decisions_of(
        decision_for(old, "uncertain", "choose", {"ref": "11:61", "words": [1, 10]})
    )
    result = analyze(document(moved), stale, [], ctx_of(passages))
    assert result.items[0].state == "open" and len(result.orphans) == 1


def test_une_decision_sur_une_autre_sorte_de_passage_ne_resout_pas_celui_ci(passages):
    approx = fragment_translation("texte entier", "morceau", (9, 17), approximate=True)
    interval = verse("17:74", (2, 3), (10.0, 14.0), translation=approx)
    doc = document(interval, abstention((15.0, 18.0)))
    scoped = decisions_of(
        decision_for(interval, "approx", "translation_scope", {"scope": "fragment"})
    )
    result = analyze(doc, scoped, [], ctx_of(passages))
    # la coupure en fin de verset reste ouverte : la décision de traduction répond à une autre
    # question
    assert {i.type: i.state for i in result.items} == {"approx": "resolved", "cut": "open"}


def test_un_signalement_arrive_apres_la_decision_rouvre_le_passage(passages):
    interval = verse("112:3", (1, 4), (10.0, 14.0))
    doc = document(interval)
    raw = decision_for(interval, "report", "dismiss_report", {})
    raw["target"]["review_ids"] = [N1]
    decided = decisions_of(raw)
    first = analyze(
        doc,
        decided,
        review_of(note(N1, 11.0, 12.0, "wrong_verse")),
        ctx_of(passages, blocking=BLOCKING),
    )
    assert only(first, "report")[0].state == "resolved"
    later = review_of(note(N1, 11.0, 12.0, "wrong_verse"), note(N2, 12.5, 13.0, "start_late"))
    assert (
        only(analyze(doc, decided, later, ctx_of(passages, blocking=BLOCKING)), "report")[0].state
        == "open"
    )


def test_une_decision_sur_des_signalements_disparus_est_orpheline_et_n_ajoute_rien(passages):
    raw = decision_for(
        uncertain("11:61", (1, 10), (48.2, 62.6), ["11:61", "7:73"]),
        "report",
        "set_ref",
        {"ref": "112:3", "words": [1, 4], "t": [30.0, 33.0]},
    )
    raw["target"] = {
        "fingerprint": None,
        "item": "report",
        "index": None,
        "snapshot": {},
        "review_ids": [N1],
    }
    decided = decisions_of(raw)
    doc = document(verse("112:3", (1, 4), (10.0, 14.0)))
    gone = analyze(doc, decided, [], ctx_of(passages, blocking=BLOCKING))
    assert len(gone.orphans) == 1 and not gone.report_decisions
    alive = analyze(
        doc,
        decided,
        review_of(note(N1, 30.0, 33.0, "quran_undetected")),
        ctx_of(passages, blocking=frozenset({"quran_undetected"})),
    )
    assert not alive.orphans and len(alive.report_decisions) == 1


def test_l_analyse_ne_modifie_pas_le_document(passages):
    import copy
    import json

    doc = document(
        uncertain("11:61", (1, 10), (48.2, 62.6), ["11:61", "7:73"]), abstention((70.0, 72.0))
    )
    before = json.dumps(copy.deepcopy(doc), sort_keys=True)
    analyze(
        doc,
        None,
        review_of(note(N1, 50.0, 51.0, "wrong_verse")),
        ctx_of(passages, blocking=BLOCKING),
    )
    assert json.dumps(doc, sort_keys=True) == before
