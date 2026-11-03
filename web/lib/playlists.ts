import { canView, isAdmin, type Actor } from "./access";
import type { Db } from "./db";
import { transaction } from "./db";

/**
 * Playlists : un compte regroupe des audios (sessions) et les lit à la suite. Une playlist est PRIVÉE à son
 * propriétaire (même l'administrateur ne la voit pas) et ne donne accès à rien : chaque audio garde le droit
 * de sa session (`canView`). Une session devenue invisible sort de la lecture sans quitter la playlist (elle
 * revient si elle redevient visible) ; une session supprimée sort pour de bon (cascade).
 */
export const MAX_PLAYLISTS = 50;
export const MAX_ITEMS = 200;
export const MAX_NAME = 60;

export class PlaylistLimitError extends Error {
  constructor() {
    super(
      `${MAX_PLAYLISTS} playlists au plus : supprime-en une avant d'en créer.`,
    );
    this.name = "PlaylistLimitError";
  }
}
export class PlaylistFullError extends Error {
  constructor() {
    super(`Une playlist contient ${MAX_ITEMS} audios au plus.`);
    this.name = "PlaylistFullError";
  }
}

export type Playlist = {
  id: number;
  owner_id: number;
  name: string;
  created_at: string;
  updated_at: string;
};
export type PlaylistSummary = Playlist & { count: number; duration_s: number };
export type PlaylistItem = {
  session_id: string;
  position: number;
  name: string;
  state: string;
  audio_duration_s: number | null;
};
export type PlaylistDetail = Playlist & { items: PlaylistItem[] };

export function cleanPlaylistName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= MAX_NAME ? name : null;
}

/** Condition SQL « l'acteur voit la session » (la même règle que `canView`) : paramètres (id, 1 si administrateur). */
const VISIBLE = "(m.visibility = 'global' OR m.owner_id = ? OR ? = 1)";
const visibleParams = (actor: Actor): [number, number] => [
  actor.id,
  isAdmin(actor) ? 1 : 0,
];

const COLUMNS = "id, owner_id, name, created_at, updated_at";
const owned = (db: Db, id: number, ownerId: number): Playlist | null =>
  (db
    .prepare(`SELECT ${COLUMNS} FROM playlists WHERE id = ? AND owner_id = ?`)
    .get(id, ownerId) as Playlist | undefined) ?? null;

export function createPlaylist(
  db: Db,
  ownerId: number,
  name: string,
  now = new Date().toISOString(),
): Playlist {
  return transaction(db, () => {
    const { n } = db
      .prepare("SELECT COUNT(*) AS n FROM playlists WHERE owner_id = ?")
      .get(ownerId) as { n: number };
    if (n >= MAX_PLAYLISTS) throw new PlaylistLimitError();
    const info = db
      .prepare(
        "INSERT INTO playlists (owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(ownerId, name, now, now);
    return db
      .prepare(`SELECT ${COLUMNS} FROM playlists WHERE id = ?`)
      .get(Number(info.lastInsertRowid)) as Playlist;
  });
}

/** Les playlists d'un compte, la plus récemment modifiée d'abord, avec le nombre et la durée des audios lisibles. */
export function listPlaylists(db: Db, actor: Actor): PlaylistSummary[] {
  return (
    db
      .prepare(
        `SELECT p.id, p.owner_id, p.name, p.created_at, p.updated_at,
                COUNT(m.id) AS count, COALESCE(SUM(m.audio_duration_s), 0) AS duration_s
         FROM playlists p
         LEFT JOIN playlist_items i ON i.playlist_id = p.id
         LEFT JOIN session_meta m ON m.id = i.session_id AND ${VISIBLE}
         WHERE p.owner_id = ?
         GROUP BY p.id
         ORDER BY p.updated_at DESC, p.id DESC`,
      )
      .all(...visibleParams(actor), actor.id) as PlaylistSummary[]
  ).map((row) => ({ ...row, count: Number(row.count) }));
}

/** Une playlist avec ses audios lisibles, dans l'ordre. `null` si elle n'existe pas ou n'est pas à l'acteur. */
export function getPlaylist(
  db: Db,
  id: number,
  actor: Actor,
): PlaylistDetail | null {
  const playlist = owned(db, id, actor.id);
  if (!playlist) return null;
  const items = db
    .prepare(
      `SELECT i.session_id, i.position, m.name, m.state, m.audio_duration_s
       FROM playlist_items i JOIN session_meta m ON m.id = i.session_id
       WHERE i.playlist_id = ? AND ${VISIBLE}
       ORDER BY i.position`,
    )
    .all(id, ...visibleParams(actor)) as PlaylistItem[];
  return { ...playlist, items };
}

const touch = (db: Db, id: number, now: string) =>
  db.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(now, id);

export function renamePlaylist(
  db: Db,
  id: number,
  ownerId: number,
  name: string,
  now = new Date().toISOString(),
): boolean {
  const info = db
    .prepare(
      "UPDATE playlists SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
    )
    .run(name, now, id, ownerId);
  return Number(info.changes) > 0;
}

export function deletePlaylist(db: Db, id: number, ownerId: number): boolean {
  const info = db
    .prepare("DELETE FROM playlists WHERE id = ? AND owner_id = ?")
    .run(id, ownerId);
  return Number(info.changes) > 0;
}

/**
 * Ajoute des audios à la suite. Passent seulement les sessions que l'acteur voit, une fois chacune ; le reste est
 * « ignoré ». `null` si la playlist n'est pas à l'acteur. Lève `PlaylistFullError` au-delà de `MAX_ITEMS`.
 */
export function addToPlaylist(
  db: Db,
  id: number,
  actor: Actor,
  sessionIds: readonly string[],
  now = new Date().toISOString(),
): { added: number; skipped: number } | null {
  return transaction(db, () => {
    if (!owned(db, id, actor.id)) return null;
    const have = new Set(
      (
        db
          .prepare(
            "SELECT session_id FROM playlist_items WHERE playlist_id = ?",
          )
          .all(id) as { session_id: string }[]
      ).map((row) => row.session_id),
    );
    const accepted: string[] = [];
    for (const sessionId of sessionIds) {
      if (have.has(sessionId) || accepted.includes(sessionId)) continue;
      const meta = db
        .prepare("SELECT owner_id, visibility FROM session_meta WHERE id = ?")
        .get(sessionId) as
        | { owner_id: number | null; visibility: "global" | "private" }
        | undefined;
      if (meta && canView(actor, meta)) accepted.push(sessionId);
    }
    if (have.size + accepted.length > MAX_ITEMS) throw new PlaylistFullError();
    let position = (
      db
        .prepare(
          "SELECT COALESCE(MAX(position), -1) AS p FROM playlist_items WHERE playlist_id = ?",
        )
        .get(id) as { p: number }
    ).p;
    const insert = db.prepare(
      "INSERT INTO playlist_items (playlist_id, session_id, position, added_at) VALUES (?, ?, ?, ?)",
    );
    for (const sessionId of accepted)
      insert.run(id, sessionId, ++position, now);
    if (accepted.length > 0) touch(db, id, now);
    return {
      added: accepted.length,
      skipped: sessionIds.length - accepted.length,
    };
  });
}

/** Renumérote 0, 1, 2… dans l'ordre actuel (aucun trou). */
function compact(db: Db, id: number): void {
  const rows = db
    .prepare(
      "SELECT session_id FROM playlist_items WHERE playlist_id = ? ORDER BY position",
    )
    .all(id) as { session_id: string }[];
  const update = db.prepare(
    "UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND session_id = ?",
  );
  rows.forEach((row, index) => update.run(index, id, row.session_id));
}

export function removeFromPlaylist(
  db: Db,
  id: number,
  ownerId: number,
  sessionId: string,
  now = new Date().toISOString(),
): boolean {
  return transaction(db, () => {
    if (!owned(db, id, ownerId)) return false;
    const info = db
      .prepare(
        "DELETE FROM playlist_items WHERE playlist_id = ? AND session_id = ?",
      )
      .run(id, sessionId);
    if (Number(info.changes) === 0) return false;
    compact(db, id);
    touch(db, id, now);
    return true;
  });
}

/**
 * Nouvel ordre des audios que l'acteur voit : il doit en être EXACTEMENT une permutation (sinon `false`, rien
 * ne change). Les audios devenus invisibles, que l'acteur ne connaît pas, se rangent après, dans leur ordre.
 */
export function reorderPlaylist(
  db: Db,
  id: number,
  actor: Actor,
  orderedIds: readonly string[],
  now = new Date().toISOString(),
): boolean {
  return transaction(db, () => {
    const detail = getPlaylist(db, id, actor);
    if (!detail) return false;
    const visible = detail.items.map((item) => item.session_id);
    const wanted = new Set(orderedIds);
    if (
      wanted.size !== orderedIds.length ||
      wanted.size !== visible.length ||
      !visible.every((sessionId) => wanted.has(sessionId))
    )
      return false;
    const hidden = (
      db
        .prepare(
          "SELECT session_id FROM playlist_items WHERE playlist_id = ? ORDER BY position",
        )
        .all(id) as { session_id: string }[]
    )
      .map((row) => row.session_id)
      .filter((sessionId) => !wanted.has(sessionId));
    const update = db.prepare(
      "UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND session_id = ?",
    );
    [...orderedIds, ...hidden].forEach((sessionId, index) =>
      update.run(index, id, sessionId),
    );
    touch(db, id, now);
    return true;
  });
}
