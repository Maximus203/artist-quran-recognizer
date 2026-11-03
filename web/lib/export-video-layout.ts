/**
 * Mise en page d'une carte-passage de la vidéo d'export : fonctions pures (aucun canvas), donc
 * testables. Chaque bloc (sourate et verset, arabe, traduction) est placé dans SA boîte
 * (`ExportLayout`, fractions du cadre) : retour à la ligne automatique, puis réduction homothétique
 * de CE bloc jusqu'à tenir dans sa boîte. La réduction est rapportée (« réduit à 87 % ») pour que
 * l'interface puisse la dire ; une boîte vraiment trop petite est signalée (`overflow`).
 *
 * INVARIANT I1 : le texte arabe n'est que découpé (mots du corpus, caractères conservés).
 * INVARIANT I2 : la traduction n'est que découpée en lignes, jamais modifiée ; son attribution (id,
 * version, source) est placée DANS le bloc de la traduction, collée sous elle, quand on la fournit.
 */
import type { ArabicPart } from "./live-highlight";
import { clampBox } from "./export-video-edit";
import {
  sizeScale,
  textPixelSize,
  type Box,
  type ExportLayout,
  type TextStyle,
  type TextStyles,
} from "./export-video-model";

/** Largeur du texte à la taille `size` (px), pour la police concernée. */
export type MeasureText = (text: string, size: number) => number;

export type PlacedPart = ArabicPart & { x: number; width: number };
export type ArabicLine = { parts: PlacedPart[]; width: number; y: number };
export type TranslationLine = { text: string; y: number };

/** Rectangle en pixels du cadre. */
export type Rect = { x: number; y: number; width: number; height: number };

/** Ce que l'ajustement d'un bloc à sa boîte a fait, pour que l'interface le dise. */
export type BlockFit = {
  /** Facteur appliqué à la taille choisie : 1 = telle quelle, < 1 réduite, > 1 agrandie (« remplir »). */
  fit: number;
  /** « réduit à 87 % », « agrandi à 140 % » ; null quand la taille est celle qui a été choisie. */
  note: string | null;
  /** Vrai si le texte dépasse encore sa boîte au plus petit facteur : la zone est trop petite. */
  overflow: boolean;
};

type BlockBase = BlockFit & {
  /** Boîte du bloc, en pixels. */
  box: Rect;
  /** Rectangle du fond du texte (jamais plus grand que la boîte, sauf l'adoucissement des bords). */
  panel: Rect;
  /** Milieu horizontal de la boîte : axe du texte centré. */
  centerX: number;
};

export type RefBlock = BlockBase & { text: string; size: number; y: number };
export type ArabicBlock = BlockBase & { size: number; lines: ArabicLine[] };
export type TranslationBlock = BlockBase & {
  size: number;
  lines: TranslationLine[];
  /** Attribution de la traduction, sous ses lignes (taille réduite), ou null. */
  attribution: {
    lines: string[];
    /** Milieu de la première ligne. */
    y: number;
    size: number;
    lineHeight: number;
  } | null;
};

export type CardLayout = {
  width: number;
  height: number;
  ref: RefBlock | null;
  arabic: ArabicBlock | null;
  translation: TranslationBlock | null;
  /** Rectangle de l'onde, en pixels ; null si elle est masquée. */
  wave: Rect | null;
};

export type LayoutInput = {
  width: number;
  height: number;
  /** Les quatre boîtes de la mise en page à lire (déjà choisie pour la forme du cadre). */
  layout: ExportLayout;
  styles: TextStyles;
  /** Texte de la référence (« Al-Fatiha 1:1 »). */
  refLabel: string;
  /** Découpe en mots du verset (`layoutArabicWords`) ; vide = pas de bloc arabe. */
  parts: readonly ArabicPart[];
  translation: string | null;
  /** Attribution de la traduction (I2), collée sous elle ; absente = rien n'est ajouté. */
  attribution?: string | null;
  measureArabic: MeasureText;
  measureTranslation: MeasureText;
  /** Mesure de la référence (police en gras) ; défaut : celle de la traduction. */
  measureRef?: MeasureText;
  showRef?: boolean;
  showWave?: boolean;
};

const MIN_FIT = 0.4;
/** Plafond de l'agrandissement automatique (« remplir »). */
const MAX_FIT = 4;
const ARABIC_LINE_HEIGHT = 1.75;
const TRANSLATION_LINE_HEIGHT = 1.4;
const REF_LINE_HEIGHT = 1.4;
/** Plus petite référence lisible (px), quelle que soit la taille de la vidéo. */
const MIN_REF_PX = 14;
const ATTRIBUTION_RATIO = 0.6;
const ATTRIBUTION_LINE_HEIGHT = 1.3;
const ATTRIBUTION_GAP = 0.3;
/** Marge intérieure d'un fond (px de la vidéo de référence) et sa part maximale d'une petite boîte. */
const PANEL_PAD = 30;
const PANEL_PAD_MAX_SHARE = 0.2;
/** Tolérance de comparaison (px) : un texte « tient » à moins d'un demi-pixel près. */
const FIT_TOLERANCE = 0.5;

/** Retour à la ligne glouton de la traduction (mots séparés par des espaces). */
export function wrapTranslation(
  text: string,
  maxWidth: number,
  size: number,
  measure: MeasureText,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measure(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Retour à la ligne glouton de l'arabe, mot par mot ; un blanc en bout de ligne est écarté. */
export function wrapArabic(
  parts: readonly ArabicPart[],
  maxWidth: number,
  size: number,
  measure: MeasureText,
): { parts: (ArabicPart & { width: number })[]; width: number }[] {
  const lines: { parts: (ArabicPart & { width: number })[]; width: number }[] =
    [];
  let current: (ArabicPart & { width: number })[] = [];
  let width = 0;
  const flush = () => {
    while (current.length && current[current.length - 1].word === null)
      current.pop();
    if (current.length) {
      lines.push({
        parts: current,
        width: current.reduce((sum, p) => sum + p.width, 0),
      });
    }
    current = [];
    width = 0;
  };
  for (const part of parts) {
    const w = measure(part.text, size);
    if (part.word === null) {
      if (current.length) {
        current.push({ ...part, width: w });
        width += w;
      }
      continue;
    }
    if (current.length && width + w > maxWidth) flush();
    current.push({ ...part, width: w });
    width += w;
  }
  flush();
  return lines;
}

/** « réduit à 87 % » ou « agrandi à 140 % » ; null si la taille choisie est respectée. */
export function fitNote(fit: number): string | null {
  const percent = Math.round(fit * 100);
  if (fit < 0.995) return `réduit à ${percent} %`;
  if (fit > 1.005) return `agrandi à ${percent} %`;
  return null;
}

type Built = { width: number; height: number };

/**
 * Cherche le facteur d'échelle d'un bloc : 1 (taille choisie), agrandi par paliers en mode « remplir »,
 * puis réduit tant que le bloc (hauteur OU largeur d'un mot) dépasse sa zone, jusqu'à `MIN_FIT`.
 */
function fitBlock<B extends Built>(
  build: (fit: number) => B,
  availWidth: number,
  availHeight: number,
  fill: boolean,
): { fit: number; built: B; overflow: boolean } {
  // « Tient » est strict : le texte ne sort jamais de sa boîte. Seul le signal de débordement est tolérant
  // (un demi-pixel de reste de calcul n'est pas une zone trop petite).
  const fits = (b: Built) => b.height <= availHeight && b.width <= availWidth;
  const fitsLoosely = (b: Built) =>
    b.height <= availHeight + FIT_TOLERANCE &&
    b.width <= availWidth + FIT_TOLERANCE;
  let fit = 1;
  let built = build(fit);
  if (fill) {
    // Agrandit par paliers tant que tout tient, puis affine : le bloc occupe sa zone.
    let step = 1.15;
    for (let i = 0; i < 18; i++) {
      const candidate = Math.min(MAX_FIT, fit * step);
      const next = build(candidate);
      if (fits(next) && fit < MAX_FIT) {
        fit = candidate;
        built = next;
      } else {
        step = 1 + (step - 1) / 2;
      }
    }
  }
  // Trop grand : on réduit d'un facteur proportionnel au dépassement…
  let tooBig = fit;
  for (let i = 0; i < 12 && !fits(built) && fit > MIN_FIT; i++) {
    tooBig = fit;
    const ratio = Math.min(
      availHeight / Math.max(1e-6, built.height),
      availWidth / Math.max(1e-6, built.width),
    );
    fit = Math.max(MIN_FIT, fit * Math.max(0.5, ratio * 0.98));
    built = build(fit);
  }
  // … puis on remonte : réduire change le nombre de lignes (moins de lignes quand les mots rapetissent),
  // le premier facteur qui tient peut donc être bien plus petit que nécessaire. Dichotomie entre le
  // dernier facteur qui tient et le dernier qui ne tenait pas.
  if (fits(built) && fit < tooBig) {
    let low = fit;
    let high = tooBig;
    for (let i = 0; i < 10; i++) {
      const middle = (low + high) / 2;
      const candidate = build(middle);
      if (fits(candidate)) {
        low = middle;
        built = candidate;
      } else high = middle;
    }
    fit = low;
  }
  return { fit, built, overflow: !fitsLoosely(built) };
}

const toRect = (box: Box, width: number, height: number): Rect => ({
  x: box.x * width,
  y: box.y * height,
  width: box.w * width,
  height: box.h * height,
});

/**
 * Marge intérieure du fond, sur les côtés (elle réduit la largeur du texte) : aucune sans fond ; jamais
 * plus de 20 % d'une petite boîte. En hauteur le texte peut occuper toute la boîte ; le fond, lui, ne
 * sort jamais de la boîte.
 */
function padFor(style: TextStyle, scale: number, box: Rect): number {
  if (style.panel.kind === "none") return 0;
  return Math.min(
    PANEL_PAD * scale,
    PANEL_PAD_MAX_SHARE * Math.min(box.width, box.height),
  );
}

/**
 * Haut du texte dans sa boîte : tout en haut, au milieu ou tout en bas. En haut et en bas, le texte
 * garde la marge du fond tant qu'il reste de la place (jamais au prix de sortir de la boîte) ; un texte
 * plus haut que sa boîte (zone trop petite) déborde également des deux côtés.
 */
function contentTopOf(
  style: TextStyle,
  box: Rect,
  contentHeight: number,
  pad: number,
): number {
  const room = box.height - contentHeight;
  if (room <= 0 || style.valign === "center") return box.y + room / 2;
  const margin = Math.min(pad, room);
  return style.valign === "start" ? box.y + margin : box.y + room - margin;
}

/** Rectangle du fond : épouse le texte (borné à la boîte) ou prend toute la boîte. */
function panelRect(
  style: TextStyle,
  box: Rect,
  contentWidth: number,
  contentHeight: number,
  contentTop: number,
  pad: number,
): Rect {
  if (style.panel.extent === "box") return { ...box };
  const width = Math.min(box.width, contentWidth + pad * 2);
  const height = Math.min(box.height, contentHeight + pad * 2);
  const top = Math.min(
    Math.max(box.y, contentTop - pad),
    box.y + box.height - height,
  );
  return { x: box.x + (box.width - width) / 2, y: top, width, height };
}

const report = (
  fit: number,
  overflow: boolean,
): Pick<BlockFit, "fit" | "note" | "overflow"> => ({
  fit,
  note: fitNote(fit),
  overflow,
});

/** Disposition complète d'une carte pour un canvas `width × height` : chaque bloc dans sa boîte. */
export function layoutCard(input: LayoutInput): CardLayout {
  const { width, height } = input;
  const empty: CardLayout = {
    width,
    height,
    ref: null,
    arabic: null,
    translation: null,
    wave: null,
  };
  if (!(width > 0) || !(height > 0)) return empty;
  const scale = sizeScale(width, height);
  const rectOf = (box: Box): Rect => toRect(clampBox(box), width, height);
  const measureRef = input.measureRef ?? input.measureTranslation;
  const layout: CardLayout = { ...empty };

  // ── sourate et verset : une ligne, réduite si elle est plus large que sa boîte ──
  if (input.showRef !== false && input.refLabel.trim()) {
    const style = input.styles.ref;
    const box = rectOf(input.layout.ref);
    const pad = padFor(style, scale, box);
    const requested = textPixelSize("ref", style.size, width, height);
    const build = (fit: number) => {
      const size = Math.max(MIN_REF_PX, requested * fit);
      return {
        size,
        width: measureRef(input.refLabel, size),
        height: size * REF_LINE_HEIGHT,
      };
    };
    const { fit, built, overflow } = fitBlock(
      build,
      Math.max(1, box.width),
      Math.max(1, box.height),
      style.fill,
    );
    const top = contentTopOf(style, box, built.height, pad);
    layout.ref = {
      text: input.refLabel,
      size: built.size,
      y: top + built.height / 2,
      box,
      centerX: box.x + box.width / 2,
      panel: panelRect(style, box, built.width, built.height, top, pad),
      ...report(fit, overflow),
    };
  }

  // ── texte arabe : lignes de droite à gauche, centrées dans la boîte ──
  if (input.parts.some((part) => part.word !== null)) {
    const style = input.styles.arabic;
    const box = rectOf(input.layout.arabic);
    const pad = padFor(style, scale, box);
    const availWidth = Math.max(1, box.width);
    const requested = textPixelSize("arabic", style.size, width, height);
    const build = (fit: number) => {
      const size = requested * fit;
      const lines = wrapArabic(
        input.parts,
        availWidth,
        size,
        input.measureArabic,
      );
      return {
        size,
        lines,
        width: Math.max(0, ...lines.map((l) => l.width)),
        height: lines.length * size * ARABIC_LINE_HEIGHT,
      };
    };
    const { fit, built, overflow } = fitBlock(
      build,
      availWidth,
      Math.max(1, box.height),
      style.fill,
    );
    const centerX = box.x + box.width / 2;
    const lineHeight = built.size * ARABIC_LINE_HEIGHT;
    const top = contentTopOf(style, box, built.height, pad);
    let y = top;
    const lines: ArabicLine[] = built.lines.map((line) => {
      const entry: ArabicLine = {
        width: line.width,
        y: y + lineHeight / 2,
        parts: [],
      };
      let x = centerX + line.width / 2; // bord droit : l'arabe se lit de droite à gauche
      for (const part of line.parts) {
        x -= part.width;
        entry.parts.push({ ...part, x });
      }
      y += lineHeight;
      return entry;
    });
    layout.arabic = {
      size: built.size,
      lines,
      box,
      centerX,
      panel: panelRect(style, box, built.width, built.height, top, pad),
      ...report(fit, overflow),
    };
  }

  // ── traduction (et son attribution, collée dessous) ──
  const translation = input.translation?.trim();
  if (translation) {
    const style = input.styles.translation;
    const box = rectOf(input.layout.translation);
    const pad = padFor(style, scale, box);
    const availWidth = Math.max(1, box.width);
    const requested = textPixelSize("translation", style.size, width, height);
    const attributionText = input.attribution?.trim() || null;
    const build = (fit: number) => {
      const size = requested * fit;
      const lines = wrapTranslation(
        translation,
        availWidth,
        size,
        input.measureTranslation,
      );
      const attributionSize = size * ATTRIBUTION_RATIO;
      const attributionLines = attributionText
        ? wrapTranslation(
            attributionText,
            availWidth,
            attributionSize,
            input.measureTranslation,
          )
        : [];
      const gap = attributionLines.length ? size * ATTRIBUTION_GAP : 0;
      const widest = Math.max(
        0,
        ...lines.map((l) => input.measureTranslation(l, size)),
        ...attributionLines.map((l) =>
          input.measureTranslation(l, attributionSize),
        ),
      );
      return {
        size,
        lines,
        attributionSize,
        attributionLines,
        gap,
        width: widest,
        height:
          lines.length * size * TRANSLATION_LINE_HEIGHT +
          gap +
          attributionLines.length * attributionSize * ATTRIBUTION_LINE_HEIGHT,
      };
    };
    const { fit, built, overflow } = fitBlock(
      build,
      availWidth,
      Math.max(1, box.height),
      style.fill,
    );
    const lineHeight = built.size * TRANSLATION_LINE_HEIGHT;
    const top = contentTopOf(style, box, built.height, pad);
    let y = top;
    const lines: TranslationLine[] = built.lines.map((text) => {
      const entry = { text, y: y + lineHeight / 2 };
      y += lineHeight;
      return entry;
    });
    y += built.gap;
    const attributionLineHeight =
      built.attributionSize * ATTRIBUTION_LINE_HEIGHT;
    layout.translation = {
      size: built.size,
      lines,
      attribution: built.attributionLines.length
        ? {
            lines: built.attributionLines,
            y: y + attributionLineHeight / 2,
            size: built.attributionSize,
            lineHeight: attributionLineHeight,
          }
        : null,
      box,
      centerX: box.x + box.width / 2,
      panel: panelRect(style, box, built.width, built.height, top, pad),
      ...report(fit, overflow),
    };
  }

  if (input.showWave !== false) layout.wave = rectOf(input.layout.wave);
  return layout;
}
