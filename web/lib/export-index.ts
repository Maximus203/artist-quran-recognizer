import type { Db } from "./db";
import { listVideos, type VideoRecord } from "./video-library";

/**
 * Index SQL des exports vidéo gardés sur le serveur (table `exports`, migration 009). Les fichiers
 * restent la source de vérité (`video-library.ts`) : ce module tient l'index à jour à l'écriture et à
 * la suppression, et le recale depuis le disque pour les vidéos d'avant l'index.
 */
export type ExportRecord = {
  id: string;
  sessionId: string;
  ownerId: number | null;
  name: string;
  bytes: number;
  createdAt: string;
};

export function recordExport(db: Db, record: ExportRecord): void {
  db.prepare(
    `INSERT OR REPLACE INTO exports (id, session_id, owner_id, name, bytes, created_at, seen_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    record.id,
    record.sessionId,
    record.ownerId,
    record.name,
    record.bytes,
    record.createdAt,
  );
}

export function forgetExport(db: Db, id: string): void {
  db.prepare("DELETE FROM exports WHERE id = ?").run(id);
}

/** L'utilisateur a ouvert la liste : ses exports de cette session ne sont plus « nouveaux ». */
export function markExportsSeen(
  db: Db,
  sessionId: string,
  userId: number,
  now: string,
): void {
  db.prepare(
    `UPDATE exports SET seen_at = ?
     WHERE session_id = ? AND owner_id = ? AND seen_at IS NULL`,
  ).run(now, sessionId, userId);
}

/**
 * Recale l'index d'une session sur les fichiers présents : ajoute les vidéos inconnues (anciennes),
 * retire les lignes dont le fichier a disparu. `ownerFallback` : propriétaire de la session, pour les
 * vidéos d'avant l'index (le lanceur n'est pas connu).
 */
export async function reconcileSessionExports(
  db: Db,
  sessionId: string,
  ownerFallback: number | null,
): Promise<VideoRecord[]> {
  const videos = await listVideos(sessionId);
  const known = new Set(
    (
      db
        .prepare("SELECT id FROM exports WHERE session_id = ?")
        .all(sessionId) as Array<{ id: string }>
    ).map((row) => row.id),
  );
  const present = new Set(videos.map((video) => video.id));
  for (const video of videos)
    if (!known.has(video.id))
      recordExport(db, {
        id: video.id,
        sessionId,
        ownerId: ownerFallback,
        name: video.name,
        bytes: video.bytes,
        createdAt: video.created_at,
      });
  for (const id of known) if (!present.has(id)) forgetExport(db, id);
  return videos;
}

/**
 * Au démarrage : recale l'index de TOUTES les sessions. Les vidéos gardées avant la migration 009 sont
 * sur le disque sans ligne ; sans ce recalage, leur session afficherait 0 export jusqu'à son ouverture.
 */
export async function reconcileAllExports(db: Db): Promise<number> {
  const sessions = db
    .prepare("SELECT id, owner_id FROM session_meta")
    .all() as Array<{ id: string; owner_id: number | null }>;
  let total = 0;
  for (const session of sessions) {
    const videos = await reconcileSessionExports(
      db,
      session.id,
      session.owner_id,
    ).catch(() => []);
    total += videos.length;
  }
  return total;
}

export type ExportSummary = {
  /** Exports gardés pour la session (tous lanceurs confondus). */
  total: number;
  /** Nouveaux pour CET utilisateur : lancés par lui, pas encore ouverts. */
  new: number;
};

export function exportSummary(
  db: Db,
  sessionId: string,
  userId: number,
): ExportSummary {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN owner_id = ? AND seen_at IS NULL THEN 1 ELSE 0 END), 0) AS new
       FROM exports WHERE session_id = ?`,
    )
    .get(userId, sessionId) as { total: number; new: number };
  return { total: row.total, new: row.new };
}
