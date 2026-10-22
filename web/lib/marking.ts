/**
 * Délimiter un passage à signaler : règles pures du bouton début → fin, du tracé sur la forme d'onde
 * et des poignées. Tout se calcule au dixième de seconde (le pas de la revue humaine).
 */

/** Une plage dure au moins 0,2 s (sinon c'est un point). */
export const MIN_RANGE_S = 0.2;
/** Pas des boutons − / + et des flèches du clavier. */
export const STEP_S = 0.1;
/** Un point s'écoute ± 2 s autour de lui. */
export const POINT_WINDOW_S = 2;
/** Glissement minimal (px) pour que le tracé soit une plage et pas un simple toucher. */
export const TRACE_MIN_PX = 6;
const EPSILON = 1e-9;

export const roundTenth = (seconds: number): number =>
  Math.round(seconds * 10) / 10;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

export type MarkPress =
  | { kind: "start"; start: number }
  | { kind: "too_short" }
  | { kind: "range"; start: number; end: number };

/**
 * Appui sur le bouton unique : le premier pose le début à la position de lecture, le second la fin.
 * `markStart` est le début déjà posé (null au repos).
 */
export function pressMark(
  markStart: number | null,
  position: number,
): MarkPress {
  if (markStart === null) return { kind: "start", start: roundTenth(position) };
  const end = roundTenth(position);
  if (end - markStart < MIN_RANGE_S - EPSILON) return { kind: "too_short" };
  return { kind: "range", start: markStart, end };
}

export type Selection =
  | { mode: "point"; start: number }
  | { mode: "range"; start: number; end: number };

/** Geste sur l'onde : glisser = plage (dans les deux sens), toucher ou glissement trop court = point. */
export function traceToSelection(gesture: {
  t0: number;
  t1: number;
  dxPx: number;
}): Selection {
  const low = Math.min(gesture.t0, gesture.t1);
  const high = Math.max(gesture.t0, gesture.t1);
  const start = roundTenth(low);
  const end = roundTenth(high);
  const moved = Math.abs(gesture.dxPx) > TRACE_MIN_PX;
  if (
    !moved ||
    high - low < MIN_RANGE_S - EPSILON ||
    end - start < MIN_RANGE_S - EPSILON
  )
    return { mode: "point", start: roundTenth(gesture.t0) };
  return { mode: "range", start, end };
}

export type Bounds = { start: number; end: number | null };

/** Déplace un bord vers `target` : jamais hors du fichier, jamais une plage de moins de 0,2 s. */
export function moveEdge(
  bounds: Bounds,
  edge: "start" | "end",
  target: number,
  duration: number,
): Bounds {
  const top = duration > 0 ? duration : Number.POSITIVE_INFINITY;
  if (bounds.end === null)
    return edge === "start"
      ? { start: clamp(roundTenth(target), 0, top), end: null }
      : bounds;
  if (edge === "start")
    return {
      start: clamp(
        roundTenth(target),
        0,
        Math.max(0, roundTenth(bounds.end - MIN_RANGE_S)),
      ),
      end: bounds.end,
    };
  return {
    start: bounds.start,
    end: clamp(roundTenth(target), roundTenth(bounds.start + MIN_RANGE_S), top),
  };
}

/** Avance ou recule un bord d'un pas (boutons − / +, flèches, Maj + flèche = 1 s). */
export function nudgeEdge(
  bounds: Bounds,
  edge: "start" | "end",
  delta: number,
  duration: number,
): Bounds {
  const current = edge === "start" ? bounds.start : bounds.end;
  return current === null
    ? bounds
    : moveEdge(bounds, edge, current + delta, duration);
}

/** Fenêtre d'écoute : la plage elle-même, ou ± 2 s autour d'un point. */
export function listenWindow(
  bounds: Bounds,
  duration: number,
): [number, number] {
  if (bounds.end !== null) return [bounds.start, bounds.end];
  const top = duration > 0 ? duration : bounds.start + POINT_WINDOW_S;
  return [
    roundTenth(Math.max(0, bounds.start - POINT_WINDOW_S)),
    roundTenth(Math.min(top, bounds.start + POINT_WINDOW_S)),
  ];
}
