/**
 * Moteur de rendu de la vidéo d'export, image par image : le navigateur dessine chaque
 * frame sur canvas — le passage actif (avec le mot courant surligné, comme l'écran de
 * l'atelier), la traduction, l'onde jouée/non jouée — puis l'encode en H.264 (WebCodecs).
 * Le serveur ne fait plus que muxer (vidéo + copie d'écoute → MP4).
 *
 * La disposition du texte (boîtes, retours à la ligne, tailles ajustées, pas de chevauchement) vit
 * dans `export-video-layout.ts` ; le fond du texte (transparent, flou, plein) dans
 * `export-video-panels.ts` ; ici on ne fait que dessiner ce qu'ils ont calculé.
 *
 * INVARIANTS : le texte vient du résultat (corpus, I1) ; la traduction est rendue sans
 * modification et SANS attribution incrustée (choix du mainteneur, 2026-10-27 : `attribution`
 * reste null ici, la mise en page sait pourtant la coller sous la traduction, I2) ; les temps de
 * mots invalides se replient sur un passage entier jamais sur un mot deviné.
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
import { layoutFor, type VideoPrefs } from "./export-video-prefs";
import { clampBox } from "./export-video-edit";
import { layoutCard, type CardLayout, type Rect } from "./export-video-layout";
import { sizeScale, type ExportLayout } from "./export-video-model";
import {
  drawLegibleText,
  paintPanel,
  type Backdrop,
  type PanelDeps,
} from "./export-video-panels";
import {
  paintGradientBackground,
  type GradientBackground,
} from "./export-video-backgrounds";

export const VIDEO_FPS = 30;
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

/**
 * Les cartes d'une session, ordonnées par temps de début (le résultat l'est déjà). Sans écriture
 * arabe, la carte ne garde que la référence et la traduction (le texte arabe n'est pas dessiné).
 */
export function frameCards(
  intervals: readonly Interval[],
  showTranslation: boolean,
  showArabic = true,
): FrameCard[] {
  return videoCardInputs(intervals)
    .map((card, index) => ({ card, interval: cardIntervals(intervals)[index] }))
    .filter((entry) => entry.interval !== undefined)
    .map((entry) => ({
      card: {
        ...entry.card,
        arabic: showArabic ? entry.card.arabic : "",
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
  /** Bord gauche de la zone de l'onde. */
  zoneX: number;
  zoneY: number;
  zoneW: number;
  zoneH: number;
  bars: number;
  pitch: number;
  barWidth: number;
};

/**
 * Barres de l'onde dans le rectangle `zone` (pixels) : celui de la boîte « onde » de la mise en page.
 * L'espacement suit l'échelle de la vidéo (`sizeScale`, 1 = la référence de 1080 px) comme la largeur des
 * barres : l'onde a le même nombre de barres dans l'aperçu et dans l'export, à toute résolution.
 */
export function waveBarGeometry(zone: Rect, scale = 1): WaveGeometry {
  const zoneH = Math.round(zone.height);
  const pitch = BAR_PITCH * (scale > 0 ? scale : 1);
  const bars = Math.max(1, Math.floor(zone.width / pitch));
  return {
    zoneX: zone.x,
    zoneY: Math.round(zone.y),
    zoneW: zone.width,
    zoneH,
    bars,
    pitch: zone.width / bars,
    barWidth: BAR_WIDTH,
  };
}

/** La boîte de l'onde en pixels (ramenée dans le cadre). */
export function waveRectOf(
  layout: ExportLayout,
  width: number,
  height: number,
): Rect {
  const box = clampBox(layout.wave);
  return {
    x: box.x * width,
    y: box.y * height,
    width: box.w * width,
    height: box.h * height,
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
  /** Mises en page, styles et blocs affichés (la mise en page lue est celle de la forme du cadre). */
  prefs: Pick<VideoPrefs, "layouts" | "styles" | "showWave" | "showRef">;
  /** Fond : image/vidéo (image courante), sinon dégradé, sinon couleur unie. */
  background: {
    color: string;
    image?: CanvasImageSource | null;
    gradient?: GradientBackground | null;
  };
  /** Fond photo ou vidéo : un voile sombre est posé sous l'onde (lisibilité de l'onde). */
  scrim: boolean;
  measureContext: CanvasRenderingContext2D;
  /** Police du texte arabe (Mushaf). */
  fontFamily: string;
  /** Police de la référence et de la traduction (interface). */
  translationFontFamily: string;
  /** Canevas de travail du flou ; absent = ceux du navigateur (injectés dans les tests). */
  panelDeps?: Pick<PanelDeps, "scratch" | "fresh">;
};

/**
 * Comment une source (image ou vidéo) couvre le cadre, en rognant l'excédent : son rectangle dans le
 * cadre et sa taille propre.
 */
export function coverRect(
  source: CanvasImageSource,
  width: number,
  height: number,
): { dest: Rect; size: { width: number; height: number } } {
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
  return {
    dest: { x: (width - dw) / 2, y: (height - dh) / 2, width: dw, height: dh },
    size: { width: sw, height: sh },
  };
}

/** Le décor bouge-t-il d'une image à l'autre ? Une vidéo, oui ; une photo, non. */
const isLiveSource = (source: CanvasImageSource): boolean =>
  "videoWidth" in (source as object);

/** Voile sombre sous l'onde : l'onde reste lisible sur n'importe quelle image. */
function paintWaveScrim(ctx: CanvasRenderingContext2D, zone: Rect): void {
  const bottom = zone.y + zone.height;
  const top = bottom - zone.height * 1.4;
  const gradient = ctx.createLinearGradient(0, top, 0, bottom);
  gradient.addColorStop(0, "rgba(6, 8, 12, 0)");
  gradient.addColorStop(1, "rgba(6, 8, 12, 0.6)");
  ctx.fillStyle = gradient;
  ctx.fillRect(zone.x, top, zone.width, zone.height * 1.4);
}

type LayoutKey = {
  width: number;
  height: number;
  layout: ExportLayout;
  styles: VideoPrefs["styles"];
  showRef: boolean;
  showWave: boolean;
  fontFamily: string;
  translationFontFamily: string;
};

const layoutMemo = new WeakMap<
  FrameCard,
  { key: LayoutKey; layout: CardLayout }
>();

const sameKey = (a: LayoutKey, b: LayoutKey): boolean =>
  a.width === b.width &&
  a.height === b.height &&
  a.layout === b.layout &&
  a.styles === b.styles &&
  a.showRef === b.showRef &&
  a.showWave === b.showWave &&
  a.fontFamily === b.fontFamily &&
  a.translationFontFamily === b.translationFontFamily;

/**
 * Mise en page d'une carte (mémorisée : elle ne change pas pendant le rendu). La mémoire compare les
 * réglages par identité : un réglage modifié est un NOUVEL objet, jamais une mutation.
 */
export function cardLayoutFor(state: FrameState, card: FrameCard): CardLayout {
  const { width, height, prefs } = state;
  const key: LayoutKey = {
    width,
    height,
    layout: layoutFor(prefs, width, height),
    styles: prefs.styles,
    showRef: prefs.showRef,
    showWave: prefs.showWave,
    fontFamily: state.fontFamily,
    translationFontFamily: state.translationFontFamily,
  };
  const known = layoutMemo.get(card);
  if (known && sameKey(known.key, key)) return known.layout;
  const measure = state.measureContext;
  const layout = layoutCard({
    width,
    height,
    layout: key.layout,
    styles: prefs.styles,
    refLabel: card.card.refLabel,
    parts: layoutArabicWords(card.card.arabic).parts,
    translation: card.card.translation,
    attribution: card.card.attribution,
    showRef: prefs.showRef,
    showWave: prefs.showWave,
    measureArabic: (text, size) => {
      measure.font = `${size}px ${state.fontFamily}`;
      return measure.measureText(text).width;
    },
    measureTranslation: (text, size) => {
      measure.font = `${size}px ${state.translationFontFamily}`;
      return measure.measureText(text).width;
    },
    measureRef: (text, size) => {
      measure.font = `600 ${size}px ${state.translationFontFamily}`;
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
  const { width, height, t, duration, peaks, prefs } = state;
  const scale = sizeScale(width, height);
  ctx.clearRect(0, 0, width, height);

  // Fond.
  const bg = state.background;
  // Le décor que les fonds « flou » doivent flouter : l'image ou la vidéo (un dégradé ou une couleur
  // unie se passent de flou : le flou d'un décor lisse est le décor).
  let backdrop: Backdrop | undefined;
  if (bg.image) {
    const { dest, size } = coverRect(bg.image, width, height);
    ctx.drawImage(bg.image, dest.x, dest.y, dest.width, dest.height);
    backdrop = {
      source: bg.image,
      dest,
      size,
      live: isLiveSource(bg.image),
    };
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
    const { ref, arabic, translation } = layout;
    const styles = prefs.styles;

    // Les fonds d'abord, puis les textes par-dessus.
    const deps = { ...state.panelDeps, backdrop };
    if (ref) paintPanel(ctx, ref.panel, styles.ref.panel, scale, deps);
    if (arabic) paintPanel(ctx, arabic.panel, styles.arabic.panel, scale, deps);
    if (translation)
      paintPanel(ctx, translation.panel, styles.translation.panel, scale, deps);

    ctx.direction = "ltr";
    ctx.textBaseline = "middle";

    if (ref) {
      ctx.textAlign = "center";
      ctx.font = `600 ${ref.size}px ${state.translationFontFamily}`;
      drawLegibleText(
        ctx,
        ref.text,
        ref.centerX,
        ref.y,
        styles.ref.panel,
        ref.size,
        scale,
        state.colors.accent,
      );
    }

    if (arabic) {
      const current = active.live
        ? currentWordIndex(active.live.times, t)
        : null;
      ctx.font = `${arabic.size}px ${state.fontFamily}`;
      ctx.textAlign = "left";
      for (const line of arabic.lines) {
        for (const part of line.parts) {
          drawLegibleText(
            ctx,
            part.text,
            part.x,
            line.y,
            styles.arabic.panel,
            arabic.size,
            scale,
            part.word !== null && part.word === current
              ? state.colors.accent
              : state.colors.text,
          );
        }
      }
    }

    if (translation) {
      ctx.textAlign = "center";
      ctx.font = `${translation.size}px ${state.translationFontFamily}`;
      for (const line of translation.lines)
        drawLegibleText(
          ctx,
          line.text,
          translation.centerX,
          line.y,
          styles.translation.panel,
          translation.size,
          scale,
          state.colors.text,
        );
      const attribution = translation.attribution;
      if (attribution) {
        ctx.font = `${attribution.size}px ${state.translationFontFamily}`;
        attribution.lines.forEach((text, index) =>
          drawLegibleText(
            ctx,
            text,
            translation.centerX,
            attribution.y + index * attribution.lineHeight,
            styles.translation.panel,
            attribution.size,
            scale,
            state.colors.text,
          ),
        );
      }
    }
  }

  // Onde : comme la timeline de l'atelier, une fenêtre qui défile avec la tête de lecture,
  // barres jouées en clair, à venir en sombre, tête de lecture en accent.
  if (!prefs.showWave) return;
  const zone = waveRectOf(layoutFor(prefs, width, height), width, height);
  if (state.scrim) paintWaveScrim(ctx, zone);
  const geometry = waveBarGeometry(zone, scale);
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
      geometry.zoneX +
      i * geometry.pitch +
      (geometry.pitch - geometry.barWidth * scale) / 2;
    ctx.fillStyle = i < played ? state.colors.wavePlayed : state.colors.wave;
    ctx.beginPath();
    ctx.roundRect(x, middle - bar / 2, geometry.barWidth * scale, bar, 1.3);
    ctx.fill();
  }
  const playheadX =
    windowSec > 0
      ? geometry.zoneX + ((t - t0) / windowSec) * geometry.zoneW
      : 0;
  ctx.fillStyle = state.colors.accent;
  ctx.fillRect(
    playheadX - scale,
    geometry.zoneY + 4 * scale,
    2 * scale,
    geometry.zoneH - 8 * scale,
  );
}
