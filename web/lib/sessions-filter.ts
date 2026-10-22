import type { Preferences } from "./preferences-schema";
import type { Scope, Sort, StateFilter } from "./session-query";

/**
 * Filtre de la liste des sessions, côté navigateur : l'état des contrôles de la page « Sessions »
 * et sa traduction en paramètres de `GET /api/sessions`. Pur. Les valeurs permises sont celles du
 * serveur (`session-query.ts`) ; seuls portée, état, moteur et tri sont mémorisés comme
 * préférences (la recherche et les dates ne le sont jamais : elles répondent à un besoin du moment).
 */
export type SessionsFilter = {
  scope: Scope;
  state: "all" | StateFilter;
  engine: string;
  sort: Sort;
  q: string;
  /** AAAA-MM-JJ ou vide. */
  from: string;
  to: string;
};

export const DEFAULT_SESSIONS_FILTER: SessionsFilter = {
  scope: "all",
  state: "all",
  engine: "all",
  sort: "recent",
  q: "",
  from: "",
  to: "",
};

const MAX_QUERY = 100;

export function toSearchParams(
  filter: SessionsFilter,
  page: { limit: number; cursor?: string | null },
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("scope", filter.scope);
  if (filter.state !== "all") params.set("state", filter.state);
  if (filter.engine !== "all") params.set("engine", filter.engine);
  if (filter.sort !== DEFAULT_SESSIONS_FILTER.sort)
    params.set("sort", filter.sort);
  const q = filter.q.trim().slice(0, MAX_QUERY);
  if (q) params.set("q", q);
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  params.set("limit", String(page.limit));
  if (page.cursor) params.set("cursor", page.cursor);
  return params;
}

/** Nombre de critères qui restreignent la liste (la plage de dates compte pour un). */
export function activeFilterCount(filter: SessionsFilter): number {
  return (
    Number(filter.scope !== DEFAULT_SESSIONS_FILTER.scope) +
    Number(filter.state !== "all") +
    Number(filter.engine !== "all") +
    Number(filter.q.trim() !== "") +
    Number(filter.from !== "" || filter.to !== "")
  );
}

export const isDefaultFilter = (filter: SessionsFilter): boolean =>
  activeFilterCount(filter) === 0 &&
  filter.sort === DEFAULT_SESSIONS_FILTER.sort;

export const fromPreference = (
  preference: Preferences["sessionsFilter"],
): SessionsFilter => ({
  scope: preference.scope,
  state: preference.state,
  engine: preference.engine,
  sort: preference.sort,
  q: "",
  from: "",
  to: "",
});

export const toPreference = (
  filter: SessionsFilter,
): Preferences["sessionsFilter"] => ({
  scope: filter.scope,
  state: filter.state,
  engine: filter.engine as Preferences["sessionsFilter"]["engine"],
  sort: filter.sort,
});
