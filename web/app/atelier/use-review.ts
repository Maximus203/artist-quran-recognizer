"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatTenths } from "@/lib/format";
import {
  moveEdge,
  nudgeEdge,
  pressMark,
  roundTenth,
  type Selection,
} from "@/lib/marking";
import { rejectedMessage } from "@/lib/review-access";
import { REVIEW_SCHEMA, newAnnotation, type Annotation } from "@/lib/review";
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
  type ReviewFilters,
  type ReviewState,
} from "@/lib/review-state";

export type SaveStatus = "idle" | "saving" | "saved" | "error";
export type ToastAction = { label: string; run: () => void };

const SAVE_DELAY_MS = 500;
const REFRESH_MS = 15_000;
export const UNDO_MS = 6000;

type Options = {
  session: {
    id: string;
    audio_sha256: string;
    prediction_sha256: string | null;
  } | null;
  /** Signalements connus du serveur à l'ouverture de la session. */
  initial: readonly Annotation[] | null;
  /** Pseudonyme du compte connecté : l'auteur de chaque signalement posé ici. */
  tester: string;
  /** Un signalement de quelqu'un d'autre ne se modifie pas (sauf administrateur) : le serveur le refuse. */
  canModify: (annotation: Annotation) => boolean;
  duration: number;
  getPosition: () => number;
  /** Index de l'intervalle du moteur à cet instant (cible du signalement). */
  targetAt: (time: number) => number | null;
  announce: (text: string) => void;
  toast: (text: string, action?: ToastAction) => void;
  /** Un signalement vient d'être posé : ouvre le panneau. */
  reveal: () => void;
};

/**
 * Contrôleur de la revue humaine : pose (début → fin, point, tracé), brouillon enregistré dès la
 * pose, modification, suppression annulable, fusion avec les autres testeurs. La logique d'état est
 * dans `lib/review-state.ts` (pure, testée) ; ce hook ne fait que la brancher au réseau et à l'horloge.
 */
export function useReviewController(options: Options) {
  const opts = useRef(options);
  opts.current = options;
  const [state, setState] = useState<ReviewState>(emptyReview);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [save, setSave] = useState<SaveStatus>("idle");
  const [filters, setFilters] = useState<ReviewFilters>({
    tester: "all",
    state: "all",
  });
  const [trace, setTraceState] = useState(false);
  const [loop, setLoop] = useState(false);
  const inFlight = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const immediate = useRef(false);
  const undoTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const sessionId = options.session?.id ?? null;

  // Ouverture d'une session : on repart de ce que le serveur a.
  useEffect(() => {
    setState(loadReview(opts.current.initial ?? []));
    setSave("idle");
    setTraceState(false);
    setLoop(false);
    setFilters({ tester: "all", state: "all" });
    for (const t of undoTimers.current.values()) clearTimeout(t);
    undoTimers.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const ctx = useCallback(
    () => ({
      now: new Date().toISOString(),
      editor: opts.current.tester,
    }),
    [],
  );

  const send = useCallback(
    async (keepalive = false, writes = pendingWrites(stateRef.current)) => {
      const session = opts.current.session;
      if (!session) return;
      const response = await fetch(`/api/sessions/${session.id}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        keepalive,
        body: JSON.stringify({
          schema: REVIEW_SCHEMA,
          session_id: session.id,
          audio_sha256: session.audio_sha256,
          prediction_sha256: session.prediction_sha256,
          annotations: writes.annotations,
          deleted_ids: writes.deleted,
          updated_at: new Date().toISOString(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Sauvegarde impossible");
      const refused = rejectedMessage(
        Array.isArray(data.rejected) ? data.rejected.length : 0,
      );
      if (refused) opts.current.toast(refused);
      return { writes, merged: data.review.annotations as Annotation[] };
    },
    [],
  );

  const flush = useCallback(async () => {
    if (inFlight.current) {
      again.current = true;
      return;
    }
    const writes = pendingWrites(stateRef.current);
    if (writes.annotations.length === 0 && writes.deleted.length === 0) return;
    inFlight.current = true;
    setSave("saving");
    try {
      const sent = await send(false, writes);
      if (sent) {
        setState((current) => applyServer(current, sent.merged, sent.writes));
        setSave("saved");
      }
    } catch {
      setSave("error");
    } finally {
      inFlight.current = false;
      if (again.current) {
        again.current = false;
        void flush();
      }
    }
  }, [send]);

  // Enregistrement automatique : 500 ms après la dernière modification, tout de suite à la pose.
  useEffect(() => {
    if (!sessionId) return;
    const writes = pendingWrites(state);
    if (writes.annotations.length === 0 && writes.deleted.length === 0) return;
    setSave("saving");
    const delay = immediate.current ? 0 : SAVE_DELAY_MS;
    immediate.current = false;
    timer.current = setTimeout(() => void flush(), delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state.dirty, state.deleted, sessionId, flush]); // eslint-disable-line react-hooks/exhaustive-deps

  // Le travail des autres testeurs : rafraîchi toutes les 15 s onglet visible.
  useEffect(() => {
    if (!sessionId) return;
    const refresh = async () => {
      if (document.hidden || inFlight.current) return;
      try {
        const response = await fetch(`/api/sessions/${sessionId}/review`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = await response.json();
        const server: Annotation[] = data.review?.annotations ?? [];
        setState((current) =>
          applyServer(current, server, {
            annotations: [],
            deleted: [],
            versions: {},
          }),
        );
      } catch {
        /* prochain tour */
      }
    };
    const id = setInterval(() => void refresh(), REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [sessionId]);

  // Fermeture de la page : les suppressions annulables deviennent définitives, tout part.
  useEffect(() => {
    const onHide = () => {
      const closing = commitAllRemovals(stateRef.current);
      const writes = pendingWrites(closing);
      if (writes.annotations.length || writes.deleted.length)
        void send(true, writes).catch(() => undefined);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [send]);

  const draftNow = useCallback((start: number, end: number | null) => {
    const o = opts.current;
    const annotation = newAnnotation({
      tester: o.tester,
      start,
      end,
      targetIndex: o.targetAt(start),
    });
    immediate.current = true;
    setLoop(false);
    setState((current) => addDraft(current, annotation));
    o.reveal();
    o.announce(
      end === null
        ? `Point posé à ${formatTenths(start)}`
        : `Plage de ${formatTenths(start)} à ${formatTenths(end)}`,
    );
  }, []);

  const press = useCallback(() => {
    const o = opts.current;
    const outcome = pressMark(stateRef.current.mark, o.getPosition());
    if (outcome.kind === "start") {
      setState((current) => startMark(current, outcome.start));
      o.announce(`Début posé à ${formatTenths(outcome.start)}`);
    } else if (outcome.kind === "too_short")
      o.toast("Avance un peu l’écoute avant de poser la fin.");
    else draftNow(outcome.start, outcome.end);
  }, [draftNow]);

  const point = useCallback(() => {
    const o = opts.current;
    setState((current) => cancelMark(current));
    draftNow(roundTenth(o.getPosition()), null);
  }, [draftNow]);

  const cancel = useCallback(() => {
    setState((current) => cancelMark(current));
    opts.current.announce("Pose annulée");
  }, []);

  const traceSelect = useCallback(
    (selection: Selection) =>
      selection.mode === "range"
        ? draftNow(selection.start, selection.end)
        : draftNow(selection.start, null),
    [draftNow],
  );

  const setTrace = useCallback((on: boolean) => {
    setTraceState(on);
    opts.current.announce(on ? "Mode tracé activé" : "Mode tracé désactivé");
  }, []);

  /** Vrai si l'utilisateur peut modifier ce signalement ; sinon le dit (et ne fait rien). */
  const allowed = useCallback((id: string): boolean => {
    const a = stateRef.current.annotations.find((x) => x.id === id);
    if (!a || opts.current.canModify(a)) return true;
    opts.current.toast(
      `Ce signalement est celui de ${a.tester} : seul son auteur (ou un administrateur) peut le modifier.`,
    );
    return false;
  }, []);

  const patch = useCallback(
    (id: string, change: Parameters<typeof patchAnnotation>[2]) => {
      if (!allowed(id)) return;
      setState((current) => patchAnnotation(current, id, change, ctx()));
    },
    [ctx, allowed],
  );

  const toggle = useCallback(
    (id: string, tag: string) => {
      if (!allowed(id)) return;
      setState((current) => toggleTag(current, id, tag, ctx()));
    },
    [ctx, allowed],
  );

  const edge = useCallback(
    (id: string, which: "start" | "end", time: number) =>
      setState((current) => {
        const a = current.annotations.find((x) => x.id === id);
        if (!a || !opts.current.canModify(a)) return current;
        const next = moveEdge(
          { start: a.start_s, end: a.end_s },
          which,
          time,
          opts.current.duration,
        );
        return patchAnnotation(
          current,
          id,
          { start_s: next.start, end_s: next.end },
          ctx(),
        );
      }),
    [ctx],
  );

  const nudge = useCallback(
    (id: string, which: "start" | "end", delta: number) =>
      setState((current) => {
        const a = current.annotations.find((x) => x.id === id);
        if (!a || !opts.current.canModify(a)) return current;
        const next = nudgeEdge(
          { start: a.start_s, end: a.end_s },
          which,
          delta,
          opts.current.duration,
        );
        return patchAnnotation(
          current,
          id,
          { start_s: next.start, end_s: next.end },
          ctx(),
        );
      }),
    [ctx],
  );

  const confirm = useCallback(
    (id: string) => {
      const result = confirmDraft(stateRef.current, id, ctx());
      if (!result.ok) {
        opts.current.toast(
          "Choisis au moins une puce ou écris un commentaire.",
        );
        return false;
      }
      immediate.current = true;
      setState(result.state);
      setLoop(false);
      opts.current.announce("Signalement enregistré");
      return true;
    },
    [ctx],
  );

  const keep = useCallback(() => {
    setState((current) => keepDraft(current));
    setLoop(false);
    opts.current.toast("Brouillon gardé : retrouve-le dans Signalements.");
  }, []);

  const remove = useCallback(
    (id: string) => {
      if (!allowed(id)) return;
      const { state: next, removed } = removeAnnotation(stateRef.current, id);
      if (!removed) return;
      setState(next);
      setLoop(false);
      const commit = () => {
        undoTimers.current.delete(id);
        immediate.current = true;
        setState((current) => commitRemoval(current, id));
      };
      undoTimers.current.set(id, setTimeout(commit, UNDO_MS));
      opts.current.toast("Signalement supprimé", {
        label: "Annuler",
        run: () => {
          const pending = undoTimers.current.get(id);
          if (pending) clearTimeout(pending);
          undoTimers.current.delete(id);
          setState((current) => undoRemoval(current, id));
        },
      });
    },
    [allowed],
  );

  const edit = useCallback(
    (id: string) => {
      if (!allowed(id)) return;
      setState((current) => editAnnotation(current, id));
    },
    [allowed],
  );
  const select = useCallback(
    (id: string | null) => setState((current) => selectAnnotation(current, id)),
    [],
  );
  const listened = useCallback(
    (id: string) => setState((current) => markListened(current, id)),
    [],
  );
  const reset = useCallback((id: string) => remove(id), [remove]);

  const visible = useMemo(
    () => visibleAnnotations(state, filters),
    [state, filters],
  );

  const draft = state.draftId
    ? (state.annotations.find((a) => a.id === state.draftId) ?? null)
    : null;
  const done = state.doneId
    ? (state.annotations.find((a) => a.id === state.doneId) ?? null)
    : null;
  const testers = useMemo(
    () => [...new Set(state.annotations.map((a) => a.tester))].sort(),
    [state.annotations],
  );

  return {
    state,
    draft,
    done,
    visible,
    testers,
    filters,
    setFilters,
    save,
    retry: flush,
    trace,
    setTrace,
    loop,
    setLoop,
    press,
    point,
    cancel,
    traceSelect,
    patch,
    toggle,
    edge,
    nudge,
    confirm,
    keep,
    remove,
    reset,
    edit,
    select,
    listened,
  };
}

export type ReviewController = ReturnType<typeof useReviewController>;
