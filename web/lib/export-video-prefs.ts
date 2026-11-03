import { z } from "zod";
import type { VideoOrientation } from "./export-video-args";
import { GRADIENT_BACKGROUNDS } from "./export-video-backgrounds";
import { EXPORT_VIDEO_CONFIG } from "./export-video-config";
import { DEFAULT_LEAD_IN, DEFAULT_TAIL_OUT } from "./export-video-suggest";
import {
  DEFAULT_VIDEO_FPS,
  capResolution,
  DEFAULT_VIDEO_RESOLUTION,
  LEGACY_VIDEO_RESOLUTIONS,
  VIDEO_FPS_CHOICES,
  type VideoFps,
  type VideoResolution,
} from "./export-video-format";
import {
  BLOCK_IDS,
  DEFAULT_BACKGROUND_VIDEO,
  DEFAULT_LAYOUTS,
  DEFAULT_STYLES,
  LAYOUT_KEYS,
  SIZE_LIMITS,
  TEXT_BASE_SIZE,
  TEXT_BLOCK_IDS,
  backgroundVideoSchema,
  boxSchema,
  layoutKeyFor,
  layoutsSchema,
  moveTextStack,
  panelSchema,
  stylesSchema,
  textStyleSchema,
  type ExportLayout,
  type ExportLayouts,
  type TextStyles,
} from "./export-video-model";

/**
 * Réglages de l'export vidéo. Ils sont enregistrés sur le compte (`videoPrefs`, `preferences-schema.ts`) :
 * ce module ne porte que le schéma, les défauts, les bornes et la MIGRATION de l'ancien format.
 *
 * Modèle : trois mises en page (une par forme de cadre) de quatre boîtes, trois styles de texte (sourate
 * et verset, arabe, traduction), un fond (dont la vidéo de fond) ; voir `export-video-model.ts`.
 * Avant ce modèle, les réglages étaient PLATS (`arabicSize`, `translationSize`, `textPosition`, `fill`) :
 * tout compte qui les a gardés les retrouve, convertis à l'identique, au premier chargement.
 */

export const VIDEO_ORIENTATIONS_WITH_SOURCE = [
  "16:9",
  "9:16",
  "1:1",
  "source",
] as const;
export type VideoPrefsOrientation =
  (typeof VIDEO_ORIENTATIONS_WITH_SOURCE)[number];

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

// ── champs, un par un : réutilisés par le schéma, la migration et la récupération ──
const orientationField = z.enum(VIDEO_ORIENTATIONS_WITH_SOURCE);
const resolutionField = z
  .number()
  .refine((v) => LEGACY_VIDEO_RESOLUTIONS.includes(v))
  // Un réglage enregistré en 1440p ou 4K avant le plafond revient à 1080p (il n'est pas refusé).
  .transform((v): VideoResolution => capResolution(v));
const fpsField = z
  .number()
  .refine((v): v is VideoFps =>
    (VIDEO_FPS_CHOICES as readonly number[]).includes(v),
  );
const bgField = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const backgroundField = z.string().min(1).max(40).nullable();
const paddingField = z
  .number()
  .min(EXPORT_VIDEO_CONFIG.padding.min)
  .max(EXPORT_VIDEO_CONFIG.padding.max);
const boolField = z.boolean();

const videoPrefsObject = z
  .object({
    orientation: orientationField,
    showTranslation: boolField,
    /** Écriture arabe affichée (sinon la vidéo ne montre que la référence et la traduction). */
    showArabic: boolField.default(true),
    /** Sourate et verset affichés. */
    showRef: boolField.default(true),
    /** Onde audio affichée (sinon le texte peut occuper toute la hauteur). */
    showWave: boolField.default(true),
    /** Résolution : taille du côté court de l'image (720 = 1280×720 en 16:9). */
    resolution: resolutionField.default(DEFAULT_VIDEO_RESOLUTION),
    /** Images par seconde : 30, ou 60 pour plus de fluidité (fichier plus lourd). */
    fps: fpsField.default(DEFAULT_VIDEO_FPS),
    /** Couleur d'accent (mot récité, référence) ; null = automatique (couleur principale du fond). */
    accent: accentSchema.nullable().default(null),
    bg: bgField,
    /** Fond choisi : id d'un fond proposé, « source », « color », « video », ou null = automatique. */
    background: backgroundField.default(null),
    /** Vidéo de fond : fichier, départ, comportement quand elle est plus courte. Muette. */
    backgroundVideo: backgroundVideoSchema.default(() =>
      structuredClone(DEFAULT_BACKGROUND_VIDEO),
    ),
    /** Les quatre boîtes, par forme de cadre. */
    layouts: layoutsSchema.default(() => structuredClone(DEFAULT_LAYOUTS)),
    /** Taille, remplissage et fond de chaque texte. */
    styles: stylesSchema.default(() => structuredClone(DEFAULT_STYLES)),
    /** Souffle gardé avant la voix (s) dans les plages proposées ; mêmes marges que l'API (`lead_in`). */
    paddingBefore: paddingField.default(DEFAULT_LEAD_IN),
    /** Souffle gardé après la voix (s) ; `tail_out` côté API. */
    paddingAfter: paddingField.default(DEFAULT_TAIL_OUT),
    /** Aimanter les bords au silence le plus proche ; `snap_to_silence` côté API. */
    snapToSilence: boolField.default(true),
  })
  .strict();

export type VideoPrefs = z.infer<typeof videoPrefsObject>;

export const DEFAULT_VIDEO_PREFS: VideoPrefs = {
  orientation: "16:9",
  showTranslation: true,
  showArabic: true,
  showRef: true,
  showWave: true,
  resolution: DEFAULT_VIDEO_RESOLUTION,
  fps: DEFAULT_VIDEO_FPS,
  accent: null,
  bg: "#101418",
  background: null,
  backgroundVideo: DEFAULT_BACKGROUND_VIDEO,
  layouts: DEFAULT_LAYOUTS,
  styles: DEFAULT_STYLES,
  paddingBefore: DEFAULT_LEAD_IN,
  paddingAfter: DEFAULT_TAIL_OUT,
  snapToSilence: true,
};

// ── lecture tolérante ───────────────────────────────────────────────────────

type Plain = Record<string, unknown>;
const isPlain = (value: unknown): value is Plain =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Valeur validée par `schema`, sinon `fallback` : jamais d'exception. */
function lenient<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * Réglages d'avant le modèle à blocs : ni mise en page (`layouts`) ni styles (`styles`). Un objet
 * incomplet, ou vide, en fait partie : ses valeurs manquantes prennent les défauts.
 */
export function isLegacyVideoPrefs(raw: unknown): boolean {
  return isPlain(raw) && !("layouts" in raw) && !("styles" in raw);
}

/** Taille en pixels d'avant (dans sa plage d'alors) → échelle relative à la taille par défaut. */
function legacyScale(
  value: unknown,
  range: { min: number; max: number },
  base: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  if (value < range.min || value > range.max) return 1;
  return Math.min(
    SIZE_LIMITS.max,
    Math.max(SIZE_LIMITS.min, round3(value / base)),
  );
}

/**
 * Convertit l'ancien format plat vers le modèle à blocs, à l'identique :
 *  - `arabicSize`, `translationSize` (px) → `size` relatif (72 → 1, 30 → 1) ; la référence suivait l'arabe ;
 *  - `textPosition` (0–100) → les trois boîtes de texte déplacées ensemble dans la zone libre ;
 *  - `fill` → « remplir la zone » pour l'arabe et la traduction ;
 *  - le voile derrière le texte, qui n'existait que sur photo ou vidéo, devient un fond « transparent » ;
 *    avec un dégradé ou une couleur unie (jamais de voile), le fond est « aucun » ;
 *  - toute valeur absente, inconnue ou corrompue prend sa valeur par défaut (jamais d'échec).
 */
function migrateLegacy(raw: Plain): Plain {
  const D = DEFAULT_VIDEO_PREFS;
  const arabic = legacyScale(
    raw.arabicSize,
    { min: 40, max: 240 },
    TEXT_BASE_SIZE.arabic,
  );
  const translation = legacyScale(
    raw.translationSize,
    { min: 16, max: 140 },
    TEXT_BASE_SIZE.translation,
  );
  const fill = lenient(boolField, raw.fill, false);
  const background = lenient(backgroundField, raw.background, null);
  const noVeil =
    background === "color" ||
    GRADIENT_BACKGROUNDS.some((gradient) => gradient.id === background);

  const style = (
    block: keyof TextStyles,
    size: number,
    blockFill: boolean,
  ): TextStyles[keyof TextStyles] => {
    const base = structuredClone(DEFAULT_STYLES[block]);
    base.size = size;
    base.fill = blockFill;
    if (noVeil) base.panel.kind = "none";
    return base;
  };

  const position =
    typeof raw.textPosition === "number" &&
    Number.isFinite(raw.textPosition) &&
    raw.textPosition >= 0 &&
    raw.textPosition <= 100
      ? raw.textPosition / 100
      : 0.5;
  const showWave = lenient(boolField, raw.showWave, D.showWave);
  const layouts = {} as ExportLayouts;
  // Sans onde, l'ancienne zone de texte descendait jusqu'à la marge basse : la pile s'y recentre.
  for (const key of LAYOUT_KEYS)
    layouts[key] =
      position === 0.5 && showWave
        ? structuredClone(DEFAULT_LAYOUTS[key])
        : moveTextStack(DEFAULT_LAYOUTS[key], position, key, showWave);

  return {
    orientation: lenient(orientationField, raw.orientation, D.orientation),
    showTranslation: lenient(boolField, raw.showTranslation, D.showTranslation),
    showArabic: lenient(boolField, raw.showArabic, D.showArabic),
    showRef: true,
    showWave,
    resolution: lenient(resolutionField, raw.resolution, D.resolution),
    fps: lenient(fpsField, raw.fps, D.fps),
    accent: lenient(accentSchema.nullable(), raw.accent, null),
    bg: lenient(bgField, raw.bg, D.bg),
    background,
    backgroundVideo: structuredClone(DEFAULT_BACKGROUND_VIDEO),
    layouts,
    styles: {
      ref: style("ref", arabic, false),
      arabic: style("arabic", arabic, fill),
      translation: style("translation", translation, fill),
    },
    paddingBefore: lenient(paddingField, raw.paddingBefore, D.paddingBefore),
    paddingAfter: lenient(paddingField, raw.paddingAfter, D.paddingAfter),
    snapToSilence: lenient(boolField, raw.snapToSilence, D.snapToSilence),
  };
}

/**
 * Avant validation : l'ancien format est converti ; un objet au nouveau format passe tel quel (et sera
 * validé strictement, sans rien corriger en silence).
 */
export function migrateVideoPrefs(raw: unknown): unknown {
  return isLegacyVideoPrefs(raw) ? migrateLegacy(raw as Plain) : raw;
}

/** Les réglages de la vidéo : le nouveau format strict, l'ancien format converti. */
export const videoPrefsSchema = z.preprocess(
  migrateVideoPrefs,
  videoPrefsObject,
);

function sanitizeLayouts(raw: unknown): ExportLayouts {
  const source = isPlain(raw) ? raw : {};
  const out = {} as ExportLayouts;
  for (const key of LAYOUT_KEYS) {
    const layout = isPlain(source[key]) ? (source[key] as Plain) : {};
    const next = {} as ExportLayout;
    for (const id of BLOCK_IDS)
      next[id] = lenient(boxSchema, layout[id], DEFAULT_LAYOUTS[key][id]);
    out[key] = next;
  }
  return out;
}

function sanitizeStyles(raw: unknown): TextStyles {
  const source = isPlain(raw) ? raw : {};
  const out = {} as TextStyles;
  for (const block of TEXT_BLOCK_IDS) {
    const fallback = DEFAULT_STYLES[block];
    const style = isPlain(source[block]) ? (source[block] as Plain) : {};
    const panel = isPlain(style.panel) ? style.panel : {};
    const shape = panelSchema.shape;
    out[block] = {
      size: lenient(textStyleSchema.shape.size, style.size, fallback.size),
      fill: lenient(textStyleSchema.shape.fill, style.fill, fallback.fill),
      valign: lenient(textStyleSchema.shape.valign, style.valign, fallback.valign),
      panel: {
        kind: lenient(shape.kind, panel.kind, fallback.panel.kind),
        color: lenient(shape.color, panel.color, fallback.panel.color),
        opacity: lenient(shape.opacity, panel.opacity, fallback.panel.opacity),
        radius: lenient(shape.radius, panel.radius, fallback.panel.radius),
        legibility: lenient(
          shape.legibility,
          panel.legibility,
          fallback.panel.legibility,
        ),
        extent: lenient(shape.extent, panel.extent, fallback.panel.extent),
      },
    };
  }
  return out;
}

/**
 * Récupère des réglages abîmés CHAMP PAR CHAMP : une valeur invalide reprend son défaut, tout ce qui
 * est valide est gardé, les clés inconnues sont ignorées. L'ancien format est converti. Renvoie
 * toujours des réglages valides, quoi qu'on lui donne. Le serveur s'en sert à la lecture
 * (`preferences.ts`) pour ne pas perdre tous les réglages d'un compte à cause d'une seule valeur.
 */
export function sanitizeVideoPrefs(raw: unknown): VideoPrefs {
  const fresh = (): VideoPrefs => structuredClone(DEFAULT_VIDEO_PREFS);
  try {
    if (isLegacyVideoPrefs(raw) || !isPlain(raw)) {
      const parsed = videoPrefsSchema.safeParse(isPlain(raw) ? raw : {});
      return parsed.success ? parsed.data : fresh();
    }
    const D = DEFAULT_VIDEO_PREFS;
    const candidate = {
      orientation: lenient(orientationField, raw.orientation, D.orientation),
      showTranslation: lenient(
        boolField,
        raw.showTranslation,
        D.showTranslation,
      ),
      showArabic: lenient(boolField, raw.showArabic, D.showArabic),
      showRef: lenient(boolField, raw.showRef, D.showRef),
      showWave: lenient(boolField, raw.showWave, D.showWave),
      resolution: lenient(resolutionField, raw.resolution, D.resolution),
      fps: lenient(fpsField, raw.fps, D.fps),
      accent: lenient(accentSchema.nullable(), raw.accent, null),
      bg: lenient(bgField, raw.bg, D.bg),
      background: lenient(backgroundField, raw.background, null),
      backgroundVideo: sanitizeBackgroundVideo(raw.backgroundVideo),
      layouts: sanitizeLayouts(raw.layouts),
      styles: sanitizeStyles(raw.styles),
      paddingBefore: lenient(paddingField, raw.paddingBefore, D.paddingBefore),
      paddingAfter: lenient(paddingField, raw.paddingAfter, D.paddingAfter),
      snapToSilence: lenient(boolField, raw.snapToSilence, D.snapToSilence),
    };
    const parsed = videoPrefsObject.safeParse(candidate);
    return parsed.success ? parsed.data : fresh();
  } catch {
    return fresh();
  }
}

function sanitizeBackgroundVideo(raw: unknown) {
  const source = isPlain(raw) ? raw : {};
  const shape = backgroundVideoSchema.shape;
  return {
    file: lenient(shape.file, source.file, DEFAULT_BACKGROUND_VIDEO.file),
    offset: lenient(
      shape.offset,
      source.offset,
      DEFAULT_BACKGROUND_VIDEO.offset,
    ),
    mode: lenient(shape.mode, source.mode, DEFAULT_BACKGROUND_VIDEO.mode),
  };
}

// ── lecture des réglages pour dessiner ──────────────────────────────────────

/** La mise en page à lire pour un cadre `width × height` (la forme du cadre choisit parmi les trois). */
export function layoutFor(
  prefs: Pick<VideoPrefs, "layouts">,
  width: number,
  height: number,
): ExportLayout {
  return prefs.layouts[layoutKeyFor(width, height)];
}

/** Orientation effective : « source » se résout au moment de l'export (vidéo source). */
export function resolveOrientation(
  prefs: Pick<VideoPrefs, "orientation">,
  sourceSize: { width: number; height: number } | null,
): VideoOrientation {
  if (prefs.orientation !== "source") return prefs.orientation;
  if (!sourceSize) return "16:9";
  return sourceSize.width >= sourceSize.height ? "16:9" : "9:16";
}
