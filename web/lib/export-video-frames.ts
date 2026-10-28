/**
 * Moteur de rendu de la vidéo d'export, image par image : le navigateur dessine chaque
 * frame sur canvas — le passage actif (avec le mot courant surligné, comme l'écran de
 * l'atelier), la traduction, l'onde jouée/non jouée — puis l'encode en H.264 (WebCodecs).
 * Le serveur ne fait plus que muxer (vidéo + copie d'écoute → MP4).
 *
 * La disposition du texte (retours à la ligne, tailles ajustées, pas de chevauchement) vit
 * dans `export-video-layout.ts` ; ici on ne fait que dessiner ce qu'elle a calculé.
 *
 * INVARIANTS : le texte vient du résultat (corpus, I1) ; la traduction est rendue sans
 * modification et SANS attribution incrustée (choix du mainteneur, 2026-10-27) ; les
 * temps de mots invalides se replient sur un passage entier jamais sur un mot deviné.
 */
import {
  currentWordIndex,
  layoutArabicWords,
  liveWords,
  type LiveWords,
} from "./live-highlight";
import type { Interval } from "./recognition";
import { barHeights, peakNorm } from "./waveform";
import { videoCardInputs, type VideoCardInput } from "./export-video-cards";
import type { ListeningPeaks } from "./listening";
import type { VideoPrefs } from "./export-video-prefs";
import {
  layoutCard,
  sizeScale,
  waveZoneFraction,
  type CardLayout,
  type Rect,
} from "./export-video-layout";
import {
  paintGradientBackground,
  type GradientBackground,
} from "./export-video-backgrounds";

export const VIDEO_FPS = 25;
/** Onde : une barre toutes les 4,2 px et 2,6 px de large, comme la timeline de l'atelier. */
const BAR_WIDTH = 2.6;
const BAR_PITCH = 4.2;
/** Fenêtre de l'onde, en secondes : comme la timeline de l'atelier, elle défile avec la tête de lecture. */
export const WAVE_WINDOW_SECONDS = 30;

export type FrameCard = {
  card: VideoCardInput;
  /** Temps de mots validés, sinon null : aucun surlignage mot à mot. */
  live: LiveWords | null;
};

/** Les cartes d'une session, ordonnées par temps de début (le résultat l'est déjà). */
export function frameCards(
  intervals: readonly Interval[],
  showTranslation: boolean,
): FrameCard[] {
  return videoCardInputs(intervals)
    .map((card, index) => ({ card, interval: cardIntervals(intervals)[index] }))
    .filter((entry) => entry.interval !== undefined)
    .map((entry) => ({
      card: {
        ...entry.card,
        translation: showTranslation ? entry.card.translation : null,
        attribution: null,
      },
      live: liveWords(entry.interval),
    }));
}

/** Intervalle d'origine de chaque carte (même filtre que videoCardInputs). */
function cardIntervals(intervals: readonly Interval[]): Interval[] {
  const kept: Interval[] = [];
  for (const item of intervals) {
    if (item.kind !== "verse" || !item.t || !item.ref) continue;
    if (!item.text || !item.text.trim()) continue;
    kept.push(item);
  }
  return kept;
}

/** La carte affichée à l'instant t (null : écran neutre, fond + onde seulement). */
export function activeCardAt(
  cards: readonly FrameCard[],
  t: number,
): FrameCard | null {
  for (const card of cards) {
    if (t >= card.card.start && t < card.card.end) return card;
  }
  return null;
}

/** Combien des `bars` barres de l'onde sont jouées à l'instant t. */
export function playedBarCount(
  bars: number,
  t: number,
  duration: number,
): number {
  if (!(duration > 0)) return 0;
  return Math.max(0, Math.min(bars, Math.floor((t / duration) * bars)));
}

export type WaveGeometry = {
  zoneY: number;
  zoneH: number;
  bars: number;
  pitch: number;
  barWidth: number;
};

export function waveBarGeometry(
  width: number,
  height: number,
  zoneHeightPct = waveZoneFraction(width, height) * 100,
): WaveGeometry {
  const zoneH = Math.round((height * zoneHeightPct) / 100);
  const bars = Math.max(1, Math.floor(width / BAR_PITCH));
  return {
    zoneY: height - zoneH,
    zoneH,
    bars,
    pitch: width / bars,
    barWidth: BAR_WIDTH,
  };
}

export function frameCountFor(
  duration: number,
  fps: number = VIDEO_FPS,
): number {
  return Math.max(1, Math.ceil(duration * fps));
}

// ── dessin d'une frame ──────────────────────────────────────────────────────

export type FrameColors = {
  text: string;
  accent: string;
  wave: string;
  wavePlayed: string;
};

export type FrameState = {
  width: number;
  height: number;
  t: number;
  duration: number;
  cards: readonly FrameCard[];
  peaks: ListeningPeaks;
  colors: FrameColors;
  prefs: Pick<VideoPrefs, "arabicSize" | "translationSize">;
  /** Fond : image/vidéo (image courante), sinon dégradé, sinon couleur unie. */
  background: {
    color: string;
    image?: CanvasImageSource | null;
    gradient?: GradientBackground | null;
  };
  /** Support de lisibilité derrière le texte (fond photo ou vidéo). */
  scrim: boolean;
  measureContext: CanvasRenderingContext2D;
  /** Police du texte arabe (Mushaf). */
  fontFamily: string;
  /** Police de la référence et de la traduction (interface). */
  translationFontFamily: string;
};

/** Couvre le canvas avec la source (image ou vidéo), en rognant l'excédent. */
function paintCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
): void {
  const any = source as {
    videoWidth?: number;
    videoHeight?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  };
  const sw = any.videoWidth || any.naturalWidth || any.width || width;
  const sh = any.videoHeight || any.naturalHeight || any.height || height;
  const scale = Math.max(width / sw, height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh);
}

/** Rectangle arrondi à bords adoucis : couches concentriques de faible opacité. */
function paintSoftPanel(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  feather: number,
): void {
  const layers = 14;
  ctx.save();
  ctx.fillStyle = "rgba(6, 8, 12, 0.075)";
  for (let i = 0; i < layers; i++) {
    const inset = (i / layers) * feather * 2 - feather;
    const radius = Math.max(2, feather * 1.4 - Math.max(0, inset) * 0.4);
    ctx.beginPath();
    ctx.roundRect(
      rect.x + inset,
      rect.y + inset,
      Math.max(1, rect.width - inset * 2),
      Math.max(1, rect.height - inset * 2),
      radius,
    );
    ctx.fill();
  }
  ctx.restore();
}

/** Voile sombre sous l'onde : l'onde reste lisible sur n'importe quelle image. */
function paintWaveScrim(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const zone = Math.round(height * waveZoneFraction(width, height));
  const top = height - zone * 1.4;
  const gradient = ctx.createLinearGradient(0, top, 0, height);
  gradient.addColorStop(0, "rgba(6, 8, 12, 0)");
  gradient.addColorStop(1, "rgba(6, 8, 12, 0.6)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, top, width, zone * 1.4);
}

const layoutMemo = new WeakMap<
  FrameCard,
  { key: string; layout: CardLayout }
>();

/** Mise en page d'une carte (mémorisée : les tailles ne changent pas pendant le rendu). */
export function cardLayoutFor(state: FrameState, card: FrameCard): CardLayout {
  const { width, height, prefs } = state;
  const key = `${width}x${height}:${prefs.arabicSize}:${prefs.translationSize}:${state.fontFamily}`;
  const known = layoutMemo.get(card);
  if (known && known.key === key) return known.layout;
  const measure = state.measureContext;
  const layout = layoutCard({
    width,
    height,
    parts: layoutArabicWords(card.card.arabic).parts,
    translation: card.card.translation,
    arabicSize: prefs.arabicSize,
    translationSize: prefs.translationSize,
    measureArabic: (text, size) => {
      measure.font = `${size}px ${state.fontFamily}`;
      return measure.measureText(text).width;
    },
    measureTranslation: (text, size) => {
      measure.font = `${size}px ${state.translationFontFamily}`;
      return measure.measureText(text).width;
    },
  });
  layoutMemo.set(card, { key, layout });
  return layout;
}

/** Une frame complète à l'instant t. */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  state: FrameState,
): void {
  const { width, height, t, duration, peaks } = state;
  const scale = sizeScale(width, height);
  ctx.clearRect(0, 0, width, height);

  // Fond.
  const bg = state.background;
  if (bg.image) {
    paintCover(ctx, bg.image, width, height);
  } else if (bg.gradient) {
    paintGradientBackground(ctx, bg.gradient, width, height);
  } else {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, width, height);
  }

  // Carte-passage (écran neutre hors passage : rien au-dessus du fond).
  const active = activeCardAt(state.cards, t);
  if (active) {
    const layout = cardLayoutFor(state, active);
    if (state.scrim) paintSoftPanel(ctx, layout.panel, 34 * scale);
    ctx.direction = "ltr";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    ctx.fillStyle = state.colors.accent;
    ctx.font = `600 ${layout.refSize}px ${state.translationFontFamily}`;
    ctx.fillText(active.card.refLabel, width / 2, layout.refY);

    const current = active.live ? currentWordIndex(active.live.times, t) : null;
    ctx.font = `${layout.arabicSize}px ${state.fontFamily}`;
    ctx.textAlign = "left";
    for (const line of layout.arabicLines) {
      for (const part of line.parts) {
        ctx.fillStyle =
          part.word !== null && part.word === current
            ? state.colors.accent
            : state.colors.text;
        ctx.fillText(part.text, part.x, line.y);
      }
    }

    ctx.textAlign = "center";
    ctx.fillStyle = state.colors.text;
    ctx.font = `${layout.translationSize}px ${state.translationFontFamily}`;
    for (const line of layout.translationLines)
      ctx.fillText(line.text, width / 2, line.y);
  }

  // Onde : comme la timeline de l'atelier, une fenêtre qui défile avec la tête de lecture,
  // barres jouées en clair, à venir en sombre, tête de lecture en accent.
  if (state.scrim) paintWaveScrim(ctx, width, height);
  const geometry = waveBarGeometry(width, height);
  const windowSec = Math.min(duration, WAVE_WINDOW_SECONDS);
  const t0 = Math.max(0, Math.min(duration - windowSec, t - windowSec / 2));
  const norm = peakNorm(peaks.peaks);
  const heights = barHeights(
    peaks.peaks,
    duration,
    t0,
    t0 + windowSec,
    geometry.bars,
    norm,
  );
  const played = playedBarCount(geometry.bars, t - t0, windowSec);
  const middle = geometry.zoneY + geometry.zoneH / 2;
  const usableH = geometry.zoneH - 12 * scale;
  for (let i = 0; i < geometry.bars; i++) {
    const bar = Math.max(2 * scale, heights[i] * usableH);
    const x =
      i * geometry.pitch + (geometry.pitch - geometry.barWidth * scale) / 2;
    ctx.fillStyle = i < played ? state.colors.wavePlayed : state.colors.wave;
    ctx.beginPath();
    ctx.roundRect(x, middle - bar / 2, geometry.barWidth * scale, bar, 1.3);
    ctx.fill();
  }
  const playheadX = windowSec > 0 ? ((t - t0) / windowSec) * width : 0;
  ctx.fillStyle = state.colors.accent;
  ctx.fillRect(
    playheadX - scale,
    geometry.zoneY + 4 * scale,
    2 * scale,
    geometry.zoneH - 8 * scale,
  );
}
