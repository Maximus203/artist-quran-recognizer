import { publicUser, type PublicUser } from "./auth-response";
import { readPreferences, type Preferences } from "./preferences";
import { quotaView, type QuotaView } from "./quota-view";
import { ready } from "./server-init";
import type { User } from "./users";

/**
 * Ce que toute page connectée reçoit du serveur AVANT le premier rendu : le compte, ses préférences
 * (donc le thème, la police, les panneaux : aucun clignotement) et son stockage. Les mêmes valeurs
 * que `GET /api/me`, lues directement (une seule fois par requête).
 */
export type ShellData = {
  user: PublicUser;
  preferences: Preferences;
  quota: QuotaView;
  /** Adresse du dépôt (liens des notes de version). */
  repoUrl: string;
};

export async function loadShellData(user: User): Promise<ShellData> {
  const db = await ready();
  return {
    user: publicUser(user),
    preferences: readPreferences(db, user.id).preferences,
    quota: quotaView(db, user.id),
    repoUrl: repoUrl(),
  };
}

/** Dépôt du projet (notes de version → pull requests) : configurable, jamais écrit dans les pages. */
export const DEFAULT_REPO_URL =
  "https://github.com/Maximus203/artist-quran-recognizer";
export const repoUrl = (): string =>
  (process.env.AQR_REPO_URL ?? "").trim() || DEFAULT_REPO_URL;
