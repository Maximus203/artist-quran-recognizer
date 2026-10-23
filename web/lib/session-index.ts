import type { Db } from "./db";
import { transaction } from "./db";
import type { Visibility } from "./access";
import {
  FAVORITE_SELECT,
  SCOPES,
  UNREAD_SELECT,
  buildWhere,
  encodeCursor,
  orderBy,
  sortValue,
  type ListQuery,
  type Scope,
  type StateFilter,
} from "./session-query";
import { normalizeSearch } from "./session-name";
import type { Session } from "./store";

/**
 * Index des sessions (couche données) : métadonnées, favoris, « non lu » par utilisateur et
 * journal des analyses. Tout le SQL est paramétré. `session.json` reste la source de vérité de
 * l'état d'une analyse : `syncMirror` recopie ses champs ici à chaque sauvegarde.
 */
export type MetaRow = {
  id: string;
  owner_id: number | null;
  owner_name: string | null;
  /** Empreinte de la photo de profil du propriétaire (null = pas de photo, ou pas de propriétaire). */
  owner_avatar: string | null;
  name: string;
  name_source: "auto" | "user";
  original_name: string;
  source_kind: "file" | "microphone";
  content_label: string | null;
  visibility: Visibility;
  archived_at: string | null;
  state: Session["state"];
  engine: string | null;
  started_at: string | null;
  finished_at: string | null;
  audio_duration_s: number | null;
  duration_s: number | null;
  size_bytes: number;
  disk_bytes: number;
  created_at: string;
  updated_at: string;
  sort_name: string;
};

export type ListedRow = MetaRow & {
  favorite: boolean;
  unread: boolean;
  /** Dernière ouverture du résultat PAR CET utilisateur (null = jamais). */
  viewed_at: string | null;
};

/** Colonnes propres à l'utilisateur courant : favori, non lu, dernière ouverture (4 paramètres `me`). */
const PER_USER = `${FAVORITE_SELECT} AS favorite, ${UNREAD_SELECT} AS unread,
  (SELECT v.viewed_at FROM views v WHERE v.user_id = ? AND v.session_id = m.id) AS viewed_at`;
const withUser = (row: Record<string, unknown>): ListedRow => ({
  ...toMeta(row),
  favorite: Boolean(row.favorite),
  unread: Boolean(row.unread),
  viewed_at: (row.viewed_at as string | null) ?? null,
});

const BASE = `SELECT m.id, m.owner_id, u.username AS owner_name, u.avatar_hash AS owner_avatar, m.name, m.name_source, m.original_name,
  m.source_kind, m.content_label, m.visibility, m.archived_at, m.state, m.engine, m.started_at,
  m.finished_at, m.audio_duration_s, m.duration_s, m.size_bytes, m.disk_bytes, m.created_at,
  m.updated_at, m.sort_name`;
const FROM = "FROM session_meta m LEFT JOIN users u ON u.id = m.owner_id";

const toMeta = (row: Record<string, unknown>): MetaRow =>
  row as unknown as MetaRow;

export function getMeta(db: Db, id: string): MetaRow | null {
  const row = db.prepare(`${BASE} ${FROM} WHERE m.id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? toMeta(row) : null;
}

const searchText = (name: string, label: string | null, original: string) =>
  normalizeSearch(`${name} ${label ?? ""} ${original}`);

export type NewMeta = {
  id: string;
  ownerId: number | null;
  name: string;
  nameSource: "auto" | "user";
  originalName: string;
  sourceKind: "file" | "microphone";
  visibility: Visibility;
  createdAt: string;
  sizeBytes: number;
  state?: Session["state"];
};

/** Crée la ligne d'une session. Ne remplace jamais une ligne existante (propriété et portée intactes). */
export function createMeta(db: Db, input: NewMeta): void {
  db.prepare(
    `INSERT OR IGNORE INTO session_meta
       (id, owner_id, name, name_source, original_name, source_kind, visibility, state,
        size_bytes, disk_bytes, created_at, updated_at, search_text, sort_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.ownerId,
    input.name,
    input.nameSource,
    input.originalName,
    input.sourceKind,
    input.visibility,
    input.state ?? "ready",
    input.sizeBytes,
    input.sizeBytes,
    input.createdAt,
    input.createdAt,
    searchText(input.name, null, input.originalName),
    normalizeSearch(input.name),
  );
}

export const mirrorEngine = (
  s: Pick<Session, "engine" | "asr">,
): string | null => s.engine ?? s.asr ?? null;

/** Recopie l'état de `session.json` dans l'index (ne touche ni propriétaire, ni nom, ni portée). */
export function syncMirror(db: Db, session: Session, now: string): void {
  db.prepare(
    `UPDATE session_meta SET state = ?, engine = ?, started_at = ?, finished_at = ?,
       audio_duration_s = ?, duration_s = ?, size_bytes = ?, updated_at = ? WHERE id = ?`,
  ).run(
    session.state,
    mirrorEngine(session),
    session.started_at,
    session.finished_at,
    session.audio_duration_s ?? null,
    session.duration_s ?? null,
    session.size,
    now,
    session.id,
  );
}

export function setDerived(
  db: Db,
  id: string,
  derived: { diskBytes?: number; contentLabel?: string | null },
): void {
  if (derived.diskBytes !== undefined)
    db.prepare("UPDATE session_meta SET disk_bytes = ? WHERE id = ?").run(
      derived.diskBytes,
      id,
    );
  if (derived.contentLabel !== undefined) {
    const meta = getMeta(db, id);
    if (!meta) return;
    db.prepare(
      "UPDATE session_meta SET content_label = ?, search_text = ? WHERE id = ?",
    ).run(
      derived.contentLabel,
      searchText(meta.name, derived.contentLabel, meta.original_name),
      id,
    );
  }
}

export function deleteMeta(db: Db, id: string): void {
  db.prepare("DELETE FROM session_meta WHERE id = ?").run(id);
}

export type MetaPatch = {
  name?: string;
  nameSource?: "auto" | "user";
  visibility?: Visibility;
  archivedAt?: string | null;
};

export function updateMeta(
  db: Db,
  id: string,
  patch: MetaPatch,
  now: string,
): MetaRow | null {
  return transaction(db, () => {
    const current = getMeta(db, id);
    if (!current) return null;
    const name = patch.name ?? current.name;
    db.prepare(
      `UPDATE session_meta SET name = ?, name_source = ?, visibility = ?, archived_at = ?,
         updated_at = ?, search_text = ?, sort_name = ? WHERE id = ?`,
    ).run(
      name,
      patch.nameSource ?? current.name_source,
      patch.visibility ?? current.visibility,
      patch.archivedAt === undefined ? current.archived_at : patch.archivedAt,
      now,
      searchText(name, current.content_label, current.original_name),
      normalizeSearch(name),
      id,
    );
    return getMeta(db, id);
  });
}

// ── Favoris et non lu ─────────────────────────────────────────────────────────────────────────
export function setFavorite(
  db: Db,
  userId: number,
  id: string,
  on: boolean,
  now: string,
): void {
  if (on)
    db.prepare(
      "INSERT OR IGNORE INTO favorites (user_id, session_id, created_at) VALUES (?, ?, ?)",
    ).run(userId, id, now);
  else
    db.prepare(
      "DELETE FROM favorites WHERE user_id = ? AND session_id = ?",
    ).run(userId, id);
}

/** « J'ai ouvert le résultat » : idempotent tant que l'analyse n'a pas été refaite depuis. */
export function markViewedBy(
  db: Db,
  userId: number,
  id: string,
  now: string,
): string {
  db.prepare(
    `INSERT INTO views (user_id, session_id, viewed_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id, session_id) DO UPDATE SET viewed_at = excluded.viewed_at
       WHERE views.viewed_at < COALESCE((SELECT finished_at FROM session_meta WHERE id = views.session_id), '')`,
  ).run(userId, id, now);
  return (
    db
      .prepare(
        "SELECT viewed_at FROM views WHERE user_id = ? AND session_id = ?",
      )
      .get(userId, id) as { viewed_at: string }
  ).viewed_at;
}

/** Une session vue par un utilisateur (ligne d'index + favori, non lu, ouverture), relue à l'instant. */
export function getListed(
  db: Db,
  userId: number,
  id: string,
): ListedRow | null {
  const row = db
    .prepare(`${BASE}, ${PER_USER} ${FROM} WHERE m.id = ?`)
    .get(userId, userId, userId, userId, id) as
    | Record<string, unknown>
    | undefined;
  return row ? withUser(row) : null;
}

export function viewState(
  db: Db,
  userId: number,
  id: string,
): { favorite: boolean; unread: boolean; viewed_at: string | null } {
  const row = db
    .prepare(`SELECT ${PER_USER} FROM session_meta m WHERE m.id = ?`)
    .get(userId, userId, userId, userId, id) as
    | Record<string, unknown>
    | undefined;
  return row
    ? {
        favorite: Boolean(row.favorite),
        unread: Boolean(row.unread),
        viewed_at: (row.viewed_at as string | null) ?? null,
      }
    : { favorite: false, unread: false, viewed_at: null };
}

// ── Liste paginée et compteurs ────────────────────────────────────────────────────────────────
export type Page = {
  items: ListedRow[];
  next_cursor: string | null;
  total: number;
};

export function listPage(db: Db, me: number, query: ListQuery): Page {
  const where = buildWhere(query, me);
  const rows = db
    .prepare(
      `${BASE}, ${PER_USER} ${FROM}
       WHERE ${where.sql} ORDER BY ${orderBy(query.sort)} LIMIT ?`,
    )
    .all(me, me, me, me, ...where.params, query.limit + 1) as Record<
    string,
    unknown
  >[];
  const more = rows.length > query.limit;
  const items = rows.slice(0, query.limit).map(withUser);
  const last = items[items.length - 1];
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM session_meta m WHERE ${buildWhere(query, me, { cursor: false }).sql}`,
      )
      .get(...buildWhere(query, me, { cursor: false }).params) as { n: number }
  ).n;
  return {
    items,
    next_cursor:
      more && last
        ? encodeCursor({
            sort: query.sort,
            value: sortValue(query.sort, last),
            id: last.id,
          })
        : null,
    total,
  };
}

export type Counts = {
  /** Par portée, filtres de recherche appliqués (pas l'état). */
  scopes: Record<Scope, number>;
  /** Dans la portée courante, filtres appliqués (pas l'état). */
  states: Record<StateFilter | "total", number>;
};

export function listCounts(db: Db, me: number, query: ListQuery): Counts {
  const scopes = {} as Record<Scope, number>;
  for (const scope of SCOPES) {
    const where = buildWhere({ ...query, scope }, me, {
      state: false,
      cursor: false,
    });
    scopes[scope] = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM session_meta m WHERE ${where.sql}`)
        .get(...where.params) as { n: number }
    ).n;
  }
  const where = buildWhere(query, me, { state: false, cursor: false });
  const states = { total: scopes[query.scope] } as Counts["states"];
  const row = db
    .prepare(
      `SELECT m.state AS state, COUNT(*) AS n FROM session_meta m WHERE ${where.sql} GROUP BY m.state`,
    )
    .all(...where.params) as Array<{ state: string; n: number }>;
  for (const key of [
    "ready",
    "queued",
    "running",
    "done",
    "failed",
    "cancelled",
  ] as const)
    states[key] = row.find((r) => r.state === key)?.n ?? 0;
  states.active = states.queued + states.running;
  states.unread = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM session_meta m WHERE ${where.sql} AND ${UNREAD_SELECT}`,
      )
      .get(...where.params, me, me) as { n: number }
  ).n;
  return { scopes, states };
}

// ── Lectures pour les statistiques et l'ordonnancement ────────────────────────────────────────
/** Lignes minimales de toutes les sessions visibles : historique de durées, file, statistiques. */
export function visibleRows(db: Db, me: number): ListedRow[] {
  return (
    db
      .prepare(
        `${BASE}, ${PER_USER} ${FROM}
         WHERE (m.visibility = 'global' OR m.owner_id = ?)`,
      )
      .all(me, me, me, me, me) as Record<string, unknown>[]
  ).map(withUser);
}

/** Sessions terminées ou en file/en cours, tous propriétaires : historique de durées et file. */
export function estimationRows(db: Db): MetaRow[] {
  return (
    db
      .prepare(`${BASE} ${FROM} WHERE m.state IN ('done', 'queued', 'running')`)
      .all() as Record<string, unknown>[]
  ).map(toMeta);
}

/** Octets déjà occupés par les fichiers envoyés de cet utilisateur (quota). */
export function usedBytes(db: Db, ownerId: number): number {
  return (
    db
      .prepare(
        "SELECT COALESCE(SUM(size_bytes), 0) AS n FROM session_meta WHERE owner_id = ?",
      )
      .get(ownerId) as { n: number }
  ).n;
}

export function knownIds(db: Db): Set<string> {
  return new Set(
    (
      db.prepare("SELECT id FROM session_meta").all() as Array<{ id: string }>
    ).map((row) => row.id),
  );
}

// ── Journal des analyses ──────────────────────────────────────────────────────────────────────
export function recordAnalysis(
  db: Db,
  session: Session,
  ownerId: number | null,
): void {
  if (session.state !== "done" && session.state !== "failed") return;
  // Une analyse = lancée par l'atelier ; un résultat importé à la main n'en est pas une.
  if (session.started_at === null && session.state === "done") return;
  db.prepare(
    `INSERT OR IGNORE INTO analysis_log
       (session_id, user_id, engine, outcome, audio_duration_s, duration_s, size_bytes, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    session.id,
    ownerId,
    mirrorEngine(session),
    session.state,
    session.audio_duration_s ?? null,
    session.duration_s ?? null,
    session.size,
    session.finished_at ?? new Date().toISOString(),
  );
}

export type UserStats = {
  tests: number;
  failures: number;
  audio_total_s: number;
  processing_total_s: number;
  rtf_mean: number | null;
  by_engine: Array<{ engine: string; tests: number }>;
};

export function userAnalysisStats(db: Db, userId: number): UserStats {
  const rows = db
    .prepare(
      `SELECT engine, outcome, audio_duration_s, duration_s FROM analysis_log WHERE user_id = ?`,
    )
    .all(userId) as Array<{
    engine: string | null;
    outcome: "done" | "failed";
    audio_duration_s: number | null;
    duration_s: number | null;
  }>;
  const done = rows.filter((r) => r.outcome === "done");
  let audio = 0;
  let processing = 0;
  const rtfs: number[] = [];
  for (const r of done) {
    audio += r.audio_duration_s ?? 0;
    processing += r.duration_s ?? 0;
    if (r.audio_duration_s && r.duration_s && r.audio_duration_s > 0)
      rtfs.push(r.duration_s / r.audio_duration_s);
  }
  const engines = new Map<string, number>();
  for (const r of done)
    engines.set(
      r.engine ?? "inconnu",
      (engines.get(r.engine ?? "inconnu") ?? 0) + 1,
    );
  return {
    tests: done.length,
    failures: rows.length - done.length,
    audio_total_s: audio,
    processing_total_s: processing,
    rtf_mean: rtfs.length
      ? rtfs.reduce((a, b) => a + b, 0) / rtfs.length
      : null,
    by_engine: [...engines.entries()]
      .map(([engine, tests]) => ({ engine, tests }))
      .sort((a, b) => b.tests - a.tests || a.engine.localeCompare(b.engine)),
  };
}

/** Ce que l'utilisateur possède aujourd'hui : sessions, octets envoyés, secondes d'audio. */
export function ownedTotals(db: Db, userId: number) {
  return db
    .prepare(
      `SELECT COUNT(*) AS sessions, COALESCE(SUM(size_bytes), 0) AS bytes,
              COALESCE(SUM(disk_bytes), 0) AS disk_bytes,
              COALESCE(SUM(audio_duration_s), 0) AS audio_s,
              COALESCE(SUM(CASE WHEN visibility = 'private' THEN 1 ELSE 0 END), 0) AS private_sessions
       FROM session_meta WHERE owner_id = ?`,
    )
    .get(userId) as {
    sessions: number;
    bytes: number;
    disk_bytes: number;
    audio_s: number;
    private_sessions: number;
  };
}
