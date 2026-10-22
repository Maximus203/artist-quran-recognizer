import type { Preferences } from "./preferences-schema";
import {
  ENGINE_FILTERS,
  SCOPES,
  SORTS,
  STATE_FILTERS,
  type Scope,
  type Sort,
  type StateFilter,
} from "./session-query";

/**
 * Filtre de la liste des sessions, côté navigateur : l'état des contrôles de la page « Sessions »,
 * sa traduction en paramètres de `GET /api/sessions` et son aller-retour avec l'adresse de la page
 * (un filtre se partage et survit au bouton Précédent). Pur. Les valeurs permises sont celles du
 * serveur (`session-query.ts`). Seuls portée, tri, et un état/moteur UNIQUE sont mémorisés comme
 * préférences : la recherche et les dates répondent à un besoin du moment.
 */
export type SessionsFilter = {
  scope: Scope;
  states: StateFilter[];
  engines: string[];
  sort: Sort;
  q: string;
  /** Jours calendaires LOCAUX (AAAA-MM-JJ) ou vide. */
  from: string;
  to: string;
};

export const DEFAULT_SESSIONS_FILTER: SessionsFilter = {
  scope: "all",
  states: [],
  engines: [],
  sort: "recent",
  q: "",
  from: "",
  to: "",
};

const MAX_QUERY = 100;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Début du jour local, en ISO UTC (le serveur ne connaît pas le fuseau du navigateur). */
export function dayStartIso(day: string): string | null {
  if (!DATE_ONLY.test(day)) return null;
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d, 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Dernière milliseconde du jour local, en ISO UTC (borne haute incluse). */
export function dayEndIso(day: string): string | null {
  if (!DATE_ONLY.test(day)) return null;
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d, 23, 59, 59, 999);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toSearchParams(
  filter: SessionsFilter,
  page: { limit: number; cursor?: string | null },
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("scope", filter.scope);
  if (filter.states.length) params.set("state", filter.states.join(","));
  if (filter.engines.length) params.set("engine", filter.engines.join(","));
  if (filter.sort !== DEFAULT_SESSIONS_FILTER.sort)
    params.set("sort", filter.sort);
  const q = filter.q.trim().slice(0, MAX_QUERY);
  if (q) params.set("q", q);
  const from = dayStartIso(filter.from);
  if (from) params.set("from", from);
  const to = dayEndIso(filter.to);
  if (to) params.set("to", to);
  params.set("limit", String(page.limit));
  if (page.cursor) params.set("cursor", page.cursor);
  return params;
}

/** Nombre de critères qui restreignent la liste (la plage de dates compte pour un). */
export function activeFilterCount(filter: SessionsFilter): number {
  return (
    Number(filter.scope !== DEFAULT_SESSIONS_FILTER.scope) +
    Number(filter.states.length > 0) +
    Number(filter.engines.length > 0) +
    Number(filter.q.trim() !== "") +
    Number(filter.from !== "" || filter.to !== "")
  );
}

export const isDefaultFilter = (filter: SessionsFilter): boolean =>
  activeFilterCount(filter) === 0 &&
  filter.sort === DEFAULT_SESSIONS_FILTER.sort;

/** Même filtre sans les critères de recherche (portée et tri gardés) : « Tout effacer ». */
export const clearedFilter = (filter: SessionsFilter): SessionsFilter => ({
  ...DEFAULT_SESSIONS_FILTER,
  scope: DEFAULT_SESSIONS_FILTER.scope,
  sort: filter.sort,
});

export const fromPreference = (
  preference: Preferences["sessionsFilter"],
): SessionsFilter => ({
  scope: preference.scope,
  states: preference.state === "all" ? [] : [preference.state],
  engines: preference.engine === "all" ? [] : [preference.engine],
  sort: preference.sort,
  q: "",
  from: "",
  to: "",
});

export const toPreference = (
  filter: SessionsFilter,
): Preferences["sessionsFilter"] => ({
  scope: filter.scope,
  state: filter.states.length === 1 ? filter.states[0] : "all",
  engine: (filter.engines.length === 1
    ? filter.engines[0]
    : "all") as Preferences["sessionsFilter"]["engine"],
  sort: filter.sort,
});

/* ───────── Adresse de la page (/sessions?q=…&portee=…) ───────── */
const SCOPE_TO_URL: Record<Scope, string> = {
  all: "all",
  mine: "mine",
  shared: "shared",
  favorites: "fav",
  archived: "arch",
};
const URL_TO_SCOPE = Object.fromEntries(
  Object.entries(SCOPE_TO_URL).map(([scope, url]) => [url, scope as Scope]),
);

const URL_KEYS = ["q", "portee", "etat", "moteur", "du", "au", "tri"] as const;

/** Vrai si l'adresse porte au moins un critère (sinon, ce sont les préférences qui s'appliquent). */
export const hasUrlFilter = (params: URLSearchParams): boolean =>
  URL_KEYS.some((key) => params.has(key));

const list = (raw: string | null): string[] =>
  (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export function filterFromUrl(params: URLSearchParams): SessionsFilter {
  const scope = URL_TO_SCOPE[params.get("portee") ?? ""] ?? "all";
  const sortRaw = params.get("tri") ?? "";
  const sort = (SORTS as readonly string[]).includes(sortRaw)
    ? (sortRaw as Sort)
    : "recent";
  const day = (value: string | null) =>
    value && DATE_ONLY.test(value) ? value : "";
  return {
    scope: (SCOPES as readonly string[]).includes(scope) ? scope : "all",
    states: list(params.get("etat")).filter((s): s is StateFilter =>
      (STATE_FILTERS as readonly string[]).includes(s),
    ),
    engines: list(params.get("moteur")).filter((e) =>
      (ENGINE_FILTERS as readonly string[]).includes(e),
    ),
    sort,
    q: (params.get("q") ?? "").slice(0, MAX_QUERY),
    from: day(params.get("du")),
    to: day(params.get("au")),
  };
}

export function filterToUrl(filter: SessionsFilter): URLSearchParams {
  const params = new URLSearchParams();
  const q = filter.q.trim();
  if (q) params.set("q", q.slice(0, MAX_QUERY));
  if (filter.scope !== "all") params.set("portee", SCOPE_TO_URL[filter.scope]);
  if (filter.states.length) params.set("etat", filter.states.join(","));
  if (filter.engines.length) params.set("moteur", filter.engines.join(","));
  if (filter.from) params.set("du", filter.from);
  if (filter.to) params.set("au", filter.to);
  if (filter.sort !== "recent") params.set("tri", filter.sort);
  return params;
}

/* ───────── Raccourcis de période ───────── */
export type DatePreset = "today" | "7" | "30" | "custom";

const pad = (n: number) => String(n).padStart(2, "0");
export const localDay = (time: number): string => {
  const d = new Date(time);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function presetRange(
  preset: Exclude<DatePreset, "custom">,
  now: number,
): { from: string; to: string } {
  const back = preset === "today" ? 0 : preset === "7" ? 6 : 29;
  const start = new Date(now);
  start.setDate(start.getDate() - back);
  return { from: localDay(start.getTime()), to: localDay(now) };
}

/** Raccourci correspondant aux dates du filtre, ou « personnalisée » ; null sans date. */
export function datePresetOf(
  filter: Pick<SessionsFilter, "from" | "to">,
  now: number,
): DatePreset | null {
  if (!filter.from && !filter.to) return null;
  for (const preset of ["today", "7", "30"] as const) {
    const range = presetRange(preset, now);
    if (range.from === filter.from && range.to === filter.to) return preset;
  }
  return "custom";
}
