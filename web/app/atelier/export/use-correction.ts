"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { fetchDecisions, fetchReadiness } from "@/lib/export-client";
import type { ExportOptions } from "@/lib/export-options";
import type { DecisionsView, ReadinessItem } from "@/lib/export-types";

const PAGE = 50;
/** 20 pages de 50 : au-delà, la correction se fait par la liste (jamais des milliers d'éléments d'un coup). */
const MAX_PAGES = 20;

/**
 * Tous les passages comptés (résolus ou non), par pages de 50, triés par temps : de quoi passer d'un
 * passage au suivant sans retourner à la liste. Chaque page du serveur est petite ; aucune liste de
 * 3 000 éléments n'arrive jamais au navigateur.
 */
export function useCorrection(
  sessionId: string,
  options: Pick<ExportOptions, "content" | "show_ref" | "strip_notes">,
) {
  const [state, setState] = useState<{
    items: ReadinessItem[];
    total: number;
    loading: boolean;
    error: ApiError | null;
    canEdit: boolean;
    sessionName: string | null;
  }>({
    items: [],
    total: 0,
    loading: true,
    error: null,
    canEdit: false,
    sessionName: null,
  });
  const [decisions, setDecisions] = useState<DecisionsView | null>(null);
  const [tick, setTick] = useState(0);
  const { content, show_ref, strip_notes } = options;

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      const items: ReadinessItem[] = [];
      let total = 0;
      let canEdit = false;
      let name: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await fetchReadiness(
          sessionId,
          { content, show_ref, strip_notes },
          { page, size: PAGE },
          controller.signal,
        );
        items.push(...res.items);
        total = res.verdict.total;
        canEdit = res.session?.can_edit ?? false;
        name = res.session?.name ?? name;
        if (page + 1 >= res.page.pages) break;
      }
      if (controller.signal.aborted) return;
      setState({
        items,
        total,
        loading: false,
        error: null,
        canEdit,
        sessionName: name,
      });
    })().catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setState((s) => ({
        ...s,
        loading: false,
        error:
          error instanceof ApiError
            ? error
            : new ApiError("Le moteur d'export n'a pas répondu.", 0),
      }));
    });
    return () => controller.abort();
  }, [sessionId, content, show_ref, strip_notes, tick]);

  useEffect(() => {
    void fetchDecisions(sessionId).then(setDecisions, () => undefined);
  }, [sessionId, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, decisions, setDecisions, reload };
}
