/**
 * Couleur d'accent de la vidéo (mot récité, référence du verset). Par défaut elle suit la couleur
 * principale du fond : teinte dominante d'une image/vidéo, ou teinte propre à chaque dégradé,
 * toujours ramenée à une luminosité qui reste lisible. L'utilisateur peut la remplacer
 * (teinte, intensité, luminosité, opacité). Fonctions pures, sans DOM.
 */
import type { AccentColor } from "./export-video-prefs";

/** Accent d'origine de l'atelier (or doux). */
export const DEFAULT_ACCENT: AccentColor = { h: 43, s: 62, l: 64, a: 1 };

/** Couleurs douces proposées d'un clic dans le sélecteur. */
export const SOFT_ACCENTS: readonly (AccentColor & { label: string })[] = [
  { label: "Or doux", h: 43, s: 62, l: 64, a: 1 },
  { label: "Pêche", h: 20, s: 85, l: 76, a: 1 },
  { label: "Rose poudré", h: 340, s: 60, l: 78, a: 1 },
  { label: "Lavande", h: 262, s: 55, l: 78, a: 1 },
  { label: "Ciel", h: 205, s: 70, l: 74, a: 1 },
  { label: "Menthe", h: 158, s: 50, l: 72, a: 1 },
  { label: "Citron", h: 62, s: 70, l: 72, a: 1 },
  { label: "Crème", h: 40, s: 30, l: 90, a: 1 },
];

const round = (n: number) => Math.round(n * 100) / 100;

/** `hsla(...)` utilisable par le canvas comme par le CSS. */
export function accentCss(color: AccentColor): string {
  return `hsla(${round(color.h)}, ${round(color.s)}%, ${round(color.l)}%, ${round(color.a)})`;
}

/** Même couleur, sans transparence (pastille de l'interface). */
export function accentSolidCss(color: AccentColor): string {
  return accentCss({ ...color, a: 1 });
}

function rgbToHsl(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

/**
 * Accent automatique tiré des pixels d'une image réduite (RGBA) : la teinte la plus présente
 * parmi les pixels assez colorés, ramenée à une saturation et une luminosité douces.
 * Image grise ou quasi noire/blanche : l'accent par défaut.
 */
export function accentFromPixels(pixels: ArrayLike<number>): AccentColor {
  const buckets = new Array<number>(36).fill(0);
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const { h, s, l } = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (s < 0.25 || l < 0.12 || l > 0.92) continue;
    // Les pixels plus saturés pèsent plus : c'est la « couleur de l'image », pas son gris moyen.
    buckets[Math.floor(h / 10) % 36] += s;
  }
  let best = -1;
  let bestWeight = 0;
  buckets.forEach((weight, index) => {
    if (weight > bestWeight) {
      best = index;
      bestWeight = weight;
    }
  });
  if (best < 0) return DEFAULT_ACCENT;
  return { h: best * 10 + 5, s: 65, l: 72, a: 1 };
}

/** Accent effectif : le choix de l'utilisateur, sinon l'automatique du fond. */
export function resolveAccent(
  chosen: AccentColor | null,
  automatic: AccentColor,
): AccentColor {
  return chosen ?? automatic;
}
