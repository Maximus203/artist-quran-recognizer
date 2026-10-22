import { z } from "zod";
import type { Db } from "./db";
import { transaction } from "./db";
import { log } from "./log";
import { QURAN_FONTS, type QuranFontId } from "./quran-fonts";
import { ENGINE_FILTERS, SCOPES, SORTS, STATE_FILTERS } from "./session-query";

/**
 * Préférences par utilisateur, enregistrées côté serveur et appliquées partout (un testeur retrouve
 * son atelier sur n'importe quel appareil). UN seul fichier porte les clés, leurs types et leurs
 * valeurs par défaut : l'interface n'en redéfinit aucun. Chaque clé est horodatée séparément.
 *
 * `null` veut dire « pas de choix » pour les clés qui ont une valeur automatique (police : Hafs V30
 * si installée ; taille : celle du thème ; panneaux : selon la largeur de l'écran ; fenêtre : tout
 * le fichier).
 */
const fontIds = QURAN_FONTS.map((font) => font.id) as [
  QuranFontId,
  ...QuranFontId[],
];

export const VISIBLE_SPANS = [600, 120, 30, 10] as const;
export const REVIEW_TABS = ["sig", "list", "truth"] as const;

export const sessionsFilterSchema = z
  .object({
    scope: z.enum(SCOPES),
    state: z.enum(["all", ...STATE_FILTERS]),
    engine: z.enum(["all", ...ENGINE_FILTERS]),
    sort: z.enum(SORTS),
  })
  .strict();

const shape = {
  theme: z.enum(["system", "light", "dark"]),
  arabicFont: z.enum(fontIds).nullable(),
  arabicSize: z.number().int().min(28).max(72).multipleOf(4).nullable(),
  translation: z.boolean(),
  visibleSpanSeconds: z
    .union([z.literal(600), z.literal(120), z.literal(30), z.literal(10)])
    .nullable(),
  followPlayback: z.boolean(),
  leftPanelOpen: z.boolean().nullable(),
  rightPanelOpen: z.boolean().nullable(),
  sessionsFilter: sessionsFilterSchema,
  playbackRate: z.number().min(0.25).max(3),
  volume: z.number().min(0).max(1),
  shortcutsEnabled: z.boolean(),
  reviewTab: z.enum(REVIEW_TABS),
} as const;

export type Preferences = {
  [K in keyof typeof shape]: z.infer<(typeof shape)[K]>;
};
export type PreferenceKey = keyof Preferences;

/** Valeurs par défaut : l'unique source. */
export const PREFERENCE_DEFAULTS: Preferences = {
  theme: "system",
  arabicFont: null,
  arabicSize: null,
  translation: true,
  visibleSpanSeconds: null,
  followPlayback: true,
  leftPanelOpen: null,
  rightPanelOpen: null,
  sessionsFilter: { scope: "all", state: "all", engine: "all", sort: "recent" },
  playbackRate: 1,
  volume: 1,
  shortcutsEnabled: true,
  reviewTab: "sig",
};

export const PREFERENCE_KEYS = Object.keys(shape) as PreferenceKey[];

/** Corps d'une mise à jour : clés connues seulement (les autres sont REFUSÉES), fusion partielle. */
export const preferencesPatchSchema = z.object(shape).partial().strict();

export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;

export type PreferencesView = {
  /** Valeurs effectives : choix de l'utilisateur, sinon défaut. */
  preferences: Preferences;
  /** Dernière modification de chaque clé réellement choisie (ISO). Absente = valeur par défaut. */
  updated_at: Partial<Record<PreferenceKey, string>>;
  defaults: Preferences;
};

export function readPreferences(db: Db, userId: number): PreferencesView {
  const rows = db
    .prepare("SELECT key, value, updated_at FROM preferences WHERE user_id = ?")
    .all(userId) as Array<{ key: string; value: string; updated_at: string }>;
  const preferences: Preferences = structuredClone(PREFERENCE_DEFAULTS);
  const updated_at: PreferencesView["updated_at"] = {};
  for (const row of rows) {
    if (!(row.key in shape)) continue; // clé retirée depuis : ignorée
    const key = row.key as PreferenceKey;
    // Jamais fiable : une valeur corrompue ou devenue invalide retombe sur le défaut.
    const parsed = shape[key].safeParse(safeJson(row.value));
    if (!parsed.success) {
      log.warn("preferences", `valeur invalide ignorée pour « ${key} »`);
      continue;
    }
    (preferences as Record<string, unknown>)[key] = parsed.data;
    updated_at[key] = row.updated_at;
  }
  return {
    preferences,
    updated_at,
    defaults: structuredClone(PREFERENCE_DEFAULTS),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Fusion partielle : seules les clés fournies changent, chacune avec son propre horodatage. */
export function patchPreferences(
  db: Db,
  userId: number,
  patch: PreferencesPatch,
  now = new Date().toISOString(),
): PreferencesView {
  transaction(db, () => {
    const statement = db.prepare(
      `INSERT INTO preferences (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    for (const [key, value] of Object.entries(patch))
      if (value !== undefined)
        statement.run(userId, key, JSON.stringify(value), now);
  });
  return readPreferences(db, userId);
}

/** Remet une clé (ou toutes) à sa valeur par défaut. */
export function resetPreferences(
  db: Db,
  userId: number,
  key?: PreferenceKey,
): PreferencesView {
  if (key)
    db.prepare("DELETE FROM preferences WHERE user_id = ? AND key = ?").run(
      userId,
      key,
    );
  else db.prepare("DELETE FROM preferences WHERE user_id = ?").run(userId);
  return readPreferences(db, userId);
}

export const isPreferenceKey = (value: unknown): value is PreferenceKey =>
  typeof value === "string" && value in shape;
