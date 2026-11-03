"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api-client";
import {
  fetchReadiness,
  previewExport,
  type ReadinessQuery,
} from "@/lib/export-client";
import type { ExportOptions } from "@/lib/export-options";
import type { ExportSummary, ReadinessPayload } from "@/lib/export-types";

/** Délai avant de recalculer quand un réglage change (on tape, on coche : un seul appel à la fin). */
const DEBOUNCE_MS = 250;
/** Le squelette n'apparaît pas avant ce délai : une réponse rapide ne fait jamais clignoter la page. */
const SKELETON_DELAY_MS = 400;

export type Loaded<T> = {
  data: T | null;
  error: ApiError | null;
  /** Une requête est en cours (les anciennes données restent affichées en attendant). */
  loading: boolean;
  /** La requête dure : afficher le squelette (jamais avant 400 ms). */
  slow: boolean;
  reload: () => void;
};

/** Chargement avec annulation, anti-rebond et conservation de la dernière réponse. */
function useLoaded<T>(
  deps: readonly unknown[],
  load: (signal: AbortSignal) => Promise<T>,
  {
    debounce = true,
    enabled = true,
  }: { debounce?: boolean; enabled?: boolean } = {},
): Loaded<T> {
  const [state, setState] = useState<{
    data: T | null;
    error: ApiError | null;
    loading: boolean;
    slow: boolean;
  }>({ data: null, error: null, loading: enabled, slow: false });
  const [tick, setTick] = useState(0);
  const first = useRef(true);
  const loader = useRef(load);
  loader.current = load;
  const key = JSON.stringify(deps);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const wait = first.current || !debounce ? 0 : DEBOUNCE_MS;
    first.current = false;
    setState((s) => ({ ...s, loading: true }));
    const slowTimer = setTimeout(
      () => setState((s) => (s.loading ? { ...s, slow: true } : s)),
      wait + SKELETON_DELAY_MS,
    );
    const timer = setTimeout(() => {
      loader
        .current(controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          setState({ data, error: null, loading: false, slow: false });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setState((s) => ({
            data: s.data,
            error:
              error instanceof ApiError
                ? error
                : new ApiError("Le moteur d'export n'a pas répondu.", 0),
            loading: false,
            slow: false,
          }));
        });
    }, wait);
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearTimeout(slowTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, enabled, debounce]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}

/** Le contrôle « prêt à exporter ? » : se recalcule quand le contenu, la référence, le filtre ou la page changent. */
export function useReadiness(
  sessionId: string,
  options: Pick<ExportOptions, "content" | "show_ref" | "strip_notes">,
  query: ReadinessQuery,
): Loaded<ReadinessPayload> {
  return useLoaded(
    [sessionId, options.content, options.show_ref, options.strip_notes, query],
    (signal) => fetchReadiness(sessionId, options, query, signal),
  );
}

/** L'aperçu en direct : le même moteur que l'export, les trois premiers sous-titres. */
export function usePreview(
  sessionId: string,
  options: ExportOptions,
  decisionsSha: string | null,
): Loaded<ExportSummary> {
  return useLoaded(
    [sessionId, options, decisionsSha],
    (signal) => previewExport(sessionId, options, signal),
    { enabled: decisionsSha !== null },
  );
}
