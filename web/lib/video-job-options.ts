import { z } from "zod";
import { BACKGROUND_PRESETS } from "./export-video-backgrounds";
import { EXPORT_VIDEO_CONFIG } from "./export-video-config";
import {
  DEFAULT_VIDEO_FPS,
  DEFAULT_VIDEO_RESOLUTION,
  VIDEO_FPS_CHOICES,
  VIDEO_RESOLUTIONS,
  VIDEO_RESOLUTION_VALUES,
  type VideoFps,
  type VideoResolution,
} from "./export-video-format";
import {
  MAX_RANGE_NAME,
  MAX_RANGES,
  MIN_RANGE_SECONDS,
} from "./export-video-ranges";
import {
  DEFAULT_LEAD_IN,
  DEFAULT_MERGE_GAP,
  DEFAULT_TAIL_OUT,
  MAX_PADDING,
  type SuggestGroup,
  type SuggestOptions,
} from "./export-video-suggest";
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
    /** Images par seconde : 30 ou 60 (plus fluide, plus lourd). */
    fps: z
      .number()
      .refine(
        (v): v is VideoFps =>
          (VIDEO_FPS_CHOICES as readonly number[]).includes(v),
        {
          message: "30 ou 60",
        },
      )
      .optional(),
    /** Résolution : côté court de l'image en pixels (360, 480, 720, 1080, 1440 ou 2160). */
    resolution: z
      .number()
      .refine(
        (v): v is VideoResolution =>
          (VIDEO_RESOLUTION_VALUES as readonly number[]).includes(v),
        {
          message: VIDEO_RESOLUTION_VALUES.join(", "),
        },
      )
      .optional(),
    /** Parties à exporter : une vidéo par plage (début et fin en secondes de l'audio). */
    ranges: z
      .array(
        z
          .object({
            start: z.number().min(0),
            end: z.number().positive(),
            /** Nom de la plage : suffixe du nom de son fichier (nettoyé, 80 caractères au plus). */
            name: z.string().trim().min(1).max(MAX_RANGE_NAME).optional(),
          })
          .strict()
          .refine((r) => r.end - r.start >= MIN_RANGE_SECONDS, {
            message: `${MIN_RANGE_SECONDS} s au moins`,
          }),
      )
      .min(1, "au moins une plage")
      .max(MAX_RANGES)
      .optional(),
    /** Une vidéo par verset reconnu (= `suggest: "verse"`, exclusif avec `ranges`). */
    per_verse: z.boolean().optional(),
    /**
     * Découpe automatique, protégée : « verse » = une vidéo par verset, « passage » = les versets
     * enchaînés dans une seule vidéo ; chaque plage commence avant et finit après la récitation
     * (`lead_in`, `tail_out`), aimantée au silence (`snap_to_silence`).
     */
    suggest: z.enum(["verse", "passage"]).optional(),
    /** Secondes gardées avant la récitation (0 à 5, défaut 0,6). */
    lead_in: z.number().min(0).max(MAX_PADDING).optional(),
    /** Secondes gardées après la récitation (0 à 5, défaut 0,4). */
    tail_out: z.number().min(0).max(MAX_PADDING).optional(),
    /** Aimante les bords vers le silence le plus proche (défaut oui). */
    snap_to_silence: z.boolean().optional(),
    /** Écart maximal (s) entre deux versets d'un même passage (`suggest: "passage"`). */
    merge_gap: z.number().min(0).max(30).optional(),
    /** Élargit aussi les `ranges` donnés avec ces marges, sans empiéter sur la récitation voisine. */
    pad_ranges: z.boolean().optional(),
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
  .strict()
  .refine((o) => !((o.per_verse || o.suggest) && o.ranges), {
    message:
      "per_verse / suggest et ranges s'excluent : choisis une découpe automatique ou tes propres plages",
    path: ["suggest"],
  });

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
    resolution: options.resolution ?? DEFAULT_VIDEO_PREFS.resolution,
    fps: options.fps ?? DEFAULT_VIDEO_PREFS.fps,
    fill: options.fill ?? DEFAULT_VIDEO_PREFS.fill,
    textPosition: positionOf(options.text_position),
    showWave: options.show_wave ?? DEFAULT_VIDEO_PREFS.showWave,
    accent: options.accent ?? DEFAULT_VIDEO_PREFS.accent,
    bg: options.color ?? DEFAULT_VIDEO_PREFS.bg,
    // Une image envoyée l'emporte : le rendu ne lit alors pas ce choix.
    background: hasUpload ? null : (options.background ?? null),
    paddingBefore: Math.min(
      EXPORT_VIDEO_CONFIG.padding.max,
      options.lead_in ?? DEFAULT_LEAD_IN,
    ),
    paddingAfter: Math.min(
      EXPORT_VIDEO_CONFIG.padding.max,
      options.tail_out ?? DEFAULT_TAIL_OUT,
    ),
    snapToSilence: options.snap_to_silence ?? true,
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
    fps: {
      values: VIDEO_FPS_CHOICES,
      notes: "60 = plus fluide, fichier environ deux fois plus lourd.",
    },
    resolution: {
      values: VIDEO_RESOLUTION_VALUES,
      labels: Object.fromEntries(
        VIDEO_RESOLUTIONS.map((r) => [r.short, r.label]),
      ),
      notes:
        "Côté court de l'image : 720 = 1280×720 en 16:9, 720×1280 en 9:16, 720×720 en 1:1. Au-delà de 1080, le rendu est plus long et le fichier plus lourd.",
    },
    ranges: {
      shape: "[{ start: secondes, end: secondes, name?: texte }, …]",
      max: MAX_RANGES,
      min_seconds: MIN_RANGE_SECONDS,
      name_max: MAX_RANGE_NAME,
      notes:
        "Une plage = une vidéo, dans l'ordre donné ; sans plage, tout l'audio. Une fin au-delà de la durée est ramenée à la durée. `name` (facultatif) remplace l'intervalle dans le nom du fichier (« session — 2.255.mp4 ») ; c'est le nom affiché dans la liste des plages de l'atelier.",
    },
    per_verse:
      "boolean : une vidéo par verset reconnu (= suggest « verse », exclusif avec `ranges`).",
    suggest: {
      values: ["verse", "passage"],
      notes:
        "Découpe automatique PROTÉGÉE : chaque vidéo commence avant la récitation et finit après, aimantée au silence, sans empiéter sur le voisin : aucune voix coupée. « verse » = une vidéo par verset ; « passage » = les versets enchaînés (écart ≤ merge_gap) dans une seule vidéo. Les passages incertains ne sont jamais proposés. Pour voir les plages avant d'exporter : GET /api/v1/recordings/{id}/export/suggestions (outil MCP suggest_video_ranges).",
    },
    lead_in: {
      seconds: { min: 0, max: MAX_PADDING, default: DEFAULT_LEAD_IN },
      notes: "Marge gardée AVANT la récitation (suggest et pad_ranges).",
    },
    tail_out: {
      seconds: { min: 0, max: MAX_PADDING, default: DEFAULT_TAIL_OUT },
      notes: "Marge gardée APRÈS la récitation (suggest et pad_ranges).",
    },
    snap_to_silence:
      "boolean (défaut true) : aimante chaque bord au silence le plus proche.",
    merge_gap: {
      seconds: { min: 0, max: 30, default: DEFAULT_MERGE_GAP },
      notes:
        "Écart maximal entre deux versets d'un même passage (suggest « passage »).",
    },
    pad_ranges:
      "boolean : élargit aussi tes `ranges` avec lead_in / tail_out sans empiéter sur la récitation voisine (sinon tes plages sont prises telles quelles).",
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
      fps: DEFAULT_VIDEO_FPS,
      resolution: DEFAULT_VIDEO_RESOLUTION,
      fill: DEFAULT_VIDEO_PREFS.fill,
      text_position: DEFAULT_VIDEO_PREFS.textPosition,
      show_wave: DEFAULT_VIDEO_PREFS.showWave,
      accent: DEFAULT_VIDEO_PREFS.accent,
    },
  };
}

/** Marges et aimantation d'une demande d'export (valeurs par défaut comprises). */
export function suggestOptionsOf(
  options: Pick<
    VideoJobOptions,
    "lead_in" | "tail_out" | "snap_to_silence" | "merge_gap" | "suggest"
  >,
): Required<SuggestOptions> {
  return {
    leadIn: options.lead_in ?? DEFAULT_LEAD_IN,
    tailOut: options.tail_out ?? DEFAULT_TAIL_OUT,
    snapToSilence: options.snap_to_silence ?? true,
    group: (options.suggest ?? "verse") as SuggestGroup,
    mergeGap: options.merge_gap ?? DEFAULT_MERGE_GAP,
    includeInferred: true,
  };
}

const flagOf = (value: string | null): boolean | undefined =>
  value === null ? undefined : value === "1" || value === "true";

/** Lit les paramètres de `GET …/export/suggestions` (mêmes noms que les options de l'export). */
export function suggestOptionsFromQuery(
  query: URLSearchParams,
):
  | { ok: true; options: Required<SuggestOptions> }
  | { ok: false; error: string } {
  const read: Record<string, number | undefined> = {};
  for (const name of ["lead_in", "tail_out", "merge_gap"]) {
    const raw = query.get(name);
    if (raw === null || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value))
      return {
        ok: false,
        error: `${name} : un nombre de secondes est attendu.`,
      };
    read[name] = value;
  }
  const group = query.get("group");
  if (group !== null && group !== "verse" && group !== "passage")
    return { ok: false, error: "group : « verse » ou « passage »." };
  const candidate: Record<string, unknown> = { ...read };
  const snap = flagOf(query.get("snap"));
  if (snap !== undefined) candidate.snap_to_silence = snap;
  if (group !== null) candidate.suggest = group;
  const parsed = videoJobOptionsSchema.safeParse(candidate);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues
        .map((i) => `${i.path.join(".")} (${i.message})`)
        .join(" ; "),
    };
  return { ok: true, options: suggestOptionsOf(parsed.data) };
}
