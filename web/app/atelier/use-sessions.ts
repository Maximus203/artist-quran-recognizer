"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import type { ApiSession, Counts, SessionPage } from "@/lib/api-types";
import { pollInterval } from "@/lib/polling";
import type { Recognition } from "@/lib/recognition";
import type { Review } from "@/lib/review";
import { applyRefresh, refreshLimit } from "@/lib/session-feed";
import { mergePages } from "@/lib/session-groups";
import { toSearchParams, type SessionsFilter } from "@/lib/sessions-filter";
import { usePageVisible } from "./hooks";

export type Detail = {
  session: ApiSession;
  result: Recognition | null;
  review: Review | null;
};

const isActive = (state: ApiSession["state"]) =>
  state === "running" || state === "queued";

const fetchPage = (query: string) =>
  api<SessionPage>(`/api/sessions?${query}`);

/* ───────────────────────── Liste paginée (page « Sessions ») ───────────────────────── */

export type FeedStatus = "loading" | "ready" | "error";

type Feed = {
  items: ApiSession[];
  total: number;
  counts: Counts | null;
  next: string | null;
  status: FeedStatus;
  error: string;
  loadingMore: boolean;
};

const EMPTY_FEED: Feed = {
  items: [],
  total: 0,
  counts: null,
  next: null,
  status: "loading",
  error: "",
  loadingMore: false,
};

/**
 * Sessions filtrées et paginées par curseur. Un changement de filtre repart de zéro ; « Charger
 * plus » ajoute la page suivante ; le sondage relit ce qui est chargé pour suivre l'avancement des
 * analyses. Une réponse qui arrive après un changement de filtre est ignorée.
 */
export function useSessionFeed(filter: SessionsFilter, pageSize = 20) {
  const [feed, setFeed] = useState<Feed>(EMPTY_FEED);
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const epoch = useRef(0);
  const visible = usePageVisible();
  const key = toSearchParams(filter, { limit: pageSize }).toString();
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const first = useCallback(async () => {
    const mine = ++epoch.current;
    try {
      const page = await fetchPage(
        toSearchParams(filterRef.current, { limit: pageSize }).toString(),
      );
      if (mine !== epoch.current) return;
      setFeed({
        items: page.items,
        total: page.total,
        counts: page.counts,
        next: page.next_cursor,
        status: "ready",
        error: "",
        loadingMore: false,
      });
    } catch (e) {
      if (mine !== epoch.current) return;
      setFeed((current) => ({
        ...current,
        status: "error",
        error: e instanceof Error ? e.message : "Liste indisponible",
      }));
    }
  }, [pageSize]);

  // Nouveau filtre : on repart de zéro (le chargement est annoncé, l'ancienne liste disparaît).
  useEffect(() => {
    setFeed(EMPTY_FEED);
    void first();
  }, [key, first]);

  const loadMore = useCallback(async () => {
    const current = feedRef.current;
    if (!current.next || current.loadingMore) return;
    const mine = epoch.current;
    setFeed((f) => ({ ...f, loadingMore: true }));
    try {
      const page = await fetchPage(
        toSearchParams(filterRef.current, {
          limit: pageSize,
          cursor: current.next,
        }).toString(),
      );
      if (mine !== epoch.current) return;
      setFeed((f) => ({
        ...f,
        items: mergePages(f.items, page.items),
        total: page.total,
        counts: page.counts,
        next: page.next_cursor,
        loadingMore: false,
        error: "",
      }));
    } catch (e) {
      if (mine !== epoch.current) return;
      setFeed((f) => ({
        ...f,
        loadingMore: false,
        error: e instanceof Error ? e.message : "Page suivante indisponible",
      }));
    }
  }, [pageSize]);

  // Sondage : relit ce qui est chargé (jamais plus de 100 lignes d'un coup).
  const hasActive = feed.items.some((item) => isActive(item.state));
  const interval = pollInterval(visible, hasActive);
  useEffect(() => {
    const timer = setInterval(async () => {
      const current = feedRef.current;
      if (current.status !== "ready" || current.loadingMore) return;
      const mine = epoch.current;
      const limit = refreshLimit(current.items.length, pageSize);
      try {
        const page = await fetchPage(
          toSearchParams(filterRef.current, { limit }).toString(),
        );
        if (mine !== epoch.current) return;
        setFeed((f) => {
          const merged = applyRefresh(
            f.items,
            page.items,
            limit,
            page.next_cursor,
            f.next,
          );
          return {
            ...f,
            items: merged.items,
            next: merged.nextCursor,
            total: page.total,
            counts: page.counts,
          };
        });
      } catch {
        /* le prochain tour réessaie */
      }
    }, interval);
    return () => clearInterval(timer);
  }, [interval, pageSize]);

  const patchItem = useCallback(
    (id: string, patch: Partial<ApiSession>) =>
      setFeed((f) => ({
        ...f,
        items: f.items.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      })),
    [],
  );
  const removeItems = useCallback(
    (ids: readonly string[]) =>
      setFeed((f) => {
        const gone = new Set(ids);
        const items = f.items.filter((item) => !gone.has(item.id));
        return { ...f, items, total: Math.max(0, f.total - (f.items.length - items.length)) };
      }),
    [],
  );
  const reload = useCallback(() => first(), [first]);

  return {
    ...feed,
    hasMore: feed.next !== null,
    loadMore,
    reload,
    patchItem,
    removeItems,
  };
}

/* ───────────────────────── Barre de gauche (allégée) ───────────────────────── */

export const SIDEBAR_RECENT = 8;
export const SIDEBAR_FAVORITES = 6;
const SIDEBAR_FETCH = 18;

export type Sidebar = {
  loaded: boolean;
  error: string;
  /** Favoris épinglés (les plus récents d'abord). */
  favorites: ApiSession[];
  /** Les 8 plus récentes, favoris exclus. */
  recent: ApiSession[];
  /** Analyses en cours puis en attente (la file), hors favoris/récentes déjà montrées. */
  queue: ApiSession[];
  counts: Counts | null;
  total: number;
};

const EMPTY_SIDEBAR: Sidebar = {
  loaded: false,
  error: "",
  favorites: [],
  recent: [],
  queue: [],
  counts: null,
  total: 0,
};

/** Ce que la barre de gauche montre : quelques favoris, la file, les plus récentes. Jamais toute la liste. */
export function useSidebarSessions() {
  const [data, setData] = useState<Sidebar>(EMPTY_SIDEBAR);
  const visible = usePageVisible();
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++request.current;
    try {
      const [recent, favorites] = await Promise.all([
        fetchPage(`scope=all&limit=${SIDEBAR_FETCH}`),
        fetchPage(`scope=favorites&limit=${SIDEBAR_FAVORITES}`),
      ]);
      const active =
        recent.counts.states.active > 0
          ? await fetchPage("scope=all&state=active&sort=oldest&limit=100")
          : null;
      if (mine !== request.current) return;
      const pinned = new Set(favorites.items.map((s) => s.id));
      const queue = (active?.items ?? []).sort(
        (a, b) =>
          Number(b.state === "running") - Number(a.state === "running") ||
          (a.queue_position ?? 0) - (b.queue_position ?? 0),
      );
      const queued = new Set(queue.map((s) => s.id));
      setData({
        loaded: true,
        error: "",
        favorites: favorites.items,
        queue,
        recent: recent.items
          .filter((s) => !pinned.has(s.id) && !queued.has(s.id))
          .slice(0, SIDEBAR_RECENT),
        counts: recent.counts,
        total: recent.total,
      });
    } catch (e) {
      if (mine === request.current)
        setData((d) => ({
          ...d,
          loaded: true,
          error: e instanceof Error ? e.message : "Liste indisponible",
        }));
    }
  }, []);
  const interval = pollInterval(visible, data.queue.length > 0);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), interval);
    return () => clearInterval(timer);
  }, [refresh, interval]);
  return { ...data, refresh };
}

/* ───────────────────────── Session ouverte ───────────────────────── */

const signatureOf = (detail: Detail): string =>
  `${JSON.stringify(detail.session)}|${detail.result ? "r" : "-"}`;

/**
 * Détail de la session ouverte. Tant qu'elle attend ou tourne, on la relit (état, file, estimation,
 * puis résultat à la fin). `notFound` : absente OU privée d'un autre compte (même réponse, pour ne
 * pas révéler son existence).
 */
export function useSessionDetail(id: string | null) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const visible = usePageVisible();
  const signature = useRef("");
  const idRef = useRef(id);
  idRef.current = id;

  const load = useCallback(async (): Promise<Detail | null> => {
    const target = idRef.current;
    if (!target) return null;
    try {
      const value = await api<Detail>(`/api/sessions/${target}`);
      if (idRef.current !== target) return null;
      const next = signatureOf(value);
      if (next !== signature.current) {
        signature.current = next;
        setDetail(value);
      }
      setError("");
      setNotFound(false);
      return value;
    } catch (e) {
      if (idRef.current !== target) return null;
      if (e instanceof ApiError && e.status === 404) {
        setDetail(null);
        setNotFound(true);
        setError(
          "Cette session n’existe pas ou n’est pas visible avec ton compte.",
        );
      } else
        setError(e instanceof Error ? e.message : "Session indisponible");
      return null;
    }
  }, []);

  useEffect(() => {
    signature.current = "";
    setDetail(null);
    setError("");
    setNotFound(false);
    if (id) void load();
  }, [id, load]);

  const active = detail ? isActive(detail.session.state) : false;
  useEffect(() => {
    if (!id || !active) return;
    const timer = setInterval(() => void load(), pollInterval(visible, true));
    return () => clearInterval(timer);
  }, [id, active, visible, load]);

  /** Modification locale immédiate de la session affichée (favori, nom, « non lu »…). */
  const patch = useCallback((change: Partial<ApiSession>) => {
    setDetail((current) =>
      current
        ? { ...current, session: { ...current.session, ...change } }
        : current,
    );
    signature.current = "";
  }, []);

  return {
    detail: detail && detail.session.id === id ? detail : null,
    error,
    notFound,
    patch,
    reload: load,
  };
}

/* ───────────────────────── Import ───────────────────────── */

export type Visibility = "global" | "private";

export type ImportItem = {
  key: string;
  name: string;
  state: "sending" | "queued" | "ready" | "error";
  error?: string;
};

type ImportOptions = {
  result?: File;
  source?: "file" | "microphone";
  /** Portée de l'audio : visible par tous les testeurs (défaut) ou privé. */
  visibility?: Visibility;
};

async function sendOne(
  file: File,
  options: ImportOptions,
): Promise<{ id: string; autorunError?: string }> {
  const visibility = options.visibility ?? "global";
  if (options.result) {
    // Un résultat joint : formulaire (le moteur ne tourne pas, la session naît terminée).
    const form = new FormData();
    form.append("audio", file);
    form.append("source_kind", options.source ?? "file");
    form.append("visibility", visibility);
    form.append("result", options.result);
    const data = await api<{ id: string }>("/api/sessions", {
      method: "POST",
      body: form,
    });
    return { id: data.id };
  }
  const data = await api<{ id: string; autorun_error?: string }>(
    `/api/sessions?autorun=1&visibility=${visibility}`,
    {
      method: "POST",
      headers: {
        "x-aqr-filename": encodeURIComponent(file.name),
        "x-aqr-source-kind": options.source ?? "file",
        "content-type": file.type || "application/octet-stream",
      },
      body: file,
    },
  );
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

/* ───────────────────────── Actions ───────────────────────── */

export const runSession = (id: string) =>
  api(`/api/sessions/${id}/run`, { method: "POST", json: {} });

export const cancelSession = (id: string) =>
  api(`/api/sessions/${id}/run`, { method: "DELETE" });

/** « J'ai ouvert le résultat » : efface le point « non lu » côté serveur (partagé entre appareils). */
export const markViewed = (id: string) =>
  api(`/api/sessions/${id}/viewed`, { method: "POST" });

type SessionPatch = {
  name?: string | null;
  visibility?: Visibility;
  archived?: boolean;
};

export const patchSession = (id: string, change: SessionPatch) =>
  api<{ session: ApiSession }>(`/api/sessions/${id}`, {
    method: "PATCH",
    json: change,
  });

export const setFavorite = (id: string, favorite: boolean) =>
  api<{ id: string; favorite: boolean }>(`/api/sessions/${id}/favorite`, {
    method: favorite ? "PUT" : "DELETE",
  });

export type BulkAction =
  | { action: "archive" | "unarchive" | "favorite" | "unfavorite" }
  | { action: "set_visibility"; visibility: Visibility };

export type BulkResult = {
  results: { id: string; status: "ok" | "not_found" | "forbidden" }[];
  applied: number;
};

export const bulkSessions = (ids: readonly string[], action: BulkAction) =>
  api<BulkResult>("/api/sessions/bulk", {
    method: "POST",
    json: { ids, ...action },
  });

export const deleteSession = (id: string, force = false) =>
  api(`/api/sessions/${id}${force ? "?force=1" : ""}`, { method: "DELETE" });
