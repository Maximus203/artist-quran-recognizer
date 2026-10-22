import {
  QURAN_FONTS,
  isQuranFontId,
  type QuranFontId,
} from "./quran-fonts";
import { sanitizeRecent, validateTester } from "./tester";

/**
 * Préférences d'interface, mémorisées dans le navigateur (`localStorage`, clé `aqr.ui.v1`).
 * Rien n'est jamais fiable : chaque champ est validé à la lecture, et un stockage bloqué (fenêtre
 * privée) ne casse rien.
 */
export const UI_STORAGE_KEY = "aqr.ui.v1";

export type ThemePref = "system" | "light" | "dark";

export type UiPrefs = {
  theme: ThemePref;
  /** Police arabe choisie ; null = pas de choix (Hafs V30 si installée, sinon Amiri Quran). */
  font: QuranFontId | null;
  /** Taille du texte arabe en px ; null = valeur par défaut du thème (40 bureau, 32 mobile). */
  size: number | null;
  /** Panneaux repliés ou ouverts (bureau) ; null = valeur par défaut. */
  left: boolean | null;
  right: boolean | null;
  translation: boolean;
  /** Raccourcis à une touche (M, P, L) : désactivables (WCAG 2.1.4). */
  shortcuts: boolean;
  tester: string | null;
  testers: string[];
};

export const DEFAULT_PREFS: UiPrefs = {
  theme: "system",
  font: null,
  size: null,
  left: null,
  right: null,
  translation: true,
  shortcuts: true,
  tester: null,
  testers: [],
};

export const QURAN_SIZE = { min: 28, max: 72, step: 4, fallback: 40 } as const;

export function clampQuranSize(px: number): number {
  if (!Number.isFinite(px)) return QURAN_SIZE.fallback;
  const snapped = Math.round(px / QURAN_SIZE.step) * QURAN_SIZE.step;
  return Math.min(QURAN_SIZE.max, Math.max(QURAN_SIZE.min, snapped));
}

export const stepQuranSize = (current: number, direction: -1 | 1): number =>
  clampQuranSize(current + direction * QURAN_SIZE.step);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const bool = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

export function parsePrefs(raw: string | null | undefined): UiPrefs {
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    return { ...DEFAULT_PREFS };
  }
  if (!isRecord(data)) return { ...DEFAULT_PREFS };
  const tester =
    typeof data.tester === "string" ? validateTester(data.tester) : null;
  return {
    theme:
      data.theme === "light" || data.theme === "dark" ? data.theme : "system",
    font: isQuranFontId(data.font) ? data.font : null,
    size: typeof data.size === "number" ? clampQuranSize(data.size) : null,
    left: bool(data.left),
    right: bool(data.right),
    translation: bool(data.translation) ?? true,
    shortcuts: bool(data.shortcuts) ?? true,
    tester: tester?.ok ? tester.value : null,
    testers: sanitizeRecent(data.testers),
  };
}

export const serializePrefs = (prefs: UiPrefs): string =>
  JSON.stringify(prefs);

export const effectiveTheme = (
  pref: ThemePref,
  systemDark: boolean,
): "light" | "dark" =>
  pref === "system" ? (systemDark ? "dark" : "light") : pref;

/** Identifiants de police valides, pour le script d'amorçage (qui ne peut rien importer). */
export const QURAN_FONT_IDS: readonly string[] = QURAN_FONTS.map((f) => f.id);
