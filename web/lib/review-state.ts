/**
 * État de la revue humaine côté navigateur : les signalements, celui qu'on rédige, la pose en cours
 * et ce qui reste à envoyer au serveur. Tout est fonctionnel (état en entrée, état en sortie) :
 * aucune horloge, aucun réseau, aucun DOM, donc testable à froid. Le serveur fusionne par
 * identifiant (voir `mergeAnnotations`) ; le client n'envoie QUE ce qu'il a modifié, pour ne jamais
 * écraser le travail d'un autre testeur ni ressusciter ce qu'il a supprimé.
 */
import { canConfirm, type Annotation } from "./review";
import { legacyTypeOf } from "./review-presets";

export type ReviewState = {
  annotations: Annotation[];
  /** id → numéro de version locale : à envoyer. Le numéro protège une modification faite PENDANT un envoi. */
  dirty: Record<string, number>;
  /** Identifiants à supprimer côté serveur (suppression devenue définitive). */
  deleted: string[];
  /** Suppressions encore annulables (6 s) : retirées de l'écran, pas encore demandées au serveur. */
  trash: Annotation[];
  draftId: string | null;
  selectedId: string | null;
  /** Signalement qu'on vient de confirmer (affiche « Signalement enregistré »). */
  doneId: string | null;
  /** Début posé, en attente de la fin (bouton unique début → fin). */
  mark: number | null;
  listened: Record<string, boolean>;
  counter: number;
};

export type EditContext = { now: string; editor: string };
export type Writes = {
  annotations: Annotation[];
  deleted: string[];
  versions: Record<string, number>;
};

export const emptyReview = (): ReviewState => ({
  annotations: [],
  dirty: {},
  deleted: [],
  trash: [],
  draftId: null,
  selectedId: null,
  doneId: null,
  mark: null,
  listened: {},
  counter: 0,
});

const ordered = (list: Annotation[]): Annotation[] =>
  [...list].sort(
    (a, b) =>
      a.start_s - b.start_s ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );

const bump = (state: ReviewState, id: string): ReviewState => ({
  ...state,
  counter: state.counter + 1,
  dirty: { ...state.dirty, [id]: state.counter + 1 },
});

const find = (state: ReviewState, id: string): Annotation | undefined =>
  state.annotations.find((a) => a.id === id);

export const isEmptyDraft = (a: Annotation): boolean =>
  a.status === "draft" &&
  a.tags.length === 0 &&
  a.description.trim() === "" &&
  a.expected_ref === null;

/** Ouverture d'une session : on repart de ce que le serveur a. */
export const loadReview = (
  annotations: readonly Annotation[],
): ReviewState => ({
  ...emptyReview(),
  annotations: ordered([...annotations]),
});

function dropEmptyDraft(state: ReviewState): ReviewState {
  const draft = state.draftId ? find(state, state.draftId) : undefined;
  if (!draft || !isEmptyDraft(draft)) return state;
  const { [draft.id]: _gone, ...dirty } = state.dirty;
  void _gone;
  return {
    ...state,
    annotations: state.annotations.filter((a) => a.id !== draft.id),
    dirty,
    deleted: state.deleted.includes(draft.id)
      ? state.deleted
      : [...state.deleted, draft.id],
    draftId: null,
    selectedId: state.selectedId === draft.id ? null : state.selectedId,
  };
}

export const startMark = (
  state: ReviewState,
  position: number,
): ReviewState => ({
  ...state,
  mark: position,
});
export const cancelMark = (state: ReviewState): ReviewState => ({
  ...state,
  mark: null,
});

/** Nouveau brouillon : ouvert, sélectionné, enregistré dès la pose. */
export function addDraft(
  state: ReviewState,
  annotation: Annotation,
): ReviewState {
  const cleaned = dropEmptyDraft(state);
  return bump(
    {
      ...cleaned,
      annotations: ordered([...cleaned.annotations, annotation]),
      draftId: annotation.id,
      selectedId: annotation.id,
      doneId: null,
      mark: null,
      listened: { ...cleaned.listened, [annotation.id]: false },
    },
    annotation.id,
  );
}

export type AnnotationPatch = Partial<
  Pick<
    Annotation,
    | "start_s"
    | "end_s"
    | "tags"
    | "description"
    | "expected_ref"
    | "target_index"
    | "status"
  >
>;

export function patchAnnotation(
  state: ReviewState,
  id: string,
  patch: AnnotationPatch,
  context: EditContext,
): ReviewState {
  const current = find(state, id);
  if (!current) return state;
  const next: Annotation = { ...current, ...patch, updated_at: context.now };
  if (patch.tags)
    next.type = patch.tags.length > 0 ? legacyTypeOf(patch.tags) : "other";
  if (current.tester !== context.editor) next.updated_by = context.editor;
  const rangeMoved = patch.start_s !== undefined || patch.end_s !== undefined;
  const updated: ReviewState = {
    ...state,
    annotations: ordered(
      state.annotations.map((a) => (a.id === id ? next : a)),
    ),
    listened: rangeMoved ? { ...state.listened, [id]: false } : state.listened,
  };
  return bump(updated, id);
}

export function toggleTag(
  state: ReviewState,
  id: string,
  tag: string,
  context: EditContext,
): ReviewState {
  const current = find(state, id);
  if (!current) return state;
  const tags = current.tags.includes(tag)
    ? current.tags.filter((t) => t !== tag)
    : [...current.tags, tag];
  return patchAnnotation(state, id, { tags }, context);
}

export function confirmDraft(
  state: ReviewState,
  id: string,
  context: EditContext,
): { state: ReviewState; ok: boolean } {
  const current = find(state, id);
  if (!current || !canConfirm(current)) return { state, ok: false };
  const patched = patchAnnotation(state, id, { status: "confirmed" }, context);
  return {
    ok: true,
    state: {
      ...patched,
      doneId: id,
      draftId: patched.draftId === id ? null : patched.draftId,
      selectedId: id,
    },
  };
}

/** « Garder en brouillon » : ferme le formulaire ; un brouillon vide disparaît. */
export function keepDraft(state: ReviewState): ReviewState {
  return { ...dropEmptyDraft(state), draftId: null, doneId: null };
}

/** Ouvre un signalement existant pour le modifier (il reste confirmé). */
export function editAnnotation(state: ReviewState, id: string): ReviewState {
  if (!find(state, id)) return state;
  const cleaned = state.draftId === id ? state : dropEmptyDraft(state);
  return {
    ...cleaned,
    draftId: id,
    selectedId: id,
    doneId: null,
    mark: null,
  };
}

export const selectAnnotation = (
  state: ReviewState,
  id: string | null,
): ReviewState => ({ ...state, selectedId: id });

export const markListened = (state: ReviewState, id: string): ReviewState =>
  state.listened[id]
    ? state
    : { ...state, listened: { ...state.listened, [id]: true } };

/** Suppression annulable : retirée de l'écran, pas encore demandée au serveur. */
export function removeAnnotation(
  state: ReviewState,
  id: string,
): { state: ReviewState; removed: Annotation | null } {
  const removed = find(state, id) ?? null;
  if (!removed) return { state, removed: null };
  const { [id]: _gone, ...dirty } = state.dirty;
  void _gone;
  return {
    removed,
    state: {
      ...state,
      annotations: state.annotations.filter((a) => a.id !== id),
      trash: [...state.trash, removed],
      dirty,
      draftId: state.draftId === id ? null : state.draftId,
      selectedId: state.selectedId === id ? null : state.selectedId,
      doneId: state.doneId === id ? null : state.doneId,
    },
  };
}

export function undoRemoval(state: ReviewState, id: string): ReviewState {
  const restored = state.trash.find((a) => a.id === id);
  if (!restored) return state;
  return bump(
    {
      ...state,
      annotations: ordered([...state.annotations, restored]),
      trash: state.trash.filter((a) => a.id !== id),
      selectedId: id,
    },
    id,
  );
}

export function commitRemoval(state: ReviewState, id: string): ReviewState {
  if (!state.trash.some((a) => a.id === id)) return state;
  return {
    ...state,
    trash: state.trash.filter((a) => a.id !== id),
    deleted: state.deleted.includes(id)
      ? state.deleted
      : [...state.deleted, id],
  };
}

export const commitAllRemovals = (state: ReviewState): ReviewState =>
  state.trash.reduce((acc, a) => commitRemoval(acc, a.id), state);

/** Ce qu'il reste à envoyer : seulement ce que CE testeur a modifié ou supprimé. */
export function pendingWrites(state: ReviewState): Writes {
  const annotations = state.annotations.filter(
    (a) => state.dirty[a.id] !== undefined,
  );
  return {
    annotations,
    deleted: [...state.deleted],
    versions: Object.fromEntries(
      annotations.map((a) => [a.id, state.dirty[a.id]]),
    ),
  };
}

/**
 * Réponse du serveur (revue fusionnée de tous les testeurs). Ce qui a été envoyé et n'a pas bougé
 * depuis n'est plus « à envoyer » ; ce qui a bougé pendant l'envoi garde sa version locale ;
 * le travail des autres apparaît ; ce qu'on a retiré (annulable ou non) ne revient pas.
 */
export function applyServer(
  state: ReviewState,
  server: readonly Annotation[],
  sent: Writes,
): ReviewState {
  const dirty = { ...state.dirty };
  for (const [id, version] of Object.entries(sent.versions))
    if (dirty[id] === version) delete dirty[id];
  const deleted = state.deleted.filter((id) => !sent.deleted.includes(id));
  const hidden = new Set([...state.trash.map((a) => a.id), ...deleted]);
  const local = new Map(state.annotations.map((a) => [a.id, a]));
  const merged: Annotation[] = [];
  for (const remote of server) {
    if (hidden.has(remote.id)) continue;
    const mine = local.get(remote.id);
    merged.push(dirty[remote.id] !== undefined && mine ? mine : remote);
  }
  const known = new Set(server.map((a) => a.id));
  for (const [id, mine] of local)
    if (dirty[id] !== undefined && !known.has(id)) merged.push(mine);
  const ids = new Set(merged.map((a) => a.id));
  const keep = (id: string | null) => (id && ids.has(id) ? id : null);
  return {
    ...state,
    annotations: ordered(merged),
    dirty,
    deleted,
    draftId: keep(state.draftId),
    selectedId: keep(state.selectedId),
    doneId: keep(state.doneId),
  };
}

export type ReviewFilters = {
  tester: string;
  state: "all" | "draft" | "confirmed";
};

export function visibleAnnotations(
  state: ReviewState,
  filters: ReviewFilters,
): Annotation[] {
  return state.annotations.filter(
    (a) =>
      (filters.tester === "all" || a.tester === filters.tester) &&
      (filters.state === "all" || a.status === filters.state),
  );
}
