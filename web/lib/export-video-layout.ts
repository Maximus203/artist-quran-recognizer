/**
 * Mise en page d'une carte-passage de la vidéo d'export : fonctions pures (aucun canvas), donc
 * testables. Garantit que la référence, l'arabe et la traduction s'enchaînent sans se
 * chevaucher et restent au-dessus de l'onde : retour à la ligne automatique, puis réduction
 * homothétique des tailles si le bloc dépasse encore la zone libre.
 *
 * INVARIANT I1 : le texte arabe n'est que découpé (mots du corpus, caractères conservés).
 */
import type { ArabicPart } from "./live-highlight";

/** Largeur du texte à la taille `size` (px), pour la police concernée. */
export type MeasureText = (text: string, size: number) => number;

export type PlacedPart = ArabicPart & { x: number; width: number };
export type ArabicLine = { parts: PlacedPart[]; width: number; y: number };
export type TranslationLine = { text: string; y: number };

export type Rect = { x: number; y: number; width: number; height: number };

export type CardLayout = {
  refY: number;
  refSize: number;
  arabicSize: number;
  arabicLines: ArabicLine[];
  translationSize: number;
  translationLines: TranslationLine[];
  /** Rectangle englobant tout le texte, marge comprise (support de lisibilité). */
  panel: Rect;
  /** Bas de la zone de texte ; l'onde commence en dessous. */
  textBottom: number;
  /** Facteur d'ajustement appliqué aux tailles demandées (1 = tailles telles que choisies). */
  fit: number;
};

export type LayoutInput = {
  width: number;
  height: number;
  /** Découpe en mots du verset (`layoutArabicWords`). */
  parts: readonly ArabicPart[];
  translation: string | null;
  /** Tailles demandées, dans la vidéo de référence de 1080 px de côté court. */
  arabicSize: number;
  translationSize: number;
  measureArabic: MeasureText;
  measureTranslation: MeasureText;
};

/** Côté court de référence : les tailles des préférences s'y rapportent. */
export const REFERENCE_SHORT_SIDE = 1080;
/** Part de la hauteur réservée à l'onde, en bas (plus basse en portrait : l'écran est déjà haut). */
export const waveZoneFraction = (width: number, height: number): number =>
  height > width ? 0.16 : 0.22;
const MIN_FIT = 0.4;
const ARABIC_LINE_HEIGHT = 1.75;
const TRANSLATION_LINE_HEIGHT = 1.4;

/** Échelle px d'une taille de référence pour ce canvas. */
export const sizeScale = (width: number, height: number): number =>
  Math.min(width, height) / REFERENCE_SHORT_SIDE;

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

type Pass = {
  arabic: ReturnType<typeof wrapArabic>;
  translation: string[];
  refSize: number;
  arabicSize: number;
  translationSize: number;
  gapRef: number;
  gapArabic: number;
  height: number;
};

function pass(input: LayoutInput, fit: number, maxWidth: number): Pass {
  const base = sizeScale(input.width, input.height) * fit;
  const arabicSize = input.arabicSize * base;
  const translationSize = input.translationSize * base;
  const refSize = Math.max(14, input.arabicSize * 0.36 * base);
  const arabic = wrapArabic(
    input.parts,
    maxWidth,
    arabicSize,
    input.measureArabic,
  );
  const translation = input.translation
    ? wrapTranslation(
        input.translation,
        maxWidth,
        translationSize,
        input.measureTranslation,
      )
    : [];
  const gapRef = refSize * 0.5;
  const gapArabic = translation.length ? arabicSize * 0.3 : 0;
  const height =
    refSize * 1.4 +
    gapRef +
    arabic.length * arabicSize * ARABIC_LINE_HEIGHT +
    gapArabic +
    translation.length * translationSize * TRANSLATION_LINE_HEIGHT;
  return {
    arabic,
    translation,
    refSize,
    arabicSize,
    translationSize,
    gapRef,
    gapArabic,
    height,
  };
}

/** Disposition complète d'une carte pour un canvas `width × height`. */
export function layoutCard(input: LayoutInput): CardLayout {
  const { width, height } = input;
  const sideMargin = width * (width < height ? 0.07 : 0.08);
  const maxWidth = width - sideMargin * 2;
  const top = height * 0.05;
  const textBottom =
    height * (1 - waveZoneFraction(width, height)) - height * 0.025;
  const zoneHeight = textBottom - top;
  const pad = sizeScale(width, height) * 40;
  // Le support de lisibilité est inclus dans la zone : on lui réserve sa marge.
  const available = zoneHeight - pad * 2;

  let fit = 1;
  let current = pass(input, fit, maxWidth);
  for (let i = 0; i < 10 && current.height > available && fit > MIN_FIT; i++) {
    fit = Math.max(
      MIN_FIT,
      fit * Math.max(0.5, (available / current.height) * 0.98),
    );
    current = pass(input, fit, maxWidth);
  }

  let y = top + (zoneHeight - current.height) / 2;
  const refY = y + (current.refSize * 1.4) / 2;
  y += current.refSize * 1.4 + current.gapRef;

  const arabicLines: ArabicLine[] = current.arabic.map((line) => {
    const lineHeight = current.arabicSize * ARABIC_LINE_HEIGHT;
    const entry: ArabicLine = {
      width: line.width,
      y: y + lineHeight / 2,
      parts: [],
    };
    let x = (width + line.width) / 2; // bord droit : l'arabe se lit de droite à gauche
    for (const part of line.parts) {
      x -= part.width;
      entry.parts.push({ ...part, x });
    }
    y += lineHeight;
    return entry;
  });
  y += current.gapArabic;

  const translationLines: TranslationLine[] = current.translation.map(
    (text) => {
      const lineHeight = current.translationSize * TRANSLATION_LINE_HEIGHT;
      const entry = { text, y: y + lineHeight / 2 };
      y += lineHeight;
      return entry;
    },
  );

  const widest = Math.max(
    0,
    ...arabicLines.map((l) => l.width),
    ...current.translation.map((t) =>
      input.measureTranslation(t, current.translationSize),
    ),
  );
  const refWidth = current.refSize * 8;
  const panelWidth = Math.min(width, Math.max(widest, refWidth) + pad * 2);
  const blockTop = top + (zoneHeight - current.height) / 2;
  const panel: Rect = {
    x: (width - panelWidth) / 2,
    y: Math.max(0, blockTop - pad),
    width: panelWidth,
    height: Math.min(height, current.height + pad * 2),
  };

  return {
    refY,
    refSize: current.refSize,
    arabicSize: current.arabicSize,
    arabicLines,
    translationSize: current.translationSize,
    translationLines,
    panel,
    textBottom,
    fit,
  };
}
