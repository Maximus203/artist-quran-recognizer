/**
 * Ce que voit chaque rôle de l'atelier. Le récitateur enregistre, relit (lecture), range ses récitations
 * en playlists et exporte sa vidéo : il n'a ni les tests, ni la revue humaine, ni les performances, ni le
 * direct. Fonctions PURES, sans accès aux données : les RÈGLES DE SÉCURITÉ restent dans `access.ts`
 * (le serveur refuse, quoi que l'interface affiche).
 */
import type { Role } from "./users";

/** Pages de la barre du haut. */
export type PageId =
  | "revue"
  | "sessions"
  | "perf"
  | "live"
  | "docs"
  | "playlists";

/** Pages visibles par le récitateur : la lecture, ses récitations et ses playlists. */
const RECITANT_PAGES: readonly PageId[] = ["revue", "sessions", "playlists"];

export const pageVisibleTo = (role: Role, page: PageId): boolean =>
  role !== "recitant" || RECITANT_PAGES.includes(page);

/** Page d'atterrissage : la lecture (où l'on enregistre) pour tous les rôles. */
export const landingFor = (_role: Role): string => "/";

/** Lien d'ouverture d'une récitation : la lecture, pour tous les rôles. */
export const sessionHref = (_role: Role, id: string): string =>
  `/?session=${id}`;

/** La relecture (signalements) est réservée aux testeurs et administrateurs. */
export const canReview = (role: Role): boolean => role !== "recitant";

/** Les sous-titres (export texte) sont réservés aux testeurs et administrateurs. */
export const canSeeSubtitles = (role: Role): boolean => role !== "recitant";
