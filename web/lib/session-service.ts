import { statfs } from "node:fs/promises";
import { can, type Actor } from "./access";
import type { PersonRef } from "./avatar-config";
import type { Db } from "./db";
import { isMissingSession } from "./errors";
import { log } from "./log";
import {
  deleteMeta,
  estimationRows,
  getListed,
  listCounts,
  listPage,
  visibleRows,
  viewState,
  type Counts,
  type ListedRow,
  type MetaRow,
} from "./session-index";
import type { ListQuery } from "./session-query";
import {
  buildStats,
  buildViews,
  currentContext,
  type SessionView,
  type Stats,
} from "./session-view";
import {
  backfillDerived,
  readSession,
  reviewRoot,
  type Session,
} from "./store";

/**
 * Couche application des sessions : assemble l'index (SQLite), le disque (`session.json`) et le
 * calcul de file/estimation (`session-view.ts`) en objets prêts pour l'API, PAR utilisateur.
 */
export type ApiSession = Omit<SessionView, "pid"> & {
  /** Nom affiché (`original_name` est le nom du fichier envoyé). */
  original_name: string;
  name_source: "auto" | "user";
  content_label: string | null;
  visibility: "global" | "private";
  archived_at: string | null;
  /** Qui a importé l'audio : pseudo et version de la photo (jamais d'e-mail ni de donnée sensible). */
  owner: PersonRef | null;
  mine: boolean;
  can_edit: boolean;
  favorite: boolean;
  size_bytes: number;
};

/** Session reconstruite depuis l'index seul (historique de durées, file des autres, session illisible). */
export function liteSession(row: MetaRow): Session {
  return {
    id: row.id,
    name: row.name,
    extension: "",
    audio_sha256: "",
    size: row.size_bytes,
    source_kind: row.source_kind,
    created_at: row.created_at,
    state: row.state,
    error: null,
    started_at: row.started_at,
    finished_at: row.finished_at,
    prediction_sha256: null,
    pid: null,
    engine: row.engine as Session["engine"],
    audio_duration_s: row.audio_duration_s,
    duration_s: row.duration_s,
  };
}

type Perso = Pick<ListedRow, "favorite" | "unread" | "viewed_at">;

function compose(
  me: Actor,
  row: MetaRow & Perso,
  view: SessionView,
): ApiSession {
  const { pid: _pid, ...rest } = view;
  return {
    ...rest,
    name: row.name,
    original_name: row.original_name,
    name_source: row.name_source,
    content_label: row.content_label,
    visibility: row.visibility,
    archived_at: row.archived_at,
    owner:
      row.owner_id === null
        ? null
        : {
            id: row.owner_id,
            username: row.owner_name ?? "",
            avatar_version: row.owner_avatar ?? null,
          },
    mine: row.owner_id === me.id,
    can_edit: can(me, "edit", row),
    favorite: row.favorite,
    size_bytes: row.size_bytes,
    unread: row.unread,
    viewed_at: row.viewed_at,
  };
}

/** Lit la session sur le disque ; `null` si le dossier a disparu (la ligne d'index est alors retirée). */
async function load(db: Db, row: MetaRow): Promise<Session | null> {
  try {
    return await backfillDerived(await readSession(row.id));
  } catch (error) {
    if (isMissingSession(error)) {
      deleteMeta(db, row.id);
      log.warn(
        "index",
        `session ${row.id} absente du disque : retirée de la base`,
      );
      return null;
    }
    log.warn(
      "index",
      `session ${row.id} illisible : affichée d'après la base`,
      error,
    );
    return liteSession(row);
  }
}

/**
 * Vues de `rows` avec file et estimation. L'historique de durées et la file comptent TOUTES les
 * sessions (c'est la machine qui travaille), mais ne sortent que les lignes demandées.
 */
async function viewsFor(
  db: Db,
  me: Actor,
  rows: Array<MetaRow & Perso>,
): Promise<ApiSession[]> {
  const real = new Map<string, Session>();
  for (const row of rows) {
    const session = await load(db, row);
    if (session) real.set(row.id, session);
  }
  const others = estimationRows(db)
    .filter((row) => !real.has(row.id))
    .map(liteSession);
  const views = buildViews([...real.values(), ...others], currentContext());
  const byId = new Map(views.map((view) => [view.id, view]));
  const out: ApiSession[] = [];
  for (const queried of rows) {
    const view = byId.get(queried.id);
    if (!view || !real.has(queried.id)) continue;
    // Lire la session sur le disque peut avoir adopté une fin d'analyse et mis l'index à jour :
    // l'état, l'étiquette et le « non lu » sont relus pour ne pas répondre avec la valeur d'avant.
    out.push(compose(me, getListed(db, me.id, queried.id) ?? queried, view));
  }
  return out;
}

export type SessionPage = {
  items: ApiSession[];
  next_cursor: string | null;
  total: number;
  counts: Counts;
};

export async function listForUser(
  db: Db,
  me: Actor,
  query: ListQuery,
): Promise<SessionPage> {
  const page = listPage(db, me.id, query);
  return {
    items: await viewsFor(db, me, page.items),
    next_cursor: page.next_cursor,
    total: page.total,
    counts: listCounts(db, me.id, query),
  };
}

/** Une session, avec ses compteurs propres à l'utilisateur. */
export async function viewForUser(
  db: Db,
  me: Actor,
  meta: MetaRow,
): Promise<ApiSession | null> {
  const [item] = await viewsFor(db, me, [
    { ...meta, owner_name: meta.owner_name, ...viewState(db, me.id, meta.id) },
  ]);
  return item ?? null;
}

export type DiskUsage = {
  used_bytes: number;
  free_bytes: number | null;
  total_bytes: number | null;
};

async function diskUsage(rows: MetaRow[]): Promise<DiskUsage> {
  const used = rows.reduce((sum, row) => sum + row.disk_bytes, 0);
  try {
    const info = await statfs(reviewRoot());
    return {
      used_bytes: used,
      free_bytes: Number(info.bavail) * Number(info.bsize),
      total_bytes: Number(info.blocks) * Number(info.bsize),
    };
  } catch {
    return { used_bytes: used, free_bytes: null, total_bytes: null };
  }
}

export type VisibleStats = Stats & {
  disk: DiskUsage;
  totals: { sessions: number; audio_bytes: number; audio_hours: number };
};

/** Statistiques de la machine pour CET utilisateur : les sessions globales et les siennes seulement. */
export async function statsForUser(db: Db, me: Actor): Promise<VisibleStats> {
  const rows = visibleRows(db, me.id);
  const sessions = rows.map((row) => ({
    ...liteSession(row),
    // Le « non lu » d'une session est le sien, pas celui des autres.
    viewed_at: row.unread
      ? null
      : (row.viewed_at ?? row.finished_at ?? row.created_at),
  }));
  const stats = buildStats(sessions, currentContext());
  return {
    ...stats,
    disk: await diskUsage(rows),
    totals: {
      sessions: rows.length,
      audio_bytes: rows.reduce((sum, row) => sum + row.size_bytes, 0),
      audio_hours:
        rows.reduce((sum, row) => sum + (row.audio_duration_s ?? 0), 0) / 3600,
    },
  };
}
