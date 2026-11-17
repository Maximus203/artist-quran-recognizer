import type { Db } from "./db";
import {
  sanitizeVideoPrefs,
  videoPrefsSchema,
  type VideoPrefs,
} from "./export-video-prefs";
import { log } from "./log";

/**
 * Réglages de l'éditeur d'export, PAR VIDÉO (par session) et par compte : Repository de la table
 * `session_video_prefs` (migration 012). Le réglage global du compte (`videoPrefs`, `preferences.ts`) n'est
 * qu'un point de départ pour une vidéo jamais personnalisée : il ne passe pas par ici.
 *
 * L'autorisation (qui peut lire ou écrire quelle vidéo) se décide AVANT, dans la route (`sessionAccess`) ;
 * ce module ne connaît que `(userId, sessionId)` et ne mélange jamais deux clés.
 */
export type SessionVideoPrefsRow = { prefs: VideoPrefs; updated_at: string };

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Réglages enregistrés pour cette vidéo, ou `null` (jamais personnalisée, ou ligne illisible). */
export function readSessionVideoPrefs(
  db: Db,
  userId: number,
  sessionId: string,
): SessionVideoPrefsRow | null {
  const row = db
    .prepare(
      "SELECT prefs, updated_at FROM session_video_prefs WHERE user_id = ? AND session_id = ?",
    )
    .get(userId, sessionId) as
    | { prefs: string; updated_at: string }
    | undefined;
  if (!row) return null;
  const json = safeJson(row.prefs);
  if (json === undefined) {
    log.warn("video-prefs", "réglages de vidéo illisibles : ignorés");
    return null;
  }
  // Même récupération champ par champ que pour le réglage du compte : une valeur invalide ne perd pas le reste.
  const parsed = videoPrefsSchema.safeParse(json);
  return {
    prefs: parsed.success ? parsed.data : sanitizeVideoPrefs(json),
    updated_at: row.updated_at,
  };
}

/** Enregistre (remplace) les réglages de cette vidéo. Jette si `prefs` n'est pas valide : rien n'est écrit. */
export function writeSessionVideoPrefs(
  db: Db,
  userId: number,
  sessionId: string,
  prefs: VideoPrefs,
  now = new Date().toISOString(),
): SessionVideoPrefsRow {
  const valid = videoPrefsSchema.parse(prefs);
  db.prepare(
    `INSERT INTO session_video_prefs (user_id, session_id, prefs, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, session_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at`,
  ).run(userId, sessionId, JSON.stringify(valid), now);
  return { prefs: valid, updated_at: now };
}

/** Remet cette vidéo à son point de départ (idempotent). */
export function deleteSessionVideoPrefs(
  db: Db,
  userId: number,
  sessionId: string,
): void {
  db.prepare(
    "DELETE FROM session_video_prefs WHERE user_id = ? AND session_id = ?",
  ).run(userId, sessionId);
}
