import { publicUser, type PublicUser } from "./auth-response";
import { readPreferences, type Preferences } from "./preferences";
import { userQuotaBytes } from "./quota";
import { ready } from "./server-init";
import { usedBytes } from "./session-index";
import type { User } from "./users";

/**
 * Ce que toute page connectée reçoit du serveur AVANT le premier rendu : le compte, ses préférences
 * (donc le thème, la police, les panneaux : aucun clignotement) et son quota. Les mêmes valeurs
 * que `GET /api/me`, lues directement (une seule fois par requête).
 */
export type ShellData = {
  user: PublicUser;
  preferences: Preferences;
  quota: { used_bytes: number; limit_bytes: number | null };
  /** Adresse du dépôt (liens des notes de version). */
  repoUrl: string;
};

export async function loadShellData(user: User): Promise<ShellData> {
  const db = await ready();
  const limit = userQuotaBytes();
  return {
    user: publicUser(user),
    preferences: readPreferences(db, user.id).preferences,
    quota: {
      used_bytes: usedBytes(db, user.id),
      limit_bytes: limit || null,
    },
    repoUrl: repoUrl(),
  };
}

/** Dépôt du projet (notes de version → pull requests) : configurable, jamais écrit dans les pages. */
export const DEFAULT_REPO_URL =
  "https://github.com/Maximus203/artist-quran-recognizer";
export const repoUrl = (): string =>
  (process.env.AQR_REPO_URL ?? "").trim() || DEFAULT_REPO_URL;
