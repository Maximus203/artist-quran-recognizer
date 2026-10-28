import { z } from "zod";
import { BACKGROUND_PRESETS } from "./export-video-backgrounds";
import {
  ARABIC_SIZE_PRESETS,
  DEFAULT_VIDEO_PREFS,
  TRANSLATION_SIZE_PRESETS,
  type VideoPrefs,
} from "./export-video-prefs";

/**
 * Options de l'export vidéo demandé par l'API : les mêmes réglages que le formulaire de l'atelier
 * (format, tailles, traduction, fond), nommés en snake_case. Une taille se donne en points
 * (même échelle que le formulaire) ou par un nom (« small », « medium », « large », « xlarge »).
 * Pur : validé ici, rendu par le navigateur sans interface (`video-jobs.ts`).
 */
const SIZE_NAMES = {
  small: "s",
  medium: "m",
  large: "l",
  xlarge: "xl",
} as const;
type SizeName = keyof typeof SIZE_NAMES;

const sizeName = z.enum(["small", "medium", "large", "xlarge"]);
const BACKGROUND_IDS = [
  ...BACKGROUND_PRESETS.map((preset) => preset.id),
  "source",
  "color",
] as const;

export const videoJobOptionsSchema = z
  .object({
    orientation: z.enum(["16:9", "9:16", "1:1", "source"]).optional(),
    arabic_size: z
      .union([z.number().int().min(40).max(140), sizeName])
      .optional(),
    translation_size: z
      .union([z.number().int().min(16).max(64), sizeName])
      .optional(),
    show_translation: z.boolean().optional(),
    /** Identifiant d'un fond proposé, « source » (vidéo d'origine) ou « color » (couleur unie). */
    background: z.enum(BACKGROUND_IDS).optional(),
    /** Couleur unie `#rrggbb` (avec `background: "color"`). */
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
  })
  .strict();

export type VideoJobOptions = z.infer<typeof videoJobOptionsSchema>;

function pickSize(
  value: number | SizeName | undefined,
  presets: readonly { id: string; size: number }[],
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value === "number") return value;
  const preset = presets.find((p) => p.id === SIZE_NAMES[value]);
  return preset ? preset.size : fallback;
}

/** Réglages du rendu : ce qui n'est pas demandé prend la valeur par défaut du formulaire. */
export function videoPrefsFromOptions(
  options: VideoJobOptions,
  hasUpload: boolean,
): VideoPrefs {
  return {
    orientation: options.orientation ?? DEFAULT_VIDEO_PREFS.orientation,
    arabicSize: pickSize(
      options.arabic_size,
      ARABIC_SIZE_PRESETS,
      DEFAULT_VIDEO_PREFS.arabicSize,
    ),
    translationSize: pickSize(
      options.translation_size,
      TRANSLATION_SIZE_PRESETS,
      DEFAULT_VIDEO_PREFS.translationSize,
    ),
    showTranslation:
      options.show_translation ?? DEFAULT_VIDEO_PREFS.showTranslation,
    bg: options.color ?? DEFAULT_VIDEO_PREFS.bg,
    // Une image envoyée l'emporte : le rendu ne lit alors pas ce choix.
    background: hasUpload ? null : (options.background ?? null),
  };
}

/** Catalogue lisible des options (pour `GET /api/v1/export/options` et les agents). */
export function videoOptionsCatalog() {
  return {
    orientation: ["16:9", "9:16", "1:1", "source"],
    orientation_notes:
      "« source » reprend les dimensions de la vidéo importée (sessions vidéo seulement).",
    arabic_size: {
      points: { min: 40, max: 140 },
      names: Object.fromEntries(
        Object.entries(SIZE_NAMES).map(([name, id]) => [
          name,
          ARABIC_SIZE_PRESETS.find((p) => p.id === id)?.size,
        ]),
      ),
    },
    translation_size: {
      points: { min: 16, max: 64 },
      names: Object.fromEntries(
        Object.entries(SIZE_NAMES).map(([name, id]) => [
          name,
          TRANSLATION_SIZE_PRESETS.find((p) => p.id === id)?.size,
        ]),
      ),
    },
    show_translation: "boolean",
    background: {
      ids: BACKGROUND_IDS,
      notes:
        "Sans choix : la vidéo d'origine pour une session vidéo, sinon le dégradé « nuit-doree ». « color » + `color` donne une couleur unie. Une image PNG/JPEG/WebP envoyée dans le champ multipart `background_image` l'emporte sur tout.",
      presets: BACKGROUND_PRESETS.map((p) => ({
        id: p.id,
        label: p.label,
        kind: p.kind,
      })),
    },
    defaults: {
      orientation: DEFAULT_VIDEO_PREFS.orientation,
      arabic_size: DEFAULT_VIDEO_PREFS.arabicSize,
      translation_size: DEFAULT_VIDEO_PREFS.translationSize,
      show_translation: DEFAULT_VIDEO_PREFS.showTranslation,
    },
  };
}
