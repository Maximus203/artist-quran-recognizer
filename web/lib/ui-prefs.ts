import { QURAN_FONTS } from "./quran-fonts";

/**
 * Helpers d'affichage liés aux préférences (taille arabe, thème effectif). Les préférences
 * elles-mêmes vivent côté serveur : clés, types et défauts dans `preferences-schema.ts`, synchro
 * dans `prefs-sync.ts`. Rien n'est plus mémorisé ici.
 */
export type ThemePref = "system" | "light" | "dark";

export const QURAN_SIZE = { min: 28, max: 72, step: 4, fallback: 40 } as const;

export function clampQuranSize(px: number): number {
  if (!Number.isFinite(px)) return QURAN_SIZE.fallback;
  const snapped = Math.round(px / QURAN_SIZE.step) * QURAN_SIZE.step;
  return Math.min(QURAN_SIZE.max, Math.max(QURAN_SIZE.min, snapped));
}

export const stepQuranSize = (current: number, direction: -1 | 1): number =>
  clampQuranSize(current + direction * QURAN_SIZE.step);

export const effectiveTheme = (
  pref: ThemePref,
  systemDark: boolean,
): "light" | "dark" =>
  pref === "system" ? (systemDark ? "dark" : "light") : pref;

/** Identifiants de police valides (pour le script d'amorçage, qui ne peut rien importer). */
export const QURAN_FONT_IDS: readonly string[] = QURAN_FONTS.map((f) => f.id);
