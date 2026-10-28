import { z } from "zod";
import { BACKGROUND_PRESETS } from "./export-video-backgrounds";
import {
  accentSchema,
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
      .union([z.number().int().min(40).max(240), sizeName])
      .optional(),
    translation_size: z
      .union([z.number().int().min(16).max(140), sizeName])
      .optional(),
    show_translation: z.boolean().optional(),
    /** Remplir l'espace : le texte grandit pour occuper la zone libre. */
    fill: z.boolean().optional(),
    /** Hauteur du texte : 0 (haut) à 100 (bas), ou « top », « middle », « bottom ». */
    text_position: z
      .union([z.number().min(0).max(100), z.enum(["top", "middle", "bottom"])])
      .optional(),
    /** Afficher l'onde audio en bas. */
    show_wave: z.boolean().optional(),
    /** Couleur d'accent (mot récité, référence) : teinte, saturation, luminosité, opacité ; null = automatique. */
    accent: accentSchema.nullable().optional(),
    /** Nom du fichier téléchargé (sans chemin) ; par défaut celui de l'audio. */
    file_name: z.string().min(1).max(120).optional(),
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

const POSITION_NAMES = { top: 12, middle: 50, bottom: 88 } as const;
function positionOf(value: VideoJobOptions["text_position"]): number {
  if (value === undefined) return DEFAULT_VIDEO_PREFS.textPosition;
  return typeof value === "number" ? value : POSITION_NAMES[value];
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
    fill: options.fill ?? DEFAULT_VIDEO_PREFS.fill,
    textPosition: positionOf(options.text_position),
    showWave: options.show_wave ?? DEFAULT_VIDEO_PREFS.showWave,
    accent: options.accent ?? DEFAULT_VIDEO_PREFS.accent,
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
      points: { min: 40, max: 240 },
      names: Object.fromEntries(
        Object.entries(SIZE_NAMES).map(([name, id]) => [
          name,
          ARABIC_SIZE_PRESETS.find((p) => p.id === id)?.size,
        ]),
      ),
    },
    translation_size: {
      points: { min: 16, max: 140 },
      names: Object.fromEntries(
        Object.entries(SIZE_NAMES).map(([name, id]) => [
          name,
          TRANSLATION_SIZE_PRESETS.find((p) => p.id === id)?.size,
        ]),
      ),
    },
    show_translation: "boolean",
    fill: "boolean (le texte occupe toute la zone libre)",
    text_position: "0 (haut) à 100 (bas), ou top | middle | bottom",
    show_wave: "boolean (onde audio en bas)",
    accent: "{ h: 0-360, s: 0-100, l: 20-90, a: 0.3-1 } ou null (automatique)",
    file_name: "nom du fichier téléchargé, 120 caractères au plus",
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
      fill: DEFAULT_VIDEO_PREFS.fill,
      text_position: DEFAULT_VIDEO_PREFS.textPosition,
      show_wave: DEFAULT_VIDEO_PREFS.showWave,
      accent: DEFAULT_VIDEO_PREFS.accent,
    },
  };
}
