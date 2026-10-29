/**
 * Géométrie et gestes de la frise d'export (sélecteur de plage), sans DOM : conversion temps ↔
 * pixels, vue (loupe) bornée, zoom autour d'un point, pincement, aimant, bords d'une plage et
 * traduction des touches. Le composant `RangeTimeline` reste mince : il lit des évènements et
 * appelle ces fonctions, testées ici une fois pour toutes.
 */
import { EXPORT_VIDEO_CONFIG } from "./export-video-config";
import {
  MIN_RANGE_SECONDS,
  parseTimeInput,
  type ExportRange,
} from "./export-video-ranges";

export type View = { a: number; b: number };
export type Edge = "start" | "end";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
export const round3 = (value: number): number =>
  Math.round(value * 1000) / 1000;

export function timeToX(t: number, view: View, width: number): number {
  return ((t - view.a) / (view.b - view.a)) * width;
}

export function xToTime(x: number, view: View, width: number): number {
  return view.a + (x / Math.max(1, width)) * (view.b - view.a);
}

/** Vue d'au moins `minSpan` secondes (ou toute la durée si l'audio est plus court), dans [0, durée]. */
export function clampView(
  a: number,
  b: number,
  duration: number,
  minSpan: number,
): View {
  const span = clamp(b - a, Math.min(minSpan, duration), duration);
  const start = clamp(a, 0, duration - span);
  return { a: start, b: start + span };
}

/** Zoom de facteur `factor` (< 1 = rapprocher) en gardant `at` au même endroit de l'écran. */
export function zoomView(
  view: View,
  factor: number,
  at: number,
  duration: number,
  minSpan: number,
): View {
  const span = view.b - view.a;
  const next = clamp(span * factor, Math.min(minSpan, duration), duration);
  const k = (at - view.a) / span;
  return clampView(at - k * next, at - k * next + next, duration, minSpan);
}

export function panView(view: View, dt: number, duration: number): View {
  const span = view.b - view.a;
  const a = clamp(view.a + dt, 0, duration - span);
  return { a, b: a + span };
}

/** Pincement : l'écart des doigts passe de `startDistance` à `distance`, autour de `mid` (s). */
export function pinchView(
  start: View,
  startDistance: number,
  distance: number,
  mid: number,
  duration: number,
  minSpan: number,
): View {
  return zoomView(
    start,
    Math.max(1, startDistance) / Math.max(1, distance),
    mid,
    duration,
    minSpan,
  );
}

/** Cadre une plage avec de l'air autour : 25 % de sa durée, 4 s au moins. */
export function fitView(
  range: ExportRange,
  duration: number,
  minSpan: number,
): View {
  const pad = Math.max(4, (range.end - range.start) * 0.25);
  return clampView(range.start - pad, range.end + pad, duration, minSpan);
}

/** Pas de la règle : le premier pas qui laisse au moins `targetPx` entre deux repères. */
export function rulerStep(
  span: number,
  width: number,
  targetPx: number,
  steps: readonly number[] = EXPORT_VIDEO_CONFIG.timeline.rulerSteps,
): number {
  const target = (span / Math.max(1, width)) * targetPx;
  return steps.find((s) => s >= target) ?? steps[steps.length - 1];
}

/** « 13:00,8 » : minutes:secondes,dixième (toujours un dixième, pour les temps de plage). */
export function formatClock(value: number): string {
  const whole = Math.floor(value + 1e-6);
  let tenths = Math.round((value - whole) * 10);
  const total = whole + (tenths === 10 ? 1 : 0);
  tenths %= 10;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const base =
    h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  return `${base},${tenths}`;
}

/** Repère de la règle : sans « ,0 ». */
export const formatTick = (value: number): string =>
  formatClock(value).replace(/,0$/, "");

/** « 13 min 0,8 s » : dit par le lecteur d'écran (aria-valuetext, annonces). */
export function spokenTime(value: number): string {
  const tenths = Math.round(value * 10) / 10;
  const h = Math.floor(tenths / 3600);
  const m = Math.floor((tenths % 3600) / 60);
  const s = (tenths - h * 3600 - m * 60).toFixed(1).replace(".", ",");
  if (h) return `${h} h ${m} min ${s} s`;
  return m ? `${m} min ${s} s` : `${s} s`;
}

/** Un bord déplacé : la plage garde 0,5 s au moins et reste dans l'audio. */
export function setEdge(
  range: ExportRange,
  edge: Edge,
  value: number,
  duration: number,
  minLength: number = MIN_RANGE_SECONDS,
): ExportRange {
  if (edge === "start")
    return {
      start: round3(clamp(value, 0, range.end - minLength)),
      end: range.end,
    };
  return {
    start: range.start,
    end: round3(clamp(value, range.start + minLength, duration)),
  };
}

/** La plage entière glissée de `dt` secondes, sans changer sa durée. */
export function moveRange(
  range: ExportRange,
  dt: number,
  duration: number,
): ExportRange {
  const length = range.end - range.start;
  const start = round3(clamp(range.start + dt, 0, duration - length));
  return { start, end: round3(start + length) };
}

/** Repère le plus proche à moins de `px` pixels de `value`, sinon null. */
export function snapToTarget(
  value: number,
  targets: readonly number[],
  view: View,
  width: number,
  px: number,
): number | null {
  const x = timeToX(value, view, width);
  let best: number | null = null;
  let bestDistance = px;
  for (const target of targets) {
    const distance = Math.abs(timeToX(target, view, width) - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = target;
    }
  }
  return best;
}

/** Repère strictement avant (−1) ou après (+1) `current` (à 50 ms près). */
export function neighbourTarget(
  targets: readonly number[],
  current: number,
  direction: -1 | 1,
): number | null {
  const sorted = [...targets].sort((a, b) => a - b);
  if (direction > 0) return sorted.find((t) => t > current + 0.05) ?? null;
  return [...sorted].reverse().find((t) => t < current - 0.05) ?? null;
}

export type KeyAction =
  | { kind: "delta"; seconds: number }
  | { kind: "jump"; direction: -1 | 1 }
  | { kind: "play" }
  | { kind: "remove" };

/** Touche sur une poignée → action (null : la touche suit son cours, Tab notamment). */
export function keyAction(
  key: string,
  mods: { shift: boolean; alt: boolean },
  keys = EXPORT_VIDEO_CONFIG.keyboard,
): KeyAction | null {
  const step = mods.shift
    ? keys.shiftStep
    : mods.alt
      ? keys.altStep
      : keys.step;
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return { kind: "delta", seconds: -step };
    case "ArrowRight":
    case "ArrowUp":
      return { kind: "delta", seconds: step };
    case "PageDown":
      return { kind: "delta", seconds: -keys.pageStep };
    case "PageUp":
      return { kind: "delta", seconds: keys.pageStep };
    case "[":
      return { kind: "jump", direction: -1 };
    case "]":
      return { kind: "jump", direction: 1 };
    case " ":
      return { kind: "play" };
    case "Delete":
    case "Backspace":
      return { kind: "remove" };
    default:
      return null;
  }
}

export type EdgeInput =
  | { ok: true; value: number }
  | { ok: false; error: string };

/**
 * Saisie précise d'un bord (« 3:12,4 », « 12 s ») : messages en clair. Le temps affiché est arrondi
 * au dixième ; écrire la durée telle qu'elle s'affiche (« 0:41,5 » pour 41,459 s) est accepté et
 * ramené à la durée exacte.
 */
export function parseEdgeInput(
  text: string,
  edge: Edge,
  range: ExportRange,
  duration: number,
  minLength: number = MIN_RANGE_SECONDS,
): EdgeInput {
  const value = parseTimeInput(text.replace(/\s*s$/, ""));
  if (value === null)
    return {
      ok: false,
      error: "Écris le temps comme 3:12,4 (minutes:secondes,dixièmes).",
    };
  if (value > duration + 0.05)
    return {
      ok: false,
      error: `L’audio s’arrête à ${formatClock(duration)}.`,
    };
  const exact = Math.min(value, duration);
  if (
    (edge === "start" && exact > range.end - minLength) ||
    (edge === "end" && exact < range.start + minLength)
  )
    return {
      ok: false,
      error: `La fin doit venir au moins ${String(minLength).replace(".", ",")} s après le début.`,
    };
  return { ok: true, value: exact };
}
