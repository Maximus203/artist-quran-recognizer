"""La vue fusionnée et les sous-titres : politique d'un export forcé, décisions, I1 et I2."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from tests.support.export_docs import abstention, document, formula, uncertain, verse
from tests.unit.test_export_analysis import decision_for, decisions_of, note, review_of

from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.domain.models import VerseRef
from aqr.export.analysis import Context, analyze
from aqr.export.cues import build_cues
from aqr.export.options import ExportOptions
from aqr.export.view import View, build_view
from aqr.rendering.passages import Passages

CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"

pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "quran-uthmani.txt").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)

TEXTS = {
    "112:1": "Dis : « Il est Allah, Unique.",
    "112:2": "Allah, le Seul à être imploré.",
    "112:3": "Il n'a jamais engendré, ni été engendré.",
    "112:4": "Et nul n'est égal à Lui.",
    "11:61": "Et aux Thamoud, leur frère Salih.",
    "7:73": "Et aux Thamoud, leur frère Salih (autre).",
    "55:13": "Lequel donc ?",
    "55:16": "Lequel donc ?",
}


class Translations:
    def passage(self, ref: VerseRef, words: tuple[int, int] | None) -> Mapping[str, Any] | None:
        text = TEXTS.get(str(ref))
        if text is None:
            return None
        return {"text": text, "translation_id": "french_hameedullah", "scope": "verse"}


@pytest.fixture(scope="module")
def corpus() -> TanzilCorpusRepository:
    return TanzilCorpusRepository(CORPUS_DIR)


def ctx_of(corpus: TanzilCorpusRepository, **options: Any) -> Context:
    return Context(
        passages=Passages(corpus), options=ExportOptions(**options), translations=Translations()
    )


def view_of(corpus, doc, decisions=None, **options) -> tuple[View, Context]:
    ctx = ctx_of(corpus, **options)
    analysis = analyze(doc, decisions, [], ctx)
    return build_view(doc, analysis, ctx), ctx


def arabic(corpus: TanzilCorpusRepository, ref: str, first: int, last: int) -> str:
    return Passages(corpus).text(VerseRef.parse(ref), first, last)


UNC = uncertain("112:2", (1, 2), (10.0, 14.0), ["112:2", "112:3"])
INF = verse("112:3", (1, 4), (20.0, 23.0), status="inferred")


# --- politique d'un export forcé -------------------------------------------------------------


def test_par_defaut_un_incertain_et_un_suppose_sont_omis(corpus):
    view, _ = view_of(corpus, document(UNC, INF), allow_unresolved=True)
    assert not view.entries
    assert [(o.type, o.reason) for o in view.omissions] == [
        ("uncertain", "uncertain"),
        ("inferred", "inferred"),
    ]
    assert view.forced and view.unresolved == 2 and view.policy == "omit"


def test_politique_marqueur(corpus):
    view, _ = view_of(corpus, document(UNC, INF), policy="marker", allow_unresolved=True)
    note, deduced = view.entries
    assert note.kind == "note" and note.label == "[incertain : 112:2 | 112:3]"
    assert deduced.prefix == "[déduit]"
    assert deduced.arabic_words and " ".join(deduced.arabic_words) == arabic(corpus, "112:3", 1, 4)


def test_un_marqueur_est_du_texte_latin_jamais_encadre_en_rtl(corpus):
    view, ctx = view_of(corpus, document(UNC), policy="marker", allow_unresolved=True)
    (cue,) = build_cues(view.entries, ctx).cues
    assert cue.arabic is None and cue.translation == ("[incertain : 112:2 | 112:3]",)


def test_les_points_de_suspension_d_un_fragment_ne_tombent_que_sur_une_ligne_pleine(corpus):
    ref = "112:4"
    n = len(corpus.words(VerseRef.parse(ref)))
    translation = {
        "text": "Et nul n'est égal à Lui.",
        "translation_id": "french_hameedullah",
        "scope": "fragment",
        "segments": [{"words": [1, 2], "text": "Et nul n'est"}],
        "fragment": {
            "words": [1, 2],
            "text": "Et nul n'est",
            "approximate": False,
            "ellipsis_before": False,
            "ellipsis_after": True,
        },
    }
    times = [(float(i * 4), float(i * 4 + 4)) for i in range(n)]
    interval = verse(ref, (1, n), (0.0, 4.0 * n), translation=translation, word_times=times)
    view, ctx = view_of(corpus, document(interval), max_s=8.0)
    cues = build_cues(view.entries, ctx).cues
    assert [c.translation for c in cues] == [("Et nul n'est …",), (), ()]


def test_politique_premier_candidat_ne_nomme_que_l_incertain(corpus):
    view, _ = view_of(corpus, document(UNC, INF), policy="first", allow_unresolved=True)
    first, deduced = view.entries
    assert first.ref == "112:2" and " ".join(first.arabic_words) == arabic(corpus, "112:2", 1, 2)
    assert deduced.prefix == "[déduit]"  # un supposé reste marqué, quelle que soit la politique


def test_un_incertain_dont_le_choix_ne_change_rien_est_exporte_avec_son_texte_commun(corpus):
    equal = uncertain("55:13", (1, 4), (10.0, 14.0), ["55:13", "55:16"])
    view, _ = view_of(corpus, document(equal), content="ar_fr")
    (entry,) = view.entries
    assert entry.origin == "engine" and not view.omissions
    assert " ".join(entry.arabic_words) == arabic(corpus, "55:13", 1, 4)
    # avec la référence affichée, le choix compte : omis tant qu'il n'est pas fait
    shown, _ = view_of(corpus, document(equal), show_ref=True, allow_unresolved=True)
    assert not shown.entries and shown.omissions[0].reason == "uncertain"


# --- décisions -------------------------------------------------------------------------------


def test_choisir_un_candidat_nomme_le_verset_avec_le_texte_du_corpus(corpus):
    decisions = decisions_of(
        decision_for(UNC, "uncertain", "choose", {"ref": "112:3", "words": [1, 4]})
    )
    view, _ = view_of(corpus, document(UNC), decisions)
    (entry,) = view.entries
    assert entry.ref == "112:3" and entry.origin == "human" and entry.words == (1, 4)
    assert " ".join(entry.arabic_words) == arabic(corpus, "112:3", 1, 4)  # I1 : lu dans le corpus
    assert entry.translation is not None and entry.translation["text"] == TEXTS["112:3"]  # I2
    assert view.unresolved == 0 and not view.forced


def test_confirmer_un_suppose_l_exporte_sans_marqueur(corpus):
    decisions = decisions_of(decision_for(INF, "inferred", "confirm_inferred", {"t": [20.5, 23.5]}))
    view, _ = view_of(corpus, document(INF), decisions)
    (entry,) = view.entries
    assert entry.prefix is None and (entry.start_s, entry.end_s) == (20.5, 23.5)


def test_exclure_omet_avec_la_raison(corpus):
    decisions = decisions_of(decision_for(UNC, "uncertain", "exclude", {"reason": "not_quran"}))
    view, _ = view_of(corpus, document(UNC), decisions)
    assert not view.entries
    assert (view.omissions[0].reason, view.omissions[0].detail) == ("excluded", "not_quran")


def test_ignorer_suit_la_politique_et_sort_du_compteur(corpus):
    decisions = decisions_of(decision_for(UNC, "uncertain", "ignore", {}))
    view, _ = view_of(corpus, document(UNC), decisions)
    assert view.omissions[0].reason == "uncertain" and view.unresolved == 0 and view.ignored == 1


def test_ajuster_le_temps_abandonne_les_temps_au_mot_mesures(corpus):
    interval = verse("112:2", (1, 2), (10.0, 14.0), word_times=[(10.0, 12.0), (12.0, 14.0)])
    plain, _ = view_of(corpus, document(interval))
    assert plain.entries[0].measured
    decisions = decisions_of(decision_for(interval, "report", "adjust_time", {"t": [10.5, 14.5]}))
    moved, _ = view_of(corpus, document(interval), decisions)
    assert moved.entries[0].start_s == 10.5 and not moved.entries[0].measured


def test_la_portee_de_la_traduction_est_une_decision_a_part(corpus):
    interval = verse("112:2", (1, 2), (10.0, 14.0))
    decisions = decisions_of(
        decision_for(interval, "approx", "translation_scope", {"scope": "none"})
    )
    view, ctx = view_of(corpus, document(interval), decisions)
    assert view.entries[0].scope == "none"
    (cue,) = build_cues(view.entries, ctx).cues
    assert cue.translation == ()


def test_un_verset_pose_sur_un_signalement_sans_intervalle_est_ajoute(corpus):
    doc = document(verse("112:1", (5, 8), (1.0, 4.0)))
    ctx = ctx_of(corpus)
    raw = decision_for(
        UNC, "report", "set_ref", {"ref": "112:3", "words": [1, 4], "t": [30.0, 33.0]}
    )
    raw["target"] = {
        "fingerprint": None,
        "item": "report",
        "index": None,
        "snapshot": {},
        "review_ids": ["11111111-1111-4111-8111-111111111111"],
    }
    notes = review_of(note("11111111-1111-4111-8111-111111111111", 30.0, 33.0, "quran_undetected"))
    analysis = analyze(doc, decisions_of(raw), notes, ctx)
    view = build_view(doc, analysis, ctx)
    assert [e.ref for e in view.entries] == ["112:1", "112:3"] and len(view.added) == 1


# --- formules --------------------------------------------------------------------------------


def test_la_basmala_est_le_verset_1_1_du_corpus_les_autres_formules_des_libelles(corpus):
    doc = document(
        formula("istiadha", (0.0, 3.0), label_ar="أعوذ بالله من الشيطان الرجيم"),
        formula("basmala", (3.5, 6.0), basmala=True, ref="1:1"),
        formula("takbir", (7.0, 8.0), label_ar="الله أكبر"),
        formula("french", (9.0, 12.0)),
    )
    only_basmala, _ = view_of(corpus, doc)
    (entry,) = only_basmala.entries
    assert entry.ref == "1:1" and " ".join(entry.arabic_words) == arabic(corpus, "1:1", 1, 4)
    every, _ = view_of(corpus, doc, formulas=["istiadha", "basmala", "takbir", "amin"])
    assert [e.label for e in every.entries if e.kind == "note"] == [
        "[أعوذ بالله من الشيطان الرجيم]",
        "[الله أكبر]",
    ]


def test_les_formules_n_ont_pas_de_libelle_arabe_en_traduction_seule(corpus):
    doc = document(formula("takbir", (7.0, 8.0), label_ar="الله أكبر"))
    view, _ = view_of(corpus, doc, content="fr", formulas=["takbir"])
    assert not view.entries


# --- sous-titres -----------------------------------------------------------------------------


def test_un_long_verset_est_coupe_aux_temps_mesures(corpus):
    ref = "112:4"
    n = len(corpus.words(VerseRef.parse(ref)))
    times = [(10.0 + i * 3.0, 13.0 + i * 3.0) for i in range(n)]  # 3 s par mot
    interval = verse(ref, (1, n), (10.0, 13.0 + (n - 1) * 3.0), word_times=times)
    view, ctx = view_of(corpus, document(interval), content="ar", max_s=7.0)
    build = build_cues(view.entries, ctx)
    assert len(build.cues) > 1 and build.split == 1
    assert all(c.end_s - c.start_s <= 7.0 + 3.0 for c in build.cues)  # un mot seul peut dépasser
    joined = " ".join(c.arabic or "" for c in build.cues)
    assert joined == arabic(corpus, ref, 1, n)  # rien de perdu, rien d'ajouté (I1)
    assert build.cues[0].start_s == 10.0 and build.cues[-1].end_s == interval["t"][1]
    assert not build.warnings


def test_la_coupe_sans_temps_mesures_est_proportionnelle_et_le_dit(corpus):
    interval = verse("2:255", (1, 50), (0.0, 40.0))
    view, ctx = view_of(corpus, document(interval), content="ar", max_s=10.0)
    build = build_cues(view.entries, ctx)
    assert len(build.cues) >= 4
    assert any("estimés" in w for w in build.warnings)


def test_la_traduction_suit_les_tranches_de_quranenc(corpus):
    ref = "112:4"
    n = len(corpus.words(VerseRef.parse(ref)))
    translation = {
        "text": "Et nul n'est égal à Lui.",
        "translation_id": "french_hameedullah",
        "scope": "verse",
        "segments": [
            {"words": [1, 2], "text": "Et nul n'est"},
            {"words": [3, n], "text": "égal à Lui."},
        ],
    }
    times = [(float(i * 4), float(i * 4 + 4)) for i in range(n)]
    interval = verse(ref, (1, n), (0.0, 4.0 * n), translation=translation, word_times=times)
    view, ctx = view_of(corpus, document(interval), max_s=8.0)
    cues = build_cues(view.entries, ctx).cues
    parts = [" ".join(c.translation) for c in cues if c.translation]
    assert (
        " ".join(parts) == "Et nul n'est égal à Lui."
    )  # les tranches rejointes redonnent le texte
    assert cues[0].translation == ("Et nul n'est",)


def test_duree_minimale_decalage_et_fusion_des_repetitions(corpus):
    a = verse("112:2", (1, 2), (10.0, 10.2))
    b = verse("112:2", (1, 2), (10.3, 10.4), repetition=True)
    c = verse("112:3", (1, 4), (20.0, 20.2))
    view, ctx = view_of(corpus, document(a, b, c), content="ar", min_s=1.0, repetitions="merge")
    cues = build_cues(view.entries, ctx).cues
    assert [(x.start_s, x.end_s) for x in cues] == [(10.0, 11.0), (20.0, 21.0)]
    kept, ctx2 = view_of(corpus, document(a, b, c), content="ar", min_s=0.0, offset_ms=-500)
    shifted = build_cues(kept.entries, ctx2).cues
    assert len(shifted) == 3 and shifted[0].start_s == 9.5


def test_le_karaoke_n_existe_qu_avec_des_temps_mesures(corpus):
    measured = verse("112:2", (1, 2), (10.0, 14.0), word_times=[(10.0, 12.0), (12.0, 14.0)])
    estimated = verse("112:3", (1, 4), (20.0, 24.0))
    view, ctx = view_of(corpus, document(measured, estimated), content="ar")
    one, two = build_cues(view.entries, ctx).cues
    assert len(one.words) == 2 and two.words == ()
    off, ctx_off = view_of(corpus, document(measured), content="ar", karaoke=False)
    assert build_cues(off.entries, ctx_off).cues[0].words == ()


def test_reference_notes_et_contenu(corpus):
    interval = verse(
        "112:2",
        (1, 2),
        (10.0, 14.0),
        translation={
            "text": "Allah, le Seul à être imploré.[1]",
            "translation_id": "french_hameedullah",
            "scope": "verse",
        },
    )
    view, ctx = view_of(corpus, document(interval), show_ref=True)
    (cue,) = build_cues(view.entries, ctx).cues
    assert cue.reference == "112:2" and cue.translation[0].endswith("[1]")  # gardé tel quel (I2)
    stripped, ctx2 = view_of(corpus, document(interval), strip_notes=True, content="fr")
    (cue2,) = build_cues(stripped.entries, ctx2).cues
    assert cue2.arabic is None and "[1]" not in " ".join(cue2.translation)


def test_la_vue_ne_modifie_pas_le_document(corpus):
    import copy
    import json

    doc = document(UNC, INF, abstention((30.0, 31.0)))
    before = json.dumps(copy.deepcopy(doc), sort_keys=True)
    view_of(corpus, doc, policy="marker", allow_unresolved=True)
    assert json.dumps(doc, sort_keys=True) == before


def test_options_immuables():
    options = ExportOptions()
    assert replace(options, content="ar").content == "ar" and options.content == "ar_fr"
