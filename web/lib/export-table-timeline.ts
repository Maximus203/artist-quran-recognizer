/**
 * La chronologie de la table de montage, sans DOM : temps ↔ pixels sur une piste qui peut être plus large que
 * l'écran (elle défile alors toute seule), zoom, règle, tête de lecture (clavier, bornes), blocs des passages et
 * piste « Fond ». Le composant ne fait que lire les gestes et dessiner ce que ces fonctions décident.
 *
 * L'axe est celui de TOUT l'audio de la session (secondes), comme la frise des passages : chaque plage exportée
 * est une vidéo, et la vidéo de fond recommence ou glisse sous CHAQUE plage depuis son propre début. Tout ce qui
 * relève de la vidéo de fond (boucle, raccords, portion) vient de `export-video-vtime.ts` et
 * `background-video-view.ts` : rien n'est recalculé ici.
 */
import { filmView, nudgeOffset, type FilmView } from "./background-video-view";
import { findBackground } from "./export-video-backgrounds";
import type { BackgroundVideoMode } from "./export-video-model";
import { rulerStep, formatTick, round3 } from "./export-timeline";
import {
  clampBackgroundOffset,
  describeFit,
  type FitDescription,
  type FitInput,
} from "./export-video-vtime";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

// ── zoom et conversions ─────────────────────────────────────────────────────────────────────────

/** Au-delà, une seconde occupe trop de place : on n'agrandit plus (pixels par seconde). */
export const MAX_PX_PER_SECOND = 90;

/** La piste ne dépasse jamais cette largeur : un canevas n'est pas fait pour des dizaines de milliers de pixels. */
export const MAX_TRACK_PX = 8000;

/** Les niveaux de zoom : 1 = tout l'audio dans la largeur de l'écran, puis le double, le quadruple… */
export function zoomLevels(viewport: number, duration: number): number[] {
  const levels = [1];
  if (!(viewport > 0) || !(duration > 0)) return levels;
  for (
    let zoom = 2;
    (viewport * zoom) / duration <= MAX_PX_PER_SECOND &&
    viewport * zoom <= MAX_TRACK_PX;
    zoom *= 2
  )
    levels.push(zoom);
  return levels;
}

/** Le niveau voisin ; un niveau qui n'existe plus (écran redimensionné) repart du plus proche. */
export function stepZoom(
  current: number,
  direction: 1 | -1,
  levels: readonly number[],
): number {
  let nearest = 0;
  for (let i = 1; i < levels.length; i++)
    if (Math.abs(levels[i] - current) < Math.abs(levels[nearest] - current))
      nearest = i;
  return levels[clamp(nearest + direction, 0, levels.length - 1)];
}

/** La largeur de la piste à ce zoom : jamais plus étroite que l'écran. */
export const trackWidth = (viewport: number, zoom: number): number =>
  Math.max(viewport, viewport * zoom);

export function timeToPx(t: number, duration: number, width: number): number {
  return duration > 0 ? (t / duration) * width : 0;
}

/** L'instant sous un pixel de la piste, borné à [0, durée]. */
export function pxToTime(x: number, duration: number, width: number): number {
  return width > 0 ? clamp((x / width) * duration, 0, duration) : 0;
}

/** Le défilement minimal qui garde le pixel `x` à `margin` px du bord de l'écran. */
export function scrollToReveal(
  scrollLeft: number,
  viewport: number,
  x: number,
  margin: number,
): number {
  if (x - margin < scrollLeft) return Math.max(0, x - margin);
  if (x + margin > scrollLeft + viewport) return x + margin - viewport;
  return scrollLeft;
}

/** Après un zoom, l'instant `anchor` reste au même endroit de l'écran (borné à la nouvelle piste). */
export function scrollAfterZoom(input: {
  scrollLeft: number;
  viewport: number;
  oldWidth: number;
  newWidth: number;
  anchor: number;
  duration: number;
}): number {
  const { scrollLeft, viewport, oldWidth, newWidth, anchor, duration } = input;
  const onScreen = clamp(
    timeToPx(anchor, duration, oldWidth) - scrollLeft,
    0,
    viewport,
  );
  const left = timeToPx(anchor, duration, newWidth) - onScreen;
  return clamp(left, 0, Math.max(0, newWidth - viewport));
}

// ── règle ───────────────────────────────────────────────────────────────────────────────────────

export type RulerMark = {
  t: number;
  /** Repère principal (porte l'étiquette) ou petit repère. */
  major: boolean;
  label: string;
};

/** Combien de petits intervalles entre deux repères principaux, selon le pas. */
const SUBDIVISIONS: Record<number, number> = {
  0.5: 1,
  1: 2,
  2: 2,
  5: 5,
  10: 5,
  15: 3,
  30: 3,
  60: 4,
  120: 4,
  300: 5,
  600: 5,
  1200: 4,
  1800: 3,
  3600: 4,
};
/** Un petit repère plus serré que cela serait une bouillie. */
const MIN_MINOR_PX = 7;

/** Les repères de la règle : un repère principal au moins tous les `targetPx` pixels, des petits entre. */
export function rulerMarks(
  duration: number,
  width: number,
  targetPx: number,
): RulerMark[] {
  if (!(duration > 0) || !(width > 0)) return [];
  const step = rulerStep(duration, width, targetPx);
  const wanted = SUBDIVISIONS[step] ?? 1;
  const minorPx = timeToPx(step / wanted, duration, width);
  const divisions = minorPx >= MIN_MINOR_PX ? wanted : 1;
  const unit = step / divisions;
  const marks: RulerMark[] = [];
  for (let k = 0; ; k++) {
    const t = round3(k * unit);
    if (t > duration + 1e-9) break;
    const major = k % divisions === 0;
    marks.push({ t, major, label: major ? formatTick(t) : "" });
  }
  return marks;
}

// ── tête de lecture ─────────────────────────────────────────────────────────────────────────────

export type PlayheadKey =
  | { delta: number }
  | { to: "start" | "end" }
  | { jump: -1 | 1 };

/**
 * Touche sur la tête de lecture : flèches 0,1 s (Maj : 1 s), Page haut / bas 5 s, Début et Fin, [ et ] vers le
 * passage voisin. `null` pour toute autre touche : elle garde son sens (Tab surtout).
 */
export function playheadKey(key: string, shift: boolean): PlayheadKey | null {
  const small = shift ? 1 : 0.1;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return { delta: small };
    case "ArrowLeft":
    case "ArrowDown":
      return { delta: -small };
    case "PageUp":
      return { delta: 5 };
    case "PageDown":
      return { delta: -5 };
    case "Home":
      return { to: "start" };
    case "End":
      return { to: "end" };
    case "[":
      return { jump: -1 };
    case "]":
      return { jump: 1 };
    default:
      return null;
  }
}

/** La tête de lecture déplacée de `delta` secondes, au dixième, dans [0, durée]. */
export function movePlayhead(
  t: number,
  delta: number,
  duration: number,
): number {
  const from = Number.isFinite(t) ? t : 0;
  const by = Number.isFinite(delta) ? delta : 0;
  return clamp(Math.round((from + by) * 10) / 10, 0, Math.max(0, duration));
}

// ── passages ────────────────────────────────────────────────────────────────────────────────────

export type PassageBlock = {
  /** Place parmi les passages (à partir de 0). */
  index: number;
  /** Ce que porte le bloc : le numéro du verset, sinon la place du passage. */
  label: string;
  start: number;
  end: number;
  status: "recognized" | "inferred" | "uncertain";
  /** Dans une plage exportée : sinon il se voit éteint (hors de la vidéo). */
  included: boolean;
};

type TimedInterval = {
  kind: string;
  ref?: string | null;
  t?: readonly [number, number] | null;
  status?: string;
};

const STATUSES = ["recognized", "inferred", "uncertain"] as const;

/** Les blocs de la piste « Passages » : un par passage coranique daté, en disant s'il est exporté. */
export function passageBlocks(
  intervals: readonly TimedInterval[],
  ranges: ReadonlyArray<{ start: number; end: number }>,
): PassageBlock[] {
  const blocks: PassageBlock[] = [];
  for (const item of intervals) {
    if (item.kind !== "verse" || !item.t) continue;
    const [start, end] = item.t;
    const verse = item.ref?.split(":")[1];
    const status = STATUSES.find((s) => s === item.status) ?? "recognized";
    blocks.push({
      index: blocks.length,
      label: verse ?? String(blocks.length + 1),
      start,
      end,
      status,
      included: ranges.some((r) => end > r.start && start < r.end),
    });
  }
  return blocks;
}

// ── piste « Fond » ──────────────────────────────────────────────────────────────────────────────

export type FilmSegment = {
  id: number;
  start: number;
  end: number;
  /** La situation en clair, pour CETTE plage (plus courte, plus longue, même durée…). */
  fit: FitDescription;
  /** Répétitions et raccords (vidéo plus courte), en pourcentages de la plage. */
  film: FilmView;
  /**
   * Vidéo plus longue : la portion gardée (secondes DE LA VIDÉO) et l'instant de l'axe où sa première image
   * tomberait (négatif quand la plage commence avant : c'est la partie de la bande qu'on ne voit pas).
   */
  portion: { from: number; to: number; filmStart: number } | null;
};

export type FilmClip = {
  duration: number;
  offset: number;
  mode: BackgroundVideoMode;
};

/** Ce que la vidéo de fond fait sous chaque plage exportée. */
export function filmSegments(
  ranges: ReadonlyArray<{ id: number; start: number; end: number }>,
  clip: FilmClip,
): FilmSegment[] {
  return ranges.map((range) => {
    const input: FitInput = {
      videoDuration: clip.duration,
      audioDuration: range.end - range.start,
      offset: clip.offset,
      mode: clip.mode,
    };
    const fit = describeFit(input);
    let portion: FilmSegment["portion"] = null;
    if (fit.situation === "longer") {
      const from = clampBackgroundOffset(
        clip.offset,
        clip.duration,
        input.audioDuration,
      );
      portion = {
        from,
        to: from + input.audioDuration,
        filmStart: range.start - from,
      };
    }
    return {
      id: range.id,
      start: range.start,
      end: range.end,
      fit,
      film: filmView(input),
      portion,
    };
  });
}

/** Ce que la piste « Fond » dessine pour une image, un dégradé ou une couleur (style en ligne, jamais une valeur fixe). */
export type StillStyle = {
  backgroundImage?: string;
  backgroundColor?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
};

/**
 * Le fond choisi, vu sur la piste : la vignette de la photo, les deux couleurs du dégradé, la couleur unie, ma
 * propre image. `null` pour la vidéo d'origine (on ne la dessine pas ici) ou un identifiant inconnu.
 */
export function stillTrackStyle(
  id: string,
  color: string,
  uploadThumb: string | null,
): StillStyle | null {
  const cover = { backgroundSize: "cover", backgroundPosition: "center" };
  if (id === "upload")
    return uploadThumb
      ? { backgroundImage: `url("${uploadThumb}")`, ...cover }
      : null;
  if (id === "color") return { backgroundColor: color };
  const preset = findBackground(id);
  if (!preset) return null;
  return preset.kind === "photo"
    ? { backgroundImage: `url(${preset.thumb})`, ...cover }
    : {
        backgroundImage: `linear-gradient(90deg, ${preset.from}, ${preset.to})`,
      };
}

const frNumber = (value: number): string => String(value).replace(".", ",");

/** Ce que la vidéo fait sous une plage, en quelques mots, pour la pastille de la piste « Fond ». */
export function filmPill(
  segment: Pick<FilmSegment, "fit" | "start" | "end">,
  clip: Pick<FilmClip, "duration" | "mode">,
): string {
  const { situation, repeats } = segment.fit;
  if (situation === "unknown") return "durée inconnue";
  if (situation === "same") return "même durée";
  if (situation === "longer") return "glisse pour choisir la partie";
  switch (clip.mode) {
    case "pingpong":
      return `aller-retour ×${frNumber(repeats ?? 1)}`;
    case "freeze":
      return "puis image figée";
    case "slow": {
      const length = segment.end - segment.start;
      return `ralentie à ${Math.round((clip.duration / length) * 100)} %`;
    }
    default:
      return `en boucle ×${frNumber(repeats ?? 1)}`;
  }
}

/**
 * Glisser le film sous la récitation : il suit le doigt, donc glisser vers la droite fait RECULER le départ.
 * `pxPerSecond` est l'échelle de la piste ; borné et arrondi au dixième comme tous les départs.
 */
export function offsetFromFilmDrag(
  startOffset: number,
  dxPx: number,
  pxPerSecond: number,
  span: Pick<FitInput, "videoDuration" | "audioDuration">,
): number {
  if (!(pxPerSecond > 0)) return startOffset;
  return nudgeOffset(startOffset, -dxPx / pxPerSecond, span);
}
