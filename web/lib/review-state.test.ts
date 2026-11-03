import { describe, expect, it } from "vitest";
import { newAnnotation, type Annotation } from "./review";
import {
  addDraft,
  applyServer,
  cancelMark,
  commitAllRemovals,
  commitRemoval,
  confirmDraft,
  editAnnotation,
  emptyReview,
  keepDraft,
  loadReview,
  markListened,
  patchAnnotation,
  pendingWrites,
  removeAnnotation,
  selectAnnotation,
  startMark,
  toggleTag,
  undoRemoval,
  visibleAnnotations,
  type ReviewState,
} from "./review-state";

const T = (n: number) => `2026-10-22T10:${String(n).padStart(2, "0")}:00.000Z`;
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const make = (n: number, tester = "Awa", over: Partial<Annotation> = {}) => ({
  ...newAnnotation({
    id: uuid(n),
    tester,
    start: n * 10,
    end: n * 10 + 4,
    now: T(n),
  }),
  ...over,
});
const ctx = (editor = "Awa", minute = 30) => ({ now: T(minute), editor });

describe("addDraft", () => {
  it("ajoute un brouillon sélectionné, à envoyer, jamais écouté", () => {
    const state = addDraft(emptyReview(), make(1));
    expect(state.annotations).toHaveLength(1);
    expect(state.draftId).toBe(uuid(1));
    expect(state.selectedId).toBe(uuid(1));
    expect(state.mark).toBeNull();
    expect(state.listened[uuid(1)]).toBe(false);
    expect(Object.keys(state.dirty)).toEqual([uuid(1)]);
  });
  it("efface la pose en cours et la carte « enregistré »", () => {
    let state = startMark(emptyReview(), 10);
    state = { ...state, doneId: uuid(9) };
    state = addDraft(state, make(1));
    expect(state.mark).toBeNull();
    expect(state.doneId).toBeNull();
  });
  it("fait disparaître le brouillon vide précédent quand on passe à autre chose", () => {
    let state = addDraft(emptyReview(), make(1));
    state = addDraft(state, make(2));
    expect(state.annotations.map((a) => a.id)).toEqual([uuid(2)]);
    expect(state.deleted).toContain(uuid(1));
  });
  it("garde le brouillon précédent s'il porte une puce", () => {
    let state = addDraft(emptyReview(), make(1));
    state = toggleTag(state, uuid(1), "wrong_verse", ctx());
    state = addDraft(state, make(2));
    expect(state.annotations).toHaveLength(2);
    expect(state.deleted).toEqual([]);
  });
});

describe("startMark / cancelMark", () => {
  it("pose puis annule le début", () => {
    const state = startMark(emptyReview(), 101.2);
    expect(state.mark).toBe(101.2);
    expect(cancelMark(state).mark).toBeNull();
  });
});

describe("patchAnnotation", () => {
  it("met à jour, horodate et marque à envoyer", () => {
    let state = addDraft(emptyReview(), make(1));
    state = patchAnnotation(state, uuid(1), { description: "écho" }, ctx());
    const a = state.annotations[0];
    expect(a.description).toBe("écho");
    expect(a.updated_at).toBe(T(30));
    expect(state.dirty[uuid(1)]).toBeGreaterThan(1);
  });
  it("garde le nom du testeur d'origine et note qui modifie", () => {
    let state = addDraft(emptyReview(), make(1, "Moussa"));
    state = patchAnnotation(state, uuid(1), { description: "x" }, ctx("Awa"));
    expect(state.annotations[0].tester).toBe("Moussa");
    expect(state.annotations[0].updated_by).toBe("Awa");
  });
  it("n'écrit pas updated_by quand l'auteur modifie son propre signalement", () => {
    let state = addDraft(emptyReview(), make(1, "Awa"));
    state = patchAnnotation(state, uuid(1), { description: "x" }, ctx("Awa"));
    expect(state.annotations[0].updated_by).toBeUndefined();
  });
  it("une modification de plage remet « écouté » à faux", () => {
    let state = addDraft(emptyReview(), make(1));
    state = markListened(state, uuid(1));
    expect(state.listened[uuid(1)]).toBe(true);
    state = patchAnnotation(state, uuid(1), { start_s: 11 }, ctx());
    expect(state.listened[uuid(1)]).toBe(false);
  });
  it("ignore un identifiant inconnu", () => {
    const state = addDraft(emptyReview(), make(1));
    expect(patchAnnotation(state, uuid(9), { description: "x" }, ctx())).toBe(
      state,
    );
  });
});

describe("toggleTag", () => {
  it("coche puis décoche une puce et recalcule le type historique", () => {
    let state = addDraft(emptyReview(), make(1));
    state = toggleTag(state, uuid(1), "start_late", ctx());
    expect(state.annotations[0].tags).toEqual(["start_late"]);
    expect(state.annotations[0].type).toBe("timing");
    state = toggleTag(state, uuid(1), "start_late", ctx());
    expect(state.annotations[0].tags).toEqual([]);
    expect(state.annotations[0].type).toBe("other");
  });
  it("garde plusieurs puces dans l'ordre du choix", () => {
    let state = addDraft(emptyReview(), make(1));
    state = toggleTag(state, uuid(1), "missing_verse", ctx());
    state = toggleTag(state, uuid(1), "start_late", ctx());
    expect(state.annotations[0].tags).toEqual(["missing_verse", "start_late"]);
    expect(state.annotations[0].type).toBe("missing_verse");
  });
});

describe("confirmDraft", () => {
  it("refuse sans puce ni commentaire", () => {
    const state = addDraft(emptyReview(), make(1));
    const result = confirmDraft(state, uuid(1), ctx());
    expect(result.ok).toBe(false);
    expect(result.state.annotations[0].status).toBe("draft");
  });
  it("confirme avec une puce : carte « enregistré », plus de brouillon ouvert", () => {
    let state = addDraft(emptyReview(), make(1));
    state = toggleTag(state, uuid(1), "noise", ctx());
    const result = confirmDraft(state, uuid(1), ctx());
    expect(result.ok).toBe(true);
    expect(result.state.annotations[0].status).toBe("confirmed");
    expect(result.state.doneId).toBe(uuid(1));
    expect(result.state.draftId).toBeNull();
  });
  it("confirme avec un commentaire seul", () => {
    let state = addDraft(emptyReview(), make(1));
    state = patchAnnotation(state, uuid(1), { description: "Reprise" }, ctx());
    expect(confirmDraft(state, uuid(1), ctx()).ok).toBe(true);
  });
});

describe("keepDraft / editAnnotation / selectAnnotation", () => {
  it("garder en brouillon ferme le formulaire et supprime un brouillon vide", () => {
    const state = keepDraft(addDraft(emptyReview(), make(1)));
    expect(state.draftId).toBeNull();
    expect(state.annotations).toEqual([]);
  });
  it("modifier ouvre un signalement existant sans le dé-confirmer", () => {
    let state = loadReview([
      make(1, "Awa", { status: "confirmed", description: "x" }),
    ]);
    state = editAnnotation(state, uuid(1));
    expect(state.draftId).toBe(uuid(1));
    expect(state.annotations[0].status).toBe("confirmed");
    expect(state.selectedId).toBe(uuid(1));
  });
  it("sélectionner ne modifie rien d'autre", () => {
    const state = selectAnnotation(loadReview([make(1)]), uuid(1));
    expect(state.selectedId).toBe(uuid(1));
    expect(state.draftId).toBeNull();
    expect(selectAnnotation(state, null).selectedId).toBeNull();
  });
});

describe("suppression annulable", () => {
  const base = () =>
    loadReview([make(1, "Awa", { tags: ["noise"], status: "confirmed" })]);
  it("retire le signalement tout de suite mais ne demande pas encore au serveur", () => {
    const { state, removed } = removeAnnotation(base(), uuid(1));
    expect(removed?.id).toBe(uuid(1));
    expect(state.annotations).toEqual([]);
    expect(state.deleted).toEqual([]);
    expect(state.trash).toHaveLength(1);
    expect(pendingWrites(state).deleted).toEqual([]);
  });
  it("annuler le remet en place, à envoyer", () => {
    const { state } = removeAnnotation(base(), uuid(1));
    const restored = undoRemoval(state, uuid(1));
    expect(restored.annotations).toHaveLength(1);
    expect(restored.trash).toEqual([]);
    expect(restored.selectedId).toBe(uuid(1));
    expect(restored.dirty[uuid(1)]).toBeDefined();
  });
  it("après le délai, la suppression devient réelle", () => {
    const { state } = removeAnnotation(base(), uuid(1));
    const committed = commitRemoval(state, uuid(1));
    expect(committed.trash).toEqual([]);
    expect(pendingWrites(committed).deleted).toEqual([uuid(1)]);
  });
  it("tout valider d'un coup (fermeture de la page)", () => {
    let { state } = removeAnnotation(loadReview([make(1), make(2)]), uuid(1));
    state = removeAnnotation(state, uuid(2)).state;
    expect(pendingWrites(commitAllRemovals(state)).deleted.sort()).toEqual(
      [uuid(1), uuid(2)].sort(),
    );
  });
  it("supprimer le brouillon ouvert ferme le formulaire", () => {
    let state = addDraft(emptyReview(), make(1));
    state = removeAnnotation(state, uuid(1)).state;
    expect(state.draftId).toBeNull();
    expect(state.selectedId).toBeNull();
  });
  it("ignore un identifiant inconnu", () => {
    const { state, removed } = removeAnnotation(base(), uuid(9));
    expect(removed).toBeNull();
    expect(state.annotations).toHaveLength(1);
  });
});

describe("pendingWrites / applyServer (plusieurs testeurs)", () => {
  it("n'envoie que ce que ce testeur a modifié", () => {
    let state = loadReview([make(1, "Moussa"), make(2, "Cherif")]);
    expect(pendingWrites(state).annotations).toEqual([]);
    state = addDraft(state, make(3, "Awa"));
    const writes = pendingWrites(state);
    expect(writes.annotations.map((a) => a.id)).toEqual([uuid(3)]);
    expect(Object.keys(writes.versions)).toEqual([uuid(3)]);
  });

  it("après un envoi réussi, le travail des autres apparaît et plus rien n'est à envoyer", () => {
    let state = addDraft(loadReview([]), make(3, "Awa"));
    const writes = pendingWrites(state);
    state = applyServer(state, [make(3, "Awa"), make(1, "Moussa")], writes);
    expect(state.annotations.map((a) => a.id)).toEqual([uuid(1), uuid(3)]);
    expect(pendingWrites(state).annotations).toEqual([]);
  });

  it("une modification faite PENDANT l'envoi reste à envoyer et n'est pas écrasée", () => {
    let state = addDraft(loadReview([]), make(3, "Awa"));
    const writes = pendingWrites(state);
    state = patchAnnotation(
      state,
      uuid(3),
      { description: "plus tard" },
      ctx(),
    );
    state = applyServer(state, [make(3, "Awa")], writes);
    expect(state.annotations[0].description).toBe("plus tard");
    expect(pendingWrites(state).annotations.map((a) => a.id)).toEqual([
      uuid(3),
    ]);
  });

  it("un signalement supprimé par un autre testeur disparaît ici aussi", () => {
    let state = loadReview([make(1, "Moussa"), make(2, "Cherif")]);
    state = applyServer(state, [make(2, "Cherif")], {
      annotations: [],
      deleted: [],
      versions: {},
    });
    expect(state.annotations.map((a) => a.id)).toEqual([uuid(2)]);
  });

  it("ne ressuscite pas un signalement en attente de suppression annulable", () => {
    const loaded = loadReview([make(1)]);
    const { state } = removeAnnotation(loaded, uuid(1));
    const refreshed = applyServer(state, [make(1)], {
      annotations: [],
      deleted: [],
      versions: {},
    });
    expect(refreshed.annotations).toEqual([]);
  });

  it("retire des suppressions à envoyer celles que le serveur a prises en compte", () => {
    let { state } = removeAnnotation(loadReview([make(1)]), uuid(1));
    state = commitRemoval(state, uuid(1));
    const writes = pendingWrites(state);
    state = applyServer(state, [], writes);
    expect(pendingWrites(state).deleted).toEqual([]);
  });

  it("referme le brouillon ou la sélection dont le signalement a disparu", () => {
    let state = editAnnotation(loadReview([make(1, "Moussa")]), uuid(1));
    state = applyServer(state, [], {
      annotations: [],
      deleted: [],
      versions: {},
    });
    expect(state.draftId).toBeNull();
    expect(state.selectedId).toBeNull();
  });
});

describe("visibleAnnotations (filtres testeur et état)", () => {
  const state = loadReview([
    make(3, "Cherif", { status: "draft" }),
    make(1, "Awa", { status: "confirmed", tags: ["noise"] }),
    make(2, "Moussa", { status: "confirmed", tags: ["noise"] }),
  ]);
  it("trie par instant de début", () => {
    expect(
      visibleAnnotations(state, { tester: "all", state: "all" }).map(
        (a) => a.id,
      ),
    ).toEqual([uuid(1), uuid(2), uuid(3)]);
  });
  it("filtre par testeur et par état", () => {
    expect(
      visibleAnnotations(state, { tester: "Moussa", state: "all" }).map(
        (a) => a.id,
      ),
    ).toEqual([uuid(2)]);
    expect(
      visibleAnnotations(state, { tester: "all", state: "draft" }).map(
        (a) => a.id,
      ),
    ).toEqual([uuid(3)]);
    expect(
      visibleAnnotations(state, { tester: "Awa", state: "draft" }),
    ).toEqual([]);
  });
});

describe("types", () => {
  it("emptyReview est vide", () => {
    const state: ReviewState = emptyReview();
    expect(state.annotations).toEqual([]);
    expect(state.mark).toBeNull();
  });
});
