import { z } from "zod";
import { AUDIO_OFFSET } from "./audio-offset";
import { QURAN_FONTS, type QuranFontId } from "./quran-fonts";
import { ENGINE_FILTERS, SCOPES, SORTS, STATE_FILTERS } from "./session-query";

/**
 * Schéma des préférences, sûr côté navigateur : aucun accès à la base ici (`preferences.ts` y
 * ajoute la lecture et l'écriture serveur et ré-exporte tout ceci).
 *
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

export const preferencesShape = {
  theme: z.enum(["system", "light", "dark"]),
  arabicFont: z.enum(fontIds).nullable(),
  arabicSize: z.number().int().min(28).max(72).multipleOf(4).nullable(),
  translation: z.boolean(),
  /** Surligner en direct le mot arabe récité et le fragment de traduction correspondant. */
  liveHighlight: z.boolean(),
  /** Décalage audio (ms) : retarde le surlignage (écouteurs Bluetooth). Bornes dans `audio-offset.ts`. */
  audioOffsetMs: z
    .number()
    .int()
    .min(AUDIO_OFFSET.min)
    .max(AUDIO_OFFSET.max)
    .multipleOf(AUDIO_OFFSET.step),
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
  defaultVisibility: z.enum(["global", "private"]),
} as const;

export type Preferences = {
  [K in keyof typeof preferencesShape]: z.infer<(typeof preferencesShape)[K]>;
};
export type PreferenceKey = keyof Preferences;

/** Valeurs par défaut : l'unique source. */
export const PREFERENCE_DEFAULTS: Preferences = {
  theme: "system",
  arabicFont: null,
  arabicSize: null,
  translation: true,
  liveHighlight: true,
  audioOffsetMs: AUDIO_OFFSET.fallback,
  visibleSpanSeconds: null,
  followPlayback: true,
  leftPanelOpen: null,
  rightPanelOpen: null,
  sessionsFilter: { scope: "all", state: "all", engine: "all", sort: "recent" },
  playbackRate: 1,
  volume: 1,
  shortcutsEnabled: true,
  reviewTab: "sig",
  defaultVisibility: "private",
};

export const PREFERENCE_KEYS = Object.keys(preferencesShape) as PreferenceKey[];

/** Corps d'une mise à jour : clés connues seulement (les autres sont REFUSÉES), fusion partielle. */
export const preferencesPatchSchema = z
  .object(preferencesShape)
  .partial()
  .strict();

export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;

export const isPreferenceKey = (value: unknown): value is PreferenceKey =>
  typeof value === "string" && value in preferencesShape;
