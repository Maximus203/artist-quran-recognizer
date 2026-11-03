/**
 * L'onde sonore, de la crête à la barre : fonctions partagées par la frise des passages (`RangeTimeline`) et par la
 * table de montage. Elles lisent les crêtes de la session (`ListeningPeaks`) et disent QUOI dessiner (une barre
 * par pas de pixels) ; le dessin proprement dit n'a besoin que de `fillRect` et `fillStyle`, donc se teste sans
 * navigateur.
 */
import type { View } from "./export-timeline";

export type WavePeaks = {
  per_second: number;
  duration: number;
  peaks: readonly number[];
};

/** La crête la plus haute entre `t0` et `t1` (secondes). 0 sans crête. */
export function maxPeak(peaks: WavePeaks, t0: number, t1: number): number {
  const values = peaks.peaks;
  let highest = 0;
  const last = Math.min(values.length - 1, Math.ceil(t1 * peaks.per_second));
  for (let k = Math.max(0, Math.floor(t0 * peaks.per_second)); k <= last; k++)
    if (values[k] > highest) highest = values[k];
  return highest;
}

/** Une valeur par colonne de pixels sur [from, to] : de quoi dessiner une vue d'ensemble. */
export function peakColumns(
  peaks: WavePeaks,
  from: number,
  to: number,
  columns: number,
): Float32Array {
  const out = new Float32Array(Math.max(0, columns));
  const span = to - from;
  for (let px = 0; px < out.length; px++)
    out[px] = maxPeak(
      peaks,
      from + (px / out.length) * span,
      from + ((px + 1) / out.length) * span,
    );
  return out;
}

export type WaveBar = {
  /** Position horizontale (px) du bord gauche de la barre. */
  x: number;
  /** L'instant (s) au bord gauche de la barre. */
  t: number;
  /** Hauteur relative, de 0 à 1. */
  level: number;
};

/** Les barres d'une fenêtre `view` affichée sur `width` pixels : une tous les `step` pixels. */
export function waveBars(
  peaks: WavePeaks | null,
  view: View,
  width: number,
  step: number,
): WaveBar[] {
  if (!peaks || !(width > 0) || !(step > 0)) return [];
  const span = view.b - view.a;
  const bars: WaveBar[] = [];
  for (let x = 0; x < width; x += step) {
    const t = view.a + (x / width) * span;
    bars.push({
      x,
      t,
      level: maxPeak(peaks, t, view.a + ((x + step) / width) * span),
    });
  }
  return bars;
}

/** Ce que le dessin demande au contexte du canevas : rien d'autre. */
export type BarPainter = {
  fillStyle: unknown;
  fillRect: (x: number, y: number, w: number, h: number) => void;
};

export type WaveDrawing = {
  peaks: WavePeaks | null;
  view: View;
  width: number;
  /** Pixels entre deux barres. */
  step: number;
  /** Largeur d'une barre (px). */
  barWidth: number;
  /** Ligne médiane (px) et demi-hauteur maximale (px). */
  mid: number;
  amp: number;
  /** La couleur d'une barre selon son instant (lu / pas lu, dans la vidéo / hors de la vidéo…). */
  colorAt: (t: number) => string;
};

/** Dessine l'onde : une barre centrée sur la ligne médiane, au moins 1 px de demi-hauteur. */
export function drawWaveBars(g: BarPainter, drawing: WaveDrawing): void {
  for (const bar of waveBars(
    drawing.peaks,
    drawing.view,
    drawing.width,
    drawing.step,
  )) {
    const half = Math.max(1, bar.level * drawing.amp);
    g.fillStyle = drawing.colorAt(bar.t);
    g.fillRect(bar.x, drawing.mid - half, drawing.barWidth, half * 2);
  }
}
