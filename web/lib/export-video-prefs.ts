import { z } from "zod";
import type { VideoOrientation } from "./export-video-args";
import { EXPORT_VIDEO_CONFIG } from "./export-video-config";
import { DEFAULT_LEAD_IN, DEFAULT_TAIL_OUT } from "./export-video-suggest";
import {
  DEFAULT_VIDEO_FPS,
  DEFAULT_VIDEO_RESOLUTION,
  VIDEO_FPS_CHOICES,
  VIDEO_RESOLUTION_VALUES,
  type VideoFps,
  type VideoResolution,
} from "./export-video-format";

/**
 * Réglages de l'export vidéo, mémorisés dans le navigateur (`aqr.ui.v1.export-video`)
 * comme les réglages de sous-titres : un confort par appareil, jamais un état qui compte.
 * Les tailles d'écriture et le format par défaut s'y sauvegardent dès qu'on les change.
 */

export const VIDEO_ORIENTATIONS_WITH_SOURCE = [
  "16:9",
  "9:16",
  "1:1",
  "source",
] as const;
export type VideoPrefsOrientation =
  (typeof VIDEO_ORIENTATIONS_WITH_SOURCE)[number];

export const VIDEO_PREFS_KEY = "aqr.ui.v1.export-video";

/** Couleur d'accent personnalisée : teinte, intensité (saturation), luminosité, opacité. */
export const accentSchema = z
  .object({
    h: z.number().min(0).max(360),
    s: z.number().min(0).max(100),
    l: z.number().min(20).max(90),
    a: z.number().min(0.3).max(1),
  })
  .strict();
export type AccentColor = z.infer<typeof accentSchema>;

export const videoPrefsSchema = z
  .object({
    orientation: z.enum(VIDEO_ORIENTATIONS_WITH_SOURCE),
    /** Taille de l'écriture arabe (px, dans la vidéo 1080p de référence). */
    arabicSize: z.number().int().min(40).max(240),
    /** Taille de la traduction (px). */
    translationSize: z.number().int().min(16).max(140),
    showTranslation: z.boolean(),
    /** Résolution : taille du côté court de l'image (720 = 1280×720 en 16:9). */
    resolution: z
      .number()
      .refine((v): v is VideoResolution =>
        (VIDEO_RESOLUTION_VALUES as readonly number[]).includes(v),
      )
      .default(DEFAULT_VIDEO_RESOLUTION),
    /** Images par seconde : 30, ou 60 pour plus de fluidité (fichier plus lourd). */
    fps: z
      .number()
      .refine((v): v is VideoFps =>
        (VIDEO_FPS_CHOICES as readonly number[]).includes(v),
      )
      .default(DEFAULT_VIDEO_FPS),
    /** « Remplir » : les écritures grandissent jusqu'à occuper toute la zone libre. */
    fill: z.boolean().default(false),
    /** Hauteur du texte dans la zone libre : 0 = en haut, 50 = au centre, 100 = en bas. */
    textPosition: z.number().min(0).max(100).default(50),
    /** Onde audio affichée en bas (sinon le texte peut occuper toute la hauteur). */
    showWave: z.boolean().default(true),
    /** Couleur d'accent (mot récité, référence) ; null = automatique (couleur principale du fond). */
    accent: accentSchema.nullable().default(null),
    bg: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    /** Fond choisi : id d'un fond proposé, « source », « color », ou null = automatique. */
    background: z.string().min(1).max(40).nullable().default(null),
    /** Souffle gardé avant la voix (s) dans les plages proposées ; mêmes marges que l'API (`lead_in`). */
    paddingBefore: z
      .number()
      .min(EXPORT_VIDEO_CONFIG.padding.min)
      .max(EXPORT_VIDEO_CONFIG.padding.max)
      .default(DEFAULT_LEAD_IN),
    /** Souffle gardé après la voix (s) ; `tail_out` côté API. */
    paddingAfter: z
      .number()
      .min(EXPORT_VIDEO_CONFIG.padding.min)
      .max(EXPORT_VIDEO_CONFIG.padding.max)
      .default(DEFAULT_TAIL_OUT),
    /** Aimanter les bords au silence le plus proche ; `snap_to_silence` côté API. */
    snapToSilence: z.boolean().default(true),
  })
  .strict();

export type VideoPrefs = z.infer<typeof videoPrefsSchema>;

/** Tailles proposées en un clic (px dans la vidéo de référence de 1080 px de côté court). */
export const ARABIC_SIZE_PRESETS = [
  { id: "s", label: "Petit", size: 56 },
  { id: "m", label: "Moyen", size: 72 },
  { id: "l", label: "Grand", size: 96 },
  { id: "xl", label: "Très grand", size: 120 },
] as const;
export const TRANSLATION_SIZE_PRESETS = [
  { id: "s", label: "Petit", size: 24 },
  { id: "m", label: "Moyen", size: 30 },
  { id: "l", label: "Grand", size: 40 },
  { id: "xl", label: "Très grand", size: 52 },
] as const;

export const DEFAULT_VIDEO_PREFS: VideoPrefs = {
  orientation: "16:9",
  arabicSize: 72,
  translationSize: 30,
  showTranslation: true,
  resolution: DEFAULT_VIDEO_RESOLUTION,
  fps: DEFAULT_VIDEO_FPS,
  bg: "#101418",
  background: null,
  fill: false,
  textPosition: 50,
  showWave: true,
  accent: null,
  paddingBefore: DEFAULT_LEAD_IN,
  paddingAfter: DEFAULT_TAIL_OUT,
  snapToSilence: true,
};

type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "setItem">;

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Réglages mémorisés, sinon défauts ; contenu illisible ou périmé = défauts. */
export function loadVideoPrefs(
  storage: Reader | null = browserStorage(),
): VideoPrefs {
  try {
    const raw = storage?.getItem(VIDEO_PREFS_KEY);
    if (!raw) return DEFAULT_VIDEO_PREFS;
    const parsed = videoPrefsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_VIDEO_PREFS;
  } catch {
    return DEFAULT_VIDEO_PREFS;
  }
}

export function saveVideoPrefs(
  prefs: VideoPrefs,
  storage: Writer | null = browserStorage(),
): void {
  try {
    storage?.setItem(VIDEO_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* stockage plein ou bloqué : le réglage vaut pour cette page seulement */
  }
}

/** Orientation effective : « source » se résout au moment de l'export (vidéo source). */
export function resolveOrientation(
  prefs: VideoPrefs,
  sourceSize: { width: number; height: number } | null,
): VideoOrientation {
  if (prefs.orientation !== "source") return prefs.orientation;
  if (!sourceSize) return "16:9";
  return sourceSize.width >= sourceSize.height ? "16:9" : "9:16";
}
