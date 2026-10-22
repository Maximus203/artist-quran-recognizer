"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { pollInterval } from "@/lib/polling";
import type { Recognition } from "@/lib/recognition";
import type { Review } from "@/lib/review";
import type { SessionView } from "@/lib/session-view";
import { usePageVisible } from "./hooks";

export type Detail = {
  session: SessionView;
  result: Recognition | null;
  review: Review | null;
};

export function useSessionList() {
  const [views, setViews] = useState<SessionView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const visible = usePageVisible();
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++request.current;
    try {
      const response = await fetch("/api/sessions", { cache: "no-store" });
      if (!response.ok) throw new Error("Liste indisponible");
      const list: SessionView[] = await response.json();
      if (mine === request.current) {
        setViews(list);
        setError("");
      }
    } catch (e) {
      if (mine === request.current)
        setError(e instanceof Error ? e.message : "Liste indisponible");
    } finally {
      if (mine === request.current) setLoaded(true);
    }
  }, []);
  const hasActive = views.some(
    (v) => v.state === "running" || v.state === "queued",
  );
  const interval = pollInterval(visible, hasActive);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), interval);
    return () => clearInterval(timer);
  }, [refresh, interval]);
  return { views, loaded, error, refresh };
}

/** Détail de la session ouverte ; rechargé quand son état ou son résultat change (jamais par simple sondage). */
export function useSessionDetail(
  id: string | null,
  state: SessionView["state"] | undefined,
  predictionSha: string | null | undefined,
) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/sessions/${id}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Session introuvable");
        return (await response.json()) as Detail;
      })
      .then((value) => {
        if (cancelled) return;
        setDetail(value);
        setError("");
      })
      .catch((e) => {
        if (!cancelled) {
          setDetail(null);
          setError(e instanceof Error ? e.message : "Session introuvable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, state, predictionSha]);
  return { detail: detail && detail.session.id === id ? detail : null, error };
}

export type ImportItem = {
  key: string;
  name: string;
  state: "sending" | "queued" | "ready" | "error";
  error?: string;
};

type ImportOptions = {
  result?: File;
  source?: "file" | "microphone";
};

async function sendOne(
  file: File,
  options: ImportOptions,
): Promise<{ id: string; autorunError?: string }> {
  if (options.result) {
    // Un résultat joint : formulaire (le moteur ne tourne pas, la session naît terminée).
    const form = new FormData();
    form.append("audio", file);
    form.append("source_kind", options.source ?? "file");
    form.append("result", options.result);
    const response = await fetch("/api/sessions", {
      method: "POST",
      body: form,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Import impossible");
    return { id: data.id };
  }
  const response = await fetch("/api/sessions?autorun=1", {
    method: "POST",
    headers: {
      "x-aqr-filename": encodeURIComponent(file.name),
      "x-aqr-source-kind": options.source ?? "file",
      "content-type": file.type || "application/octet-stream",
    },
    body: file,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Import impossible");
  return { id: data.id, autorunError: data.autorun_error };
}

/** Import de plusieurs fichiers (audio et vidéo) : un envoi par fichier, chacun mis en file. */
export function useImporter(onDone: (ids: string[]) => void) {
  const [items, setItems] = useState<ImportItem[]>([]);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const done = useRef(onDone);
  done.current = onDone;
  const importFiles = useCallback(
    async (
      files: File[],
      options: ImportOptions = {},
    ): Promise<{ ids: string[]; errors: string[] }> => {
      if (running.current || files.length === 0)
        return {
          ids: [],
          errors: running.current ? ["Un import est déjà en cours."] : [],
        };
      running.current = true;
      setBusy(true);
      const base = Date.now();
      const keyOf = (i: number) => `${base}-${i}`;
      setItems(
        files.map((f, i) => ({
          key: keyOf(i),
          name: f.name,
          state: "sending",
        })),
      );
      const ids: string[] = [];
      const errors: string[] = [];
      for (const [i, file] of files.entries()) {
        try {
          const sent = await sendOne(file, options);
          ids.push(sent.id);
          if (sent.autorunError) errors.push(sent.autorunError);
          setItems((list) =>
            list.map((item) =>
              item.key === keyOf(i)
                ? sent.autorunError
                  ? {
                      ...item,
                      state: "ready",
                      error: `Audio conservé. L’analyse n’a pas démarré : ${sent.autorunError}`,
                    }
                  : { ...item, state: options.result ? "ready" : "queued" }
                : item,
            ),
          );
        } catch (e) {
          errors.push(e instanceof Error ? e.message : "Import impossible");
          setItems((list) =>
            list.map((item) =>
              item.key === keyOf(i)
                ? {
                    ...item,
                    state: "error",
                    error: e instanceof Error ? e.message : "Import impossible",
                  }
                : item,
            ),
          );
        }
      }
      running.current = false;
      setBusy(false);
      done.current(ids);
      return { ids, errors };
    },
    [],
  );
  const clear = useCallback(() => setItems([]), []);
  return { items, busy, importFiles, clear };
}

export async function runSession(id: string): Promise<void> {
  const response = await fetch(`/api/sessions/${id}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Action impossible");
}

export async function cancelSession(id: string): Promise<void> {
  const response = await fetch(`/api/sessions/${id}/run`, { method: "DELETE" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Action impossible");
}

/** « J'ai ouvert le résultat » : efface le point « non lu » côté serveur (partagé entre appareils). */
export async function markViewed(id: string): Promise<void> {
  await fetch(`/api/sessions/${id}/viewed`, { method: "POST" });
}
