/**
 * Les changements que l'éditeur de la vidéo d'export fait aux réglages : fonctions PURES qui prennent
 * des réglages et rendent les nouveaux (jamais de mutation), partagées par le plateau, la table de
 * montage, le pas à pas et la vue bureau. Chaque contrôle (geste sur l'aperçu, boutons − / +, croix
 * directionnelle, champs de l'inspecteur, interrupteurs) passe par ici : un réglage se comporte pareil
 * quel que soit l'écran qui le change, et se teste sans interface.
 *
 * Aucun texte coranique ici (I1) : des boîtes, des tailles, des couleurs.
 */
import { clampBox, defaultBox, type Visibility } from "./export-video-edit";
import {
  MIN_BOX,
  PANEL_LIMITS,
  SIZE_LIMITS,
  type BlockId,
  type Box,
  type ExportLayouts,
  type LayoutKey,
  type PanelStyle,
  type TextBlockId,
  type TextStyles,
} from "./export-video-model";
import type { VideoPrefs } from "./export-video-prefs";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const HEX = /^#[0-9a-fA-F]{6}$/;

// ── mise en page ────────────────────────────────────────────────────────────

/** La boîte d'un bloc, dans le format donné ; les autres boîtes et les autres formats restent les mêmes objets. */
export function setBlockBox(
  layouts: ExportLayouts,
  key: LayoutKey,
  id: BlockId,
  box: Box,
): ExportLayouts {
  return {
    ...layouts,
    [key]: { ...layouts[key], [id]: clampBox(box) },
  };
}

/** Remet UN bloc à sa place d'origine, dans le format donné. */
export function resetBlockBox(
  layouts: ExportLayouts,
  key: LayoutKey,
  id: BlockId,
): ExportLayouts {
  return setBlockBox(layouts, key, id, defaultBox(key, id));
}

/** Remet les quatre blocs du format à leur place d'origine (les autres formats ne bougent pas). */
export function resetLayout(
  layouts: ExportLayouts,
  key: LayoutKey,
): ExportLayouts {
  let next = layouts;
  for (const id of ["ref", "arabic", "translation", "wave"] as const)
    next = resetBlockBox(next, key, id);
  return next;
}

/** Un pas de « Onde plus haute / plus basse » : 2 % du cadre, autour du milieu de l'onde. */
const WAVE_STEP = 0.02;
const WAVE_MAX_HEIGHT = 0.6;
export function stepWaveBox(box: Box, direction: 1 | -1): Box {
  const h = clamp(box.h + direction * WAVE_STEP, MIN_BOX.h, WAVE_MAX_HEIGHT);
  const middle = box.y + box.h / 2;
  return clampBox({ ...box, y: middle - h / 2, h });
}

/** L'onde est-elle à sa plus basse ou à sa plus haute possible ? (les boutons − et + se désactivent) */
export function waveLimits(box: Box): { atMin: boolean; atMax: boolean } {
  return {
    atMin: box.h <= MIN_BOX.h + 1e-9,
    atMax: box.h >= WAVE_MAX_HEIGHT - 1e-9,
  };
}

// ── styles de texte ─────────────────────────────────────────────────────────

/** La taille d'UN texte (chaque texte a la sienne). Une taille qui n'est pas un nombre laisse les styles tels quels. */
export function setTextSize(
  styles: TextStyles,
  block: TextBlockId,
  size: number,
): TextStyles {
  if (!Number.isFinite(size)) return styles;
  return {
    ...styles,
    [block]: {
      ...styles[block],
      size: clamp(size, SIZE_LIMITS.min, SIZE_LIMITS.max),
    },
  };
}

/**
 * Le fond d'UN texte (arabe et traduction sont indépendants). Transparence et arrondi sont bornés ; une
 * couleur qui n'est pas `#rrggbb` est refusée (les styles restent tels quels), une bonne est mise en minuscules.
 */
export function setPanel(
  styles: TextStyles,
  block: TextBlockId,
  change: Partial<PanelStyle>,
): TextStyles {
  const panel: PanelStyle = { ...styles[block].panel, ...change };
  if (change.color !== undefined) {
    if (!HEX.test(change.color)) return styles;
    panel.color = change.color.toLowerCase();
  }
  if (change.opacity !== undefined)
    panel.opacity = Number.isFinite(change.opacity)
      ? clamp(
          change.opacity,
          PANEL_LIMITS.opacity.min,
          PANEL_LIMITS.opacity.max,
        )
      : styles[block].panel.opacity;
  if (change.radius !== undefined)
    panel.radius = Number.isFinite(change.radius)
      ? clamp(change.radius, PANEL_LIMITS.radius.min, PANEL_LIMITS.radius.max)
      : styles[block].panel.radius;
  return { ...styles, [block]: { ...styles[block], panel } };
}

/** Les six couleurs proposées pour le fond d'un texte (la septième, libre, est un sélecteur de couleur). */
export const PANEL_SWATCHES = [
  { value: "#06080c", label: "Encre de nuit" },
  { value: "#ffffff", label: "Blanc" },
  { value: "#f2efe6", label: "Ivoire" },
  { value: "#17284d", label: "Bleu nuit" },
  { value: "#1f4a38", label: "Vert cyprès" },
  { value: "#5a2a1e", label: "Terre cuite" },
] as const;

// ── éléments affichés ───────────────────────────────────────────────────────

type ShowFlags = Pick<
  VideoPrefs,
  "showRef" | "showArabic" | "showTranslation" | "showWave"
>;
const FLAG: Record<BlockId, keyof ShowFlags> = {
  ref: "showRef",
  arabic: "showArabic",
  translation: "showTranslation",
  wave: "showWave",
};

/** Quels éléments sont dans la vidéo. */
export function visibilityOf(prefs: ShowFlags): Required<Visibility> {
  return {
    ref: prefs.showRef,
    arabic: prefs.showArabic,
    translation: prefs.showTranslation,
    wave: prefs.showWave,
  };
}

export const isVisible = (prefs: ShowFlags, id: BlockId): boolean =>
  prefs[FLAG[id]];

/** Une des deux écritures reste affichée : on ne masque pas la dernière. L'onde et la sourate se masquent toujours. */
export function canHide(prefs: ShowFlags, id: BlockId): boolean {
  if (id === "arabic") return prefs.showTranslation;
  if (id === "translation") return prefs.showArabic;
  return true;
}

/** Le réglage à enregistrer pour masquer ou afficher un élément ; `null` si c'est refusé (la dernière écriture). */
export function setVisibility(
  prefs: ShowFlags,
  id: BlockId,
  shown: boolean,
): Partial<ShowFlags> | null {
  if (!shown && !canHide(prefs, id)) return null;
  return { [FLAG[id]]: shown };
}
