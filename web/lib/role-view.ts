/**
 * Ce que voit chaque rôle de l'atelier. Le récitateur enregistre et exporte sa vidéo : son interface se
 * réduit à la page Sessions, à l'export vidéo et au compte. Fonctions PURES, sans accès aux données : les
 * RÈGLES DE SÉCURITÉ restent dans `access.ts` (le serveur refuse, quoi que l'interface affiche).
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

/** Pages visibles par le récitateur : ses sessions, et rien d'autre. */
const RECITANT_PAGES: readonly PageId[] = ["sessions"];

export const pageVisibleTo = (role: Role, page: PageId): boolean =>
  role !== "recitant" || RECITANT_PAGES.includes(page);

/** Page d'atterrissage : la revue pour le testeur et l'administrateur, les sessions pour le récitateur. */
export const landingFor = (role: Role): string =>
  pageVisibleTo(role, "revue") ? "/" : "/sessions";

/** Lien d'ouverture d'une session : l'export vidéo pour le récitateur, la revue pour les autres. */
export const sessionHref = (role: Role, id: string): string =>
  role === "recitant" ? `/s/${id}/exporter` : `/?session=${id}`;

/** La relecture (signalements) est réservée aux testeurs et administrateurs. */
export const canReview = (role: Role): boolean => role !== "recitant";

/** Les sous-titres (export texte) sont réservés aux testeurs et administrateurs. */
export const canSeeSubtitles = (role: Role): boolean => role !== "recitant";
