import { normalizeSearch } from "./session-name";

/**
 * Requête de liste des sessions : lecture des paramètres d'URL, curseur opaque et construction du
 * SQL (paramétré). Pur : aucune connexion ici, `session-index.ts` exécute ce qui est construit.
 *
 * Pagination par curseur (keyset) : le curseur porte la valeur de tri et l'identifiant de la
 * dernière ligne vue ; la page suivante est `(tri, id) > (valeur, id)` — stable même si des
 * sessions arrivent ou disparaissent entre deux pages, et sans OFFSET (coût constant).
 */
export const SCOPES = [
  "mine",
  "shared",
  "all",
  "favorites",
  "archived",
] as const;
export type Scope = (typeof SCOPES)[number];
export const STATE_FILTERS = [
  "ready",
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
  "active",
  "unread",
] as const;
export type StateFilter = (typeof STATE_FILTERS)[number];
export const SORTS = ["recent", "oldest", "name", "duration", "size"] as const;
export type Sort = (typeof SORTS)[number];
export const ENGINE_FILTERS = [
  "cascade",
  "fastconformer",
  "whisper",
  "muno-streaming",
] as const;

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
const MAX_QUERY_LENGTH = 100;

export type Cursor = { sort: Sort; value: string | number; id: string };

export type ListQuery = {
  scope: Scope;
  /** Mots de la recherche (normalisés) : tous doivent figurer dans le nom, l'étiquette ou le fichier. */
  words: string[];
  states: StateFilter[];
  engines: string[];
  /** Borne basse incluse / borne haute EXCLUE, en ISO UTC. */
  from: string | null;
  toExclusive: string | null;
  sort: Sort;
  limit: number;
  cursor: Cursor | null;
};

export type Parsed =
  | { ok: true; query: ListQuery }
  | { ok: false; message: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Borne de date : « 2026-10-22 » ou un ISO complet ; null si illisible. */
function parseDate(raw: string, end: boolean): string | null {
  const text = raw.trim();
  const ms = Date.parse(DATE_ONLY.test(text) ? `${text}T00:00:00.000Z` : text);
  if (!Number.isFinite(ms)) return null;
  // `to` en jour seul = fin de journée incluse ; en ISO complet = jusqu'à cet instant inclus.
  const next = end ? ms + (DATE_ONLY.test(text) ? 86_400_000 : 1) : ms;
  return new Date(next).toISOString();
}

const list = (raw: string | null): string[] =>
  (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCursor(raw: string, sort: Sort): Cursor | null {
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      value &&
      value.sort === sort &&
      typeof value.id === "string" &&
      value.id.length <= 64 &&
      (typeof value.value === "string" || typeof value.value === "number") &&
      (typeof value.value !== "number" || Number.isFinite(value.value))
    )
      return { sort, value: value.value, id: value.id };
  } catch {
    /* curseur illisible */
  }
  return null;
}

export function parseListQuery(params: URLSearchParams): Parsed {
  const scope = (params.get("scope") ?? "all") as Scope;
  if (!SCOPES.includes(scope))
    return { ok: false, message: `Portée inconnue (${SCOPES.join(", ")}).` };
  const sort = (params.get("sort") ?? "recent") as Sort;
  if (!SORTS.includes(sort))
    return { ok: false, message: `Tri inconnu (${SORTS.join(", ")}).` };
  const states = list(params.get("state"));
  if (
    !states.every((s): s is StateFilter =>
      STATE_FILTERS.includes(s as StateFilter),
    )
  )
    return {
      ok: false,
      message: `État inconnu (${STATE_FILTERS.join(", ")}).`,
    };
  const engines = list(params.get("engine"));
  if (!engines.every((e) => (ENGINE_FILTERS as readonly string[]).includes(e)))
    return {
      ok: false,
      message: `Moteur inconnu (${ENGINE_FILTERS.join(", ")}).`,
    };
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
    return { ok: false, message: `limit : un entier de 1 à ${MAX_LIMIT}.` };
  const q = params.get("q") ?? "";
  if (q.length > MAX_QUERY_LENGTH)
    return {
      ok: false,
      message: `q : ${MAX_QUERY_LENGTH} caractères au plus.`,
    };
  const rawFrom = params.get("from");
  const rawTo = params.get("to");
  const from = rawFrom ? parseDate(rawFrom, false) : null;
  const toExclusive = rawTo ? parseDate(rawTo, true) : null;
  if ((rawFrom && !from) || (rawTo && !toExclusive))
    return {
      ok: false,
      message: "from / to : une date (2026-10-22) ou un horodatage ISO.",
    };
  const rawCursor = params.get("cursor");
  const cursor = rawCursor ? decodeCursor(rawCursor, sort) : null;
  if (rawCursor && !cursor)
    return { ok: false, message: "Curseur invalide ou issu d'un autre tri." };
  return {
    ok: true,
    query: {
      scope,
      words: normalizeSearch(q).split(" ").filter(Boolean),
      states: states as StateFilter[],
      engines,
      from,
      toExclusive,
      sort,
      limit,
      cursor,
    },
  };
}

// ── SQL ───────────────────────────────────────────────────────────────────────────────────────
export type Sql = { sql: string; params: Array<string | number> };

const SORT_SQL: Record<
  Sort,
  {
    expr: string;
    dir: "ASC" | "DESC";
    field: "created_at" | "sort_name" | "dur" | "size_bytes";
  }
> = {
  recent: { expr: "m.created_at", dir: "DESC", field: "created_at" },
  oldest: { expr: "m.created_at", dir: "ASC", field: "created_at" },
  name: { expr: "m.sort_name", dir: "ASC", field: "sort_name" },
  duration: {
    expr: "COALESCE(m.audio_duration_s, -1)",
    dir: "DESC",
    field: "dur",
  },
  size: { expr: "m.size_bytes", dir: "DESC", field: "size_bytes" },
};

/** Valeur de tri d'une ligne, telle que la compare `(expr, id)` du curseur. */
export function sortValue(
  sort: Sort,
  row: {
    created_at: string;
    sort_name: string;
    audio_duration_s: number | null;
    size_bytes: number;
  },
): string | number {
  switch (SORT_SQL[sort].field) {
    case "created_at":
      return row.created_at;
    case "sort_name":
      return row.sort_name;
    case "dur":
      return row.audio_duration_s ?? -1;
    case "size_bytes":
      return row.size_bytes;
  }
}

const VISIBLE = "(m.visibility = 'global' OR m.owner_id = ?)";
const FAVORITE =
  "EXISTS (SELECT 1 FROM favorites f WHERE f.user_id = ? AND f.session_id = m.id)";
/** Terminée, propre à l'utilisateur, et pas ouverte depuis la fin de l'analyse. */
const UNREAD = `(m.state IN ('done', 'failed') AND m.owner_id = ? AND NOT EXISTS (
  SELECT 1 FROM views v WHERE v.user_id = ? AND v.session_id = m.id
    AND v.viewed_at >= COALESCE(m.finished_at, m.created_at)))`;
export const UNREAD_SELECT = UNREAD;
export const FAVORITE_SELECT = FAVORITE;

export function scopeSql(scope: Scope, me: number): Sql {
  switch (scope) {
    case "mine":
      return {
        sql: "(m.owner_id = ? AND m.archived_at IS NULL)",
        params: [me],
      };
    case "shared":
      return {
        sql: "(m.visibility = 'global' AND (m.owner_id IS NULL OR m.owner_id != ?) AND m.archived_at IS NULL)",
        params: [me],
      };
    case "all":
      return { sql: `(${VISIBLE} AND m.archived_at IS NULL)`, params: [me] };
    case "favorites":
      return {
        sql: `(${VISIBLE} AND ${FAVORITE} AND m.archived_at IS NULL)`,
        params: [me, me],
      };
    case "archived":
      return {
        sql: `(${VISIBLE} AND m.archived_at IS NOT NULL)`,
        params: [me],
      };
  }
}

function stateSql(states: readonly StateFilter[], me: number): Sql | null {
  if (states.length === 0) return null;
  const parts: string[] = [];
  const params: Array<string | number> = [];
  const plain: string[] = [];
  for (const state of states) {
    if (state === "active") plain.push("queued", "running");
    else if (state === "unread") {
      parts.push(UNREAD);
      params.push(me, me);
    } else plain.push(state);
  }
  if (plain.length) {
    parts.unshift(`m.state IN (${plain.map(() => "?").join(", ")})`);
    params.unshift(...plain);
  }
  return { sql: `(${parts.join(" OR ")})`, params };
}

const escapeLike = (word: string) => word.replace(/[\\%_]/g, (c) => `\\${c}`);

export type WhereOptions = {
  scope?: boolean;
  state?: boolean;
  cursor?: boolean;
};

/** WHERE complet (portée, filtres, curseur) ; `opts` retire un morceau pour calculer les compteurs. */
export function buildWhere(
  query: ListQuery,
  me: number,
  { scope = true, state = true, cursor = true }: WhereOptions = {},
): Sql {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  const add = (part: Sql | null) => {
    if (!part) return;
    clauses.push(part.sql);
    params.push(...part.params);
  };
  // Visibilité TOUJOURS : même sans portée, jamais de session privée d'autrui.
  add(scope ? scopeSql(query.scope, me) : { sql: VISIBLE, params: [me] });
  if (state) add(stateSql(query.states, me));
  if (query.engines.length)
    add({
      sql: `m.engine IN (${query.engines.map(() => "?").join(", ")})`,
      params: query.engines,
    });
  for (const word of query.words)
    add({
      sql: "m.search_text LIKE ? ESCAPE '\\'",
      params: [`%${escapeLike(word)}%`],
    });
  if (query.from) add({ sql: "m.created_at >= ?", params: [query.from] });
  if (query.toExclusive)
    add({ sql: "m.created_at < ?", params: [query.toExclusive] });
  if (cursor && query.cursor) {
    const { expr, dir } = SORT_SQL[query.sort];
    add({
      sql: `(${expr}, m.id) ${dir === "DESC" ? "<" : ">"} (?, ?)`,
      params: [query.cursor.value, query.cursor.id],
    });
  }
  return { sql: clauses.join(" AND "), params };
}

export function orderBy(sort: Sort): string {
  const { expr, dir } = SORT_SQL[sort];
  return `${expr} ${dir}, m.id ${dir}`;
}
