/**
 * Calculs d'aide à l'édition de la mise en page d'export : fonctions PURES (aucun DOM), partagées par
 * les trois éditeurs (plateau, table de montage, pas à pas) et par la vue bureau. Chaque geste de
 * l'interface (glisser, poignées, clavier, boutons − / +, pincement) passe ICI, pour qu'un geste
 * donne le même résultat partout et se teste à froid.
 *
 * Toutes les boîtes sont des fractions du cadre (0–1), voir `export-video-model.ts`.
 */
import {
  BLOCK_IDS,
  MIN_BOX,
  SIZE_LIMITS,
  SIZE_STEP_RATIO,
  type BlockId,
  type Box,
  type ExportLayout,
} from "./export-video-model";

// ── constantes ──────────────────────────────────────────────────────────────

/** Marge sur laquelle les boîtes s'aimantent (fraction du cadre) : celle du texte par défaut. */
export const SNAP_MARGIN = 0.05;
/** Un appui sur une flèche déplace de 1 %, avec Maj de 5 %. */
export const NUDGE_STEP = 0.01;
export const NUDGE_STEP_BIG = 0.05;
/** Aimant par défaut, en pixels d'écran : se convertit en fraction avec `snapThreshold`. */
export const SNAP_PX = 10;

export type Guide = {
  /** `x` : trait vertical à la fraction `at` de la largeur ; `y` : trait horizontal. */
  axis: "x" | "y";
  at: number;
  /** `center` : milieu du cadre ; `margin` : marge. */
  kind: "center" | "margin";
};

export type SnapOptions = {
  /** Seuil de l'aimant en fraction du cadre ; 0 (ou moins) = aimant coupé. */
  snap?: number;
  /** Marge visée (défaut `SNAP_MARGIN`). */
  margin?: number;
};

export type EditResult = { box: Box; guides: Guide[] };

const finite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
/** Arrondi au millionième : écarte les restes de calcul flottant (0,30000000000000004). */
const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

// ── boîtes ──────────────────────────────────────────────────────────────────

/** Ramène une boîte dans le cadre, à la taille minimale au moins ; ne déforme pas une boîte valide. */
export function clampBox(box: Box): Box {
  const w = clamp(finite(box.w, MIN_BOX.w), MIN_BOX.w, 1);
  const h = clamp(finite(box.h, MIN_BOX.h), MIN_BOX.h, 1);
  return {
    x: round6(clamp(finite(box.x, 0), 0, 1 - w)),
    y: round6(clamp(finite(box.y, 0), 0, 1 - h)),
    w: round6(w),
    h: round6(h),
  };
}

type Target = { at: number; kind: Guide["kind"] };
type Snap = { offset: number; target: Target };

const marginAt = (at: number): Target => ({ at, kind: "margin" });
const CENTER: Target = { at: 0.5, kind: "center" };

/**
 * Le repère le plus proche parmi des couples (position actuelle → repère visé). Renvoie le décalage à
 * appliquer et le repère, ou null si rien n'est à portée du seuil.
 */
function nearestSnap(
  pairs: { value: number; target: Target }[],
  threshold: number,
): Snap | null {
  if (!(threshold > 0)) return null;
  let best: Snap | null = null;
  for (const { value, target } of pairs) {
    const offset = target.at - value;
    if (
      Math.abs(offset) <= threshold &&
      (!best || Math.abs(offset) < Math.abs(best.offset) - 1e-12)
    )
      best = { offset, target };
  }
  return best;
}

/** Aimant d'un déplacement sur un axe : bord d'attaque → marge, bord de fuite → marge, milieu → centre. */
function snapMove(
  start: number,
  size: number,
  threshold: number,
  margin: number,
): Snap | null {
  return nearestSnap(
    [
      { value: start, target: marginAt(margin) },
      { value: start + size, target: marginAt(1 - margin) },
      { value: start + size / 2, target: CENTER },
    ],
    threshold,
  );
}

/**
 * Déplace une boîte de `delta` (fractions), avec aimant sur le centre et les marges du cadre.
 * Renvoie la nouvelle boîte (toujours dans le cadre, taille inchangée) et les repères à afficher.
 */
export function moveBox(
  box: Box,
  delta: { dx: number; dy: number },
  options: SnapOptions = {},
): EditResult {
  const margin = options.margin ?? SNAP_MARGIN;
  const threshold = options.snap ?? 0;
  let next = clampBox({
    ...box,
    x: box.x + finite(delta.dx, 0),
    y: box.y + finite(delta.dy, 0),
  });
  const guides: Guide[] = [];
  const sx = snapMove(next.x, next.w, threshold, margin);
  if (sx) {
    next = clampBox({ ...next, x: next.x + sx.offset });
    guides.push({ axis: "x", at: sx.target.at, kind: sx.target.kind });
  }
  const sy = snapMove(next.y, next.h, threshold, margin);
  if (sy) {
    next = clampBox({ ...next, y: next.y + sy.offset });
    guides.push({ axis: "y", at: sy.target.at, kind: sy.target.kind });
  }
  return { box: next, guides };
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * Redimensionne une boîte en tirant une poignée (coins et milieux des côtés) de `delta` : le côté
 * opposé reste en place. Taille minimale et cadre respectés ; la boîte ne se retourne jamais. Le bord
 * déplacé s'aimante sur le centre et les marges.
 */
export function resizeBox(
  box: Box,
  handle: Handle,
  delta: { dx: number; dy: number },
  options: SnapOptions = {},
): EditResult {
  const margin = options.margin ?? SNAP_MARGIN;
  const threshold = options.snap ?? 0;
  const dx = finite(delta.dx, 0);
  const dy = finite(delta.dy, 0);
  let left = box.x;
  let right = box.x + box.w;
  let top = box.y;
  let bottom = box.y + box.h;
  const guides: Guide[] = [];

  /** Un bord déplacé : borné au cadre, aimanté sur une marge ou le centre. */
  const moveEdge = (value: number, axis: "x" | "y"): number => {
    const v = clamp(value, 0, 1);
    const hit = nearestSnap(
      [marginAt(margin), CENTER, marginAt(1 - margin)].map((target) => ({
        value: v,
        target,
      })),
      threshold,
    );
    if (!hit) return v;
    guides.push({ axis, at: hit.target.at, kind: hit.target.kind });
    return v + hit.offset;
  };

  if (handle.includes("w")) left = moveEdge(left + dx, "x");
  if (handle.includes("e")) right = moveEdge(right + dx, "x");
  if (handle.includes("n")) top = moveEdge(top + dy, "y");
  if (handle.includes("s")) bottom = moveEdge(bottom + dy, "y");

  // Taille minimale : l'arête qu'on tire s'arrête, l'autre ne bouge pas (pas de retournement).
  if (right - left < MIN_BOX.w) {
    if (handle.includes("w")) left = right - MIN_BOX.w;
    else right = left + MIN_BOX.w;
  }
  if (bottom - top < MIN_BOX.h) {
    if (handle.includes("n")) top = bottom - MIN_BOX.h;
    else bottom = top + MIN_BOX.h;
  }
  return {
    box: clampBox({ x: left, y: top, w: right - left, h: bottom - top }),
    guides,
  };
}

/**
 * Clavier : une flèche déplace de 1 % (Maj : 5 %) ; Ctrl + flèche change la zone (largeur avec ← →,
 * hauteur avec ↑ ↓, le coin haut-gauche reste en place). Renvoie `null` si la touche n'est pas une flèche.
 */
export function nudgeBox(
  box: Box,
  key: string,
  modifiers: { shift?: boolean; ctrl?: boolean },
): Box | null {
  const step = modifiers.shift ? NUDGE_STEP_BIG : NUDGE_STEP;
  const direction = (
    {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    } as Record<string, [number, number] | undefined>
  )[key];
  if (!direction) return null;
  const [sx, sy] = direction;
  if (modifiers.ctrl)
    return {
      ...box,
      w: round6(clamp(box.w + sx * step, MIN_BOX.w, 1 - box.x)),
      h: round6(clamp(box.h + sy * step, MIN_BOX.h, 1 - box.y)),
    };
  return clampBox({ ...box, x: box.x + sx * step, y: box.y + sy * step });
}

/** Seuil d'aimant (fraction du cadre) pour un nombre de pixels d'écran ; 0 si le cadre n'a pas de taille. */
export function snapThreshold(px: number, framePx: number): number {
  return framePx > 0 ? px / framePx : 0;
}

// ── pixels d'écran ↔ fractions ──────────────────────────────────────────────

/** Rectangle du cadre à l'écran (comme `getBoundingClientRect`). */
export type FrameRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export type PxRect = { x: number; y: number; width: number; height: number };

/** Un point de l'écran en fractions du cadre (borné à 0–1). */
export function pointToFraction(
  point: { x: number; y: number },
  frame: FrameRect,
): { x: number; y: number } {
  if (!(frame.width > 0) || !(frame.height > 0)) return { x: 0, y: 0 };
  return {
    x: clamp((point.x - frame.left) / frame.width, 0, 1),
    y: clamp((point.y - frame.top) / frame.height, 0, 1),
  };
}

/** Un déplacement en pixels d'écran en fractions du cadre (non borné). */
export function deltaToFraction(
  delta: { dx: number; dy: number },
  frame: FrameRect,
): { dx: number; dy: number } {
  if (!(frame.width > 0) || !(frame.height > 0)) return { dx: 0, dy: 0 };
  return { dx: delta.dx / frame.width, dy: delta.dy / frame.height };
}

/** Boîte en fractions → rectangle en pixels du cadre `{ width, height }`. */
export function boxToPx(
  box: Box,
  frame: { width: number; height: number },
): PxRect {
  return {
    x: box.x * frame.width,
    y: box.y * frame.height,
    width: box.w * frame.width,
    height: box.h * frame.height,
  };
}

/** Rectangle en pixels → boîte en fractions, ramenée dans le cadre. */
export function pxToBox(
  rect: PxRect,
  frame: { width: number; height: number },
): Box {
  if (!(frame.width > 0) || !(frame.height > 0))
    return clampBox({ x: 0, y: 0, w: 0, h: 0 });
  return clampBox({
    x: rect.x / frame.width,
    y: rect.y / frame.height,
    w: rect.width / frame.width,
    h: rect.height / frame.height,
  });
}

// ── taille du texte ─────────────────────────────────────────────────────────

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Un pas de « + » (`1`) ou de « − » (`-1`) : la taille change d'environ 6 % (au moins 0,01),
 * bornée à `SIZE_LIMITS`. Une taille invalide repart de 1.
 */
export function stepSize(size: number, direction: 1 | -1): number {
  const base = Number.isFinite(size) && size > 0 ? size : 1;
  let next = round2(
    direction > 0 ? base * SIZE_STEP_RATIO : base / SIZE_STEP_RATIO,
  );
  if (direction > 0 && next <= base) next = round2(base + 0.01);
  if (direction < 0 && next >= base) next = round2(base - 0.01);
  return clamp(next, SIZE_LIMITS.min, SIZE_LIMITS.max);
}

/** Taille affichée en pourcentage entier (« 106 % »). */
export const sizePercent = (size: number): number => Math.round(size * 100);

/** Distance entre deux doigts (px). */
export function touchDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Pincement : la taille de départ multipliée par le rapport des écarts entre les doigts, bornée.
 * Un écart invalide laisse la taille inchangée.
 */
export function pinchSize(
  startSize: number,
  startDistance: number,
  currentDistance: number,
): number {
  if (
    !Number.isFinite(startSize) ||
    !Number.isFinite(startDistance) ||
    !(startDistance > 0) ||
    !Number.isFinite(currentDistance) ||
    currentDistance < 0
  )
    return startSize;
  const next =
    Math.round(startSize * (currentDistance / startDistance) * 1000) / 1000;
  return clamp(next, SIZE_LIMITS.min, SIZE_LIMITS.max);
}

// ── toucher ─────────────────────────────────────────────────────────────────

/** Les blocs sous un point (fractions du cadre), le plus petit d'abord : il est celui qu'on vise. */
export function blocksAt(
  layout: ExportLayout,
  point: { x: number; y: number },
): BlockId[] {
  return BLOCK_IDS.filter((id) => {
    const b = layout[id];
    return (
      point.x >= b.x &&
      point.x <= b.x + b.w &&
      point.y >= b.y &&
      point.y <= b.y + b.h
    );
  }).sort((a, b) => layout[a].w * layout[a].h - layout[b].w * layout[b].h);
}
