/**
 * Modèle de la mise en page de la vidéo d'export : QUATRE blocs (sourate et verset, arabe, traduction,
 * onde), chacun dans SA boîte, avec son style de texte. Types, schémas, valeurs par défaut : l'unique
 * source ; les éditeurs (plateau, table de montage, pas à pas), l'aperçu et le rendu final lisent
 * tous ce fichier.
 *
 *  - `ExportLayout` : les quatre boîtes, en FRACTIONS du cadre (0–1). Une mise en page par orientation
 *    (16:9, 9:16, 1:1) : chaque forme de cadre garde la sienne.
 *  - `TextStyle` : taille relative (1 = la taille par défaut, dans la vidéo de référence de 1080 px de
 *    côté court), « remplir la zone », fond du texte (`PanelStyle`).
 *  - `Background` : ce qui est derrière (photo, dégradé, couleur, vidéo, vidéo d'origine, automatique).
 *
 * INVARIANT I1 : ce modèle ne porte AUCUN texte coranique ; il ne décrit que des boîtes et des styles.
 * Les valeurs par défaut reproduisent l'ancien comportement (bloc centré dans la zone au-dessus de
 * l'onde, mêmes marges) : voir `docs/adr/0018-mise-en-page-par-blocs.md`.
 */
import { z } from "zod";
import {
  BACKGROUND_PRESETS,
  CLIP_BACKGROUND_ID,
  GRADIENT_BACKGROUNDS,
} from "./export-video-backgrounds";

// ── boîtes ──────────────────────────────────────────────────────────────────

/** Les quatre blocs de la vidéo. */
export const BLOCK_IDS = ["ref", "arabic", "translation", "wave"] as const;
export type BlockId = (typeof BLOCK_IDS)[number];
/** Les blocs de texte (ceux qui ont un style). */
export const TEXT_BLOCK_IDS = ["ref", "arabic", "translation"] as const;
export type TextBlockId = (typeof TEXT_BLOCK_IDS)[number];

/** Rectangle en fractions du cadre : 0 = bord gauche/haut, 1 = bord droit/bas. */
export type Box = { x: number; y: number; w: number; h: number };

/** Plus petite boîte autorisée (fractions du cadre) : en deçà, plus rien n'est lisible ni attrapable. */
export const MIN_BOX = { w: 0.1, h: 0.04 } as const;
/** Tolérance des comparaisons de fractions (arrondis de saisie). */
const EPSILON = 1e-6;

export const boxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(MIN_BOX.w).max(1),
    h: z.number().min(MIN_BOX.h).max(1),
  })
  .strict()
  .refine((b) => b.x + b.w <= 1 + EPSILON && b.y + b.h <= 1 + EPSILON, {
    message: "la boîte sort du cadre",
  });

export const exportLayoutSchema = z
  .object({
    ref: boxSchema,
    arabic: boxSchema,
    translation: boxSchema,
    wave: boxSchema,
  })
  .strict();
export type ExportLayout = z.infer<typeof exportLayoutSchema>;

/** Une mise en page par forme de cadre. */
export const LAYOUT_KEYS = ["16:9", "9:16", "1:1"] as const;
export type LayoutKey = (typeof LAYOUT_KEYS)[number];

export const layoutsSchema = z
  .object({
    "16:9": exportLayoutSchema,
    "9:16": exportLayoutSchema,
    "1:1": exportLayoutSchema,
  })
  .strict();
export type ExportLayouts = z.infer<typeof layoutsSchema>;

/**
 * Mises en page par défaut. Elles reproduisent l'ancien rendu : texte sur 84 % (86 % en portrait) de
 * la largeur, pile référence → arabe → traduction centrée dans la zone libre (5 % de marge en haut,
 * au-dessus de l'onde), onde sur toute la largeur en bas (22 % de la hauteur, 16 % en portrait).
 * Les boîtes se touchent et l'arabe, au milieu, est le bloc qui a le plus de place : un verset de
 * quatre lignes en paysage tient presque à 100 %, comme avant (une pile qui s'adapte à chaque verset
 * ne peut pas être reproduite par des boîtes fixes, mais la CAPACITÉ est la même). Les ordonnées sont
 * calculées pour que la pile soit exactement centrée dans la zone libre (voir `textStackPosition`,
 * testé à 0,5).
 */
export const DEFAULT_LAYOUTS: ExportLayouts = {
  "16:9": {
    ref: { x: 0.25, y: 0.0575, w: 0.5, h: 0.06 },
    arabic: { x: 0.08, y: 0.1175, w: 0.84, h: 0.47 },
    translation: { x: 0.08, y: 0.5875, w: 0.84, h: 0.16 },
    wave: { x: 0, y: 0.78, w: 1, h: 0.22 },
  },
  "9:16": {
    ref: { x: 0.1, y: 0.08, w: 0.8, h: 0.045 },
    arabic: { x: 0.07, y: 0.125, w: 0.86, h: 0.46 },
    translation: { x: 0.07, y: 0.585, w: 0.86, h: 0.2 },
    wave: { x: 0, y: 0.84, w: 1, h: 0.16 },
  },
  "1:1": {
    ref: { x: 0.25, y: 0.0775, w: 0.5, h: 0.06 },
    arabic: { x: 0.08, y: 0.1375, w: 0.84, h: 0.42 },
    translation: { x: 0.08, y: 0.5575, w: 0.84, h: 0.17 },
    wave: { x: 0, y: 0.78, w: 1, h: 0.22 },
  },
};

/**
 * Forme du cadre → mise en page à lire. « Vidéo d'origine » (dimensions libres) suit la forme la plus
 * proche : plus large que haute = paysage, plus haute que large = portrait, presque carrée = carré.
 */
export function layoutKeyFor(width: number, height: number): LayoutKey {
  if (!(width > 0) || !(height > 0)) return "16:9";
  const ratio = width / height;
  if (ratio >= 1.2) return "16:9";
  if (ratio <= 0.84) return "9:16";
  return "1:1";
}

// ── pile de textes : l'ancien réglage « place du texte » ───────────────────

/** Marge haute de la zone de texte (fraction de la hauteur) : comme avant. */
const TEXT_ZONE_TOP = 0.05;

/**
 * Zone libre au-dessus de l'onde, en fractions de la hauteur : de la marge haute à la marge basse
 * (un peu au-dessus de l'onde par défaut). C'est dans cette zone que l'ancien réglage « place du
 * texte » (0 = haut, 1 = bas) déplaçait le bloc ; les boîtes par défaut y sont centrées.
 */
export function textFreeZone(
  key: LayoutKey,
  showWave = true,
): { top: number; bottom: number } {
  if (!showWave) return { top: TEXT_ZONE_TOP, bottom: 1 - 0.05 };
  const wave = key === "9:16" ? 0.16 : 0.22;
  return { top: TEXT_ZONE_TOP, bottom: 1 - wave - 0.025 };
}

function stackBounds(layout: ExportLayout): { top: number; bottom: number } {
  return {
    top: Math.min(...TEXT_BLOCK_IDS.map((id) => layout[id].y)),
    bottom: Math.max(
      ...TEXT_BLOCK_IDS.map((id) => layout[id].y + layout[id].h),
    ),
  };
}

/** Où se trouve la pile de textes dans la zone libre : 0 = en haut, 0,5 = au centre, 1 = en bas. */
export function textStackPosition(
  layout: ExportLayout,
  key: LayoutKey,
  showWave = true,
): number {
  const zone = textFreeZone(key, showWave);
  const { top, bottom } = stackBounds(layout);
  const room = zone.bottom - zone.top - (bottom - top);
  if (room <= EPSILON) return 0.5;
  return Math.min(1, Math.max(0, (top - zone.top) / room));
}

/**
 * Déplace d'un bloc la pile référence + arabe + traduction (les trois boîtes ensemble, hauteurs et
 * largeurs inchangées) à la position demandée dans la zone libre. L'onde ne bouge pas. Renvoie une
 * copie.
 */
export function moveTextStack(
  layout: ExportLayout,
  position: number,
  key: LayoutKey,
  showWave = true,
): ExportLayout {
  const p = Number.isFinite(position)
    ? Math.min(1, Math.max(0, position))
    : 0.5;
  const zone = textFreeZone(key, showWave);
  const { top, bottom } = stackBounds(layout);
  const room = Math.max(0, zone.bottom - zone.top - (bottom - top));
  const dy = zone.top + room * p - top;
  const next = structuredClone(layout);
  // Arrondi au millionième : écarte les restes de calcul flottant, recentrer un défaut ne le change pas.
  for (const id of TEXT_BLOCK_IDS)
    next[id].y = Math.round((layout[id].y + dy) * 1e6) / 1e6;
  return next;
}

/** La même place du texte pour les trois formats (l'ancien réglage unique « place du texte »). */
export function moveAllTextStacks(
  layouts: ExportLayouts,
  position: number,
  showWave = true,
): ExportLayouts {
  const next = {} as ExportLayouts;
  for (const key of LAYOUT_KEYS)
    next[key] = moveTextStack(layouts[key], position, key, showWave);
  return next;
}

/** Place du texte dans le format choisi (0 = haut, 1 = bas) ; « comme la vidéo » lit le paysage. */
export function currentTextPosition(
  layouts: ExportLayouts,
  orientation: LayoutKey | "source",
  showWave = true,
): number {
  const key: LayoutKey = orientation === "source" ? "16:9" : orientation;
  return textStackPosition(layouts[key], key, showWave);
}

// ── styles de texte ─────────────────────────────────────────────────────────

/** Fond du texte : aucun (ombre douce ou contour), transparent, flou, plein. */
export const PANEL_KINDS = ["none", "transparent", "blur", "solid"] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];
/** Lisibilité sans fond : ombre douce ou contour. */
export const LEGIBILITIES = ["shadow", "outline"] as const;
export type Legibility = (typeof LEGIBILITIES)[number];
/** Étendue du fond : autour du texte seulement, ou toute la boîte. */
export const PANEL_EXTENTS = ["text", "box"] as const;
export type PanelExtent = (typeof PANEL_EXTENTS)[number];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const PANEL_LIMITS = {
  opacity: { min: 0, max: 1 },
  radius: { min: 0, max: 80 },
};

export const panelSchema = z
  .object({
    kind: z.enum(PANEL_KINDS),
    /** `#rrggbb`. */
    color: z.string().regex(HEX_COLOR),
    /** Opacité du fond (transparent et flou) ; le fond plein est toujours opaque. De 0 à 1. */
    opacity: z
      .number()
      .min(PANEL_LIMITS.opacity.min)
      .max(PANEL_LIMITS.opacity.max),
    /** Arrondi des angles, en px dans la vidéo de référence de 1080 px de côté court. */
    radius: z
      .number()
      .min(PANEL_LIMITS.radius.min)
      .max(PANEL_LIMITS.radius.max),
    /** Sans fond : ombre douce ou contour (couleur et opacité du fond). */
    legibility: z.enum(LEGIBILITIES),
    /** `text` : le fond épouse le texte (jamais plus grand que la boîte) ; `box` : toute la boîte. */
    extent: z.enum(PANEL_EXTENTS),
  })
  .strict();
export type PanelStyle = z.infer<typeof panelSchema>;

/** Où le texte se place dans sa boîte quand il ne la remplit pas : tout en haut, au milieu, tout en bas. */
export const VALIGNS = ["start", "center", "end"] as const;
export type VAlign = (typeof VALIGNS)[number];

/** Taille relative du texte : 1 = taille par défaut. Bornes et pas des boutons − / +. */
export const SIZE_LIMITS = { min: 0.4, max: 5 } as const;
/** Un appui sur « + » ou « − » change la taille de ≈ 6 %. */
export const SIZE_STEP_RATIO = 1.06;

export const textStyleSchema = z
  .object({
    size: z.number().min(SIZE_LIMITS.min).max(SIZE_LIMITS.max),
    /** « Remplir la zone » : le texte grandit jusqu'à occuper sa boîte. */
    fill: z.boolean(),
    /** Place du texte dans la hauteur de sa boîte (le fond le suit). */
    valign: z.enum(VALIGNS),
    panel: panelSchema,
  })
  .strict();
export type TextStyle = z.infer<typeof textStyleSchema>;

export const stylesSchema = z
  .object({
    ref: textStyleSchema,
    arabic: textStyleSchema,
    translation: textStyleSchema,
  })
  .strict();
export type TextStyles = z.infer<typeof stylesSchema>;

/**
 * Taille en px, à `size` = 1, dans la vidéo de référence de 1080 px de côté court. Ce sont les anciens
 * défauts (arabe 72, traduction 30) ; la référence reprenait 36 % de la taille de l'arabe.
 */
export const TEXT_BASE_SIZE: Record<TextBlockId, number> = {
  ref: 26,
  arabic: 72,
  translation: 30,
};

/** Côté court de référence : les tailles s'y rapportent. */
export const REFERENCE_SHORT_SIDE = 1080;

/** Échelle px d'une taille de référence pour ce cadre. */
export const sizeScale = (width: number, height: number): number =>
  Math.min(width, height) / REFERENCE_SHORT_SIDE;

/** Taille d'un texte en px pour ce cadre, avant ajustement à sa boîte. */
export const textPixelSize = (
  block: TextBlockId,
  size: number,
  width: number,
  height: number,
): number => TEXT_BASE_SIZE[block] * size * sizeScale(width, height);

const SOFT_PANEL = {
  kind: "transparent",
  color: "#06080c",
  /** ≈ l'opacité cumulée des 14 couches de l'ancien voile (1 − 0,925¹⁴). */
  opacity: 0.66,
  radius: 34,
  legibility: "shadow",
  extent: "text",
} as const satisfies PanelStyle;

export const DEFAULT_STYLES: TextStyles = {
  // Les boîtes se touchent : la référence colle au bas de la sienne et la traduction au haut de la
  // sienne, l'arabe est centré entre les deux — le bloc reste cohérent quel que soit le verset.
  ref: { size: 1, fill: false, valign: "end", panel: { ...SOFT_PANEL } },
  arabic: { size: 1, fill: false, valign: "center", panel: { ...SOFT_PANEL } },
  translation: {
    size: 1,
    fill: false,
    valign: "start",
    panel: { ...SOFT_PANEL },
  },
};

// ── fond ────────────────────────────────────────────────────────────────────

/** Que faire quand la vidéo de fond n'a pas la durée de la récitation (plus courte). */
export const BG_VIDEO_MODES = ["loop", "pingpong", "freeze", "slow"] as const;
export type BackgroundVideoMode = (typeof BG_VIDEO_MODES)[number];
export const DEFAULT_BG_VIDEO_MODE: BackgroundVideoMode = "loop";
/** Départ maximal du fond vidéo (s) : borne de saisie ; la durée réelle de la vidéo borne ensuite. */
export const MAX_BG_VIDEO_OFFSET = 36_000;

export const backgroundVideoSchema = z
  .object({
    /** Nom du fichier choisi (affichage et clé de la vidéo ; le fichier lui-même reste sur l'appareil). */
    file: z.string().min(1).max(160).nullable(),
    /** Départ dans la vidéo (s) quand elle est plus longue que la récitation : un SEUL pour toutes les plages. */
    offset: z.number().min(0).max(MAX_BG_VIDEO_OFFSET),
    mode: z.enum(BG_VIDEO_MODES),
  })
  .strict();
export type BackgroundVideo = z.infer<typeof backgroundVideoSchema>;

export const DEFAULT_BACKGROUND_VIDEO: BackgroundVideo = {
  file: null,
  offset: 0,
  mode: DEFAULT_BG_VIDEO_MODE,
};

export type Background =
  /** Rien de choisi : la vidéo d'origine (session vidéo) ou le dégradé par défaut. */
  | { type: "auto"; id: null }
  | { type: "photo"; id: string }
  | { type: "gradient"; id: string }
  /** Couleur unie : `id` est le code `#rrggbb`. */
  | { type: "color"; id: string }
  /** La vidéo d'origine de la session. */
  | { type: "source"; id: "source" }
  /** Une vidéo de fond choisie par l'utilisateur ; muette. */
  | { type: "video"; id: string | null; video: BackgroundVideo };

/** Décrit le fond choisi dans les préférences (contrat lu par les éditeurs). */
export function backgroundOf(prefs: {
  background: string | null;
  bg: string;
  backgroundVideo: BackgroundVideo;
}): Background {
  const id = prefs.background;
  if (id === "color") return { type: "color", id: prefs.bg };
  if (id === "source") return { type: "source", id: "source" };
  if (id === CLIP_BACKGROUND_ID)
    return {
      type: "video",
      id: prefs.backgroundVideo.file,
      video: prefs.backgroundVideo,
    };
  const preset = BACKGROUND_PRESETS.find((p) => p.id === id);
  if (preset)
    return preset.kind === "photo"
      ? { type: "photo", id: preset.id }
      : { type: "gradient", id: preset.id };
  return { type: "auto", id: null };
}

/**
 * Le fond de texte « automatique » d'un fond de vidéo : un voile transparent sur une photo ou une
 * vidéo (le texte reste lisible), aucun sur un dégradé ou une couleur unie (déjà unis). C'était le
 * comportement implicite d'avant le modèle à blocs ; l'éditeur l'applique maintenant à la demande.
 */
export function autoPanelKind(background: string | null): PanelKind {
  const plain =
    background === "color" ||
    GRADIENT_BACKGROUNDS.some((gradient) => gradient.id === background);
  return plain ? "none" : "transparent";
}

/**
 * Au changement de fond, adapte les fonds de texte restés « automatiques » (celui du fond quitté) à la
 * nature du nouveau fond ; un fond choisi par l'utilisateur n'est jamais touché. Renvoie le MÊME objet
 * quand rien ne change.
 */
export function applyBackgroundPanels(
  styles: TextStyles,
  from: string | null,
  to: string | null,
): TextStyles {
  const was = autoPanelKind(from);
  const now = autoPanelKind(to);
  if (was === now) return styles;
  let changed = false;
  const next = { ...styles };
  for (const block of TEXT_BLOCK_IDS)
    if (styles[block].panel.kind === was) {
      next[block] = {
        ...styles[block],
        panel: { ...styles[block].panel, kind: now },
      };
      changed = true;
    }
  return changed ? next : styles;
}
