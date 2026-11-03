/**
 * Fond du texte de la vidéo d'export : `paintPanel` dessine, selon le choix, un fond transparent (voile
 * teinté aux bords adoucis), flou (le décor derrière le texte, flouté) ou plein (opaque) ; sans fond,
 * `drawLegibleText` rend le texte lisible par une ombre douce ou un contour. Aucune dépendance au
 * DOM : le contexte 2D et les canevas de travail sont injectés (tests à froid).
 *
 * FLOU. Le flou se calcule en BASSE RÉSOLUTION, à partir du décor lui-même (image ou vidéo), jamais en
 * relisant le canevas en cours de dessin :
 *  1. la zone du décor est copiée vers un petit canevas (réduction par `k` proche de la force du flou) ;
 *  2. il est agrandi dans le rectangle, en qualité BASSE (bilinéaire) ;
 *  3. rogné au rectangle arrondi et teinté, au dessin (la pièce floue reste opaque : c'est ce qui coûte peu).
 * Décor FIXE (photo) : le petit canevas (quelques ko) est mis en cache, une image ne refait que 2 et 3.
 * Décor qui BOUGE (vidéo) : on refait 1 à 3 à chaque image (la réduction est presque gratuite). On ne met
 * JAMAIS en cache la pièce pleine taille : la reposer coûtait plus cher que d'agrandir le petit canevas.
 * Dégradé ou couleur unie : le flou d'un décor lisse est le décor ; on ne fait que teinter. Mesures au
 * navigateur (1080p) : `.artist/decision-log.md`, « Fond flouté ».
 */
import type { PanelStyle } from "./export-video-model";

/** Un rectangle en pixels. */
export type PanelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Canevas de travail : une image et son contexte 2D. */
export type ScratchCanvas = {
  canvas: CanvasImageSource;
  ctx: CanvasRenderingContext2D;
};
/** Fabrique de canevas ; `null` si le navigateur n'en offre pas. */
export type Scratch = (width: number, height: number) => ScratchCanvas | null;

/** Le décor derrière le texte, tel qu'il est dessiné dans le cadre. */
export type Backdrop = {
  /** Image (photo) ou vidéo de fond. */
  source: CanvasImageSource;
  /** Où elle est dessinée dans le cadre (px) : elle le couvre, rognée. */
  dest: PanelRect;
  /** Taille propre de la source (px). */
  size: { width: number; height: number };
  /** Vidéo : le décor change à chaque image, rien n'est mis en cache. */
  live: boolean;
};

export type PanelDeps = {
  /** Canevas de travail RÉUTILISÉ d'un appel à l'autre (le petit canevas du flou). */
  scratch?: Scratch;
  /** Canevas NEUF à chaque appel (pièces mises en cache). */
  fresh?: Scratch;
  /** Décor à flouter ; absent = décor uni ou dégradé (teinte seule). */
  backdrop?: Backdrop;
};

/** Force du flou, en px de la vidéo de référence (1080 px de côté court). */
export const BLUR_PX = 16;
/** Couches du voile « transparent » : leur opacité cumulée est celle demandée. */
const SOFT_LAYERS = 14;
const FALLBACK_COLOR: [number, number, number] = [6, 8, 12];
/** Pièces floues gardées en mémoire par décor fixe. */
const CACHE_ENTRIES = 8;

/** `#rrggbb` → [r, g, b] ; un code invalide donne le noir bleuté du produit. */
export function hexToRgb(hex: string): [number, number, number] {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return FALLBACK_COLOR;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Couleur CSS `rgba(...)` ; l'opacité est bornée à 0–1 (NaN = 0). */
export function rgba(hex: string, opacity: number): string {
  const [r, g, b] = hexToRgb(hex);
  const a = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

const validRect = (r: PanelRect): boolean =>
  [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
  r.width > 0 &&
  r.height > 0;

/** Voile aux bords adoucis : couches concentriques de faible opacité (l'ancien « support de lisibilité »). */
function paintSoft(
  ctx: CanvasRenderingContext2D,
  rect: PanelRect,
  style: PanelStyle,
  scale: number,
): void {
  if (style.opacity <= 0) return;
  const feather = style.radius * scale;
  ctx.save();
  if (feather < 1) {
    ctx.fillStyle = rgba(style.color, style.opacity);
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, 0);
    ctx.fill();
    ctx.restore();
    return;
  }
  // Chaque couche pèse `a` ; au centre, SOFT_LAYERS couches se cumulent en `style.opacity`.
  const layer = 1 - Math.pow(1 - Math.min(1, style.opacity), 1 / SOFT_LAYERS);
  ctx.fillStyle = rgba(style.color, layer);
  for (let i = 0; i < SOFT_LAYERS; i++) {
    const inset = (i / SOFT_LAYERS) * feather * 2 - feather;
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

/** Rectangle arrondi teinté, sans flou (fond « flou » sur un décor uni, ou canevas de travail absent). */
function paintTint(
  ctx: CanvasRenderingContext2D,
  rect: PanelRect,
  style: PanelStyle,
  scale: number,
): void {
  ctx.save();
  ctx.fillStyle = rgba(style.color, style.opacity);
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, style.radius * scale);
  ctx.fill();
  ctx.restore();
}

/** Canevas réels (DOM ou OffscreenCanvas). */
function makeCanvas(
  width: number,
  height: number,
): {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D;
} | null {
  try {
    const canvas =
      typeof document !== "undefined"
        ? document.createElement("canvas")
        : typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(width, height)
          : null;
    if (!canvas) return null;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    return ctx ? { canvas, ctx } : null;
  } catch {
    return null;
  }
}

const domFresh: Scratch = (width, height) => {
  const made = makeCanvas(width, height);
  return made && { canvas: made.canvas as CanvasImageSource, ctx: made.ctx };
};

/** Un seul canevas de travail, réutilisé : redimensionné seulement si la taille change (cela le vide). */
let sharedScratch: ReturnType<typeof makeCanvas> = null;
const domScratch: Scratch = (width, height) => {
  if (!sharedScratch) sharedScratch = makeCanvas(width, height);
  if (!sharedScratch) return null;
  const { canvas } = sharedScratch;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return {
    canvas: canvas as CanvasImageSource,
    ctx: sharedScratch.ctx,
  };
};

/** Petits canevas flous en cache, par décor fixe (clé : zone et réduction). */
const smallCache = new WeakMap<object, Map<string, ScratchCanvas>>();

/**
 * Le décor derrière `rect`, réduit dans un petit canevas ; null si la source ou le canevas de travail
 * manquent. La zone du décor se déduit de la façon dont il est dessiné dans le cadre.
 */
function buildSmall(
  rect: PanelRect,
  backdrop: Backdrop,
  scratch: Scratch,
  k: number,
): ScratchCanvas | null {
  const { dest, size } = backdrop;
  if (
    !(dest.width > 0) ||
    !(dest.height > 0) ||
    !(size.width > 0) ||
    !(size.height > 0)
  )
    return null;
  const fx = size.width / dest.width;
  const fy = size.height / dest.height;
  const sx = Math.max(0, (rect.x - dest.x) * fx);
  const sy = Math.max(0, (rect.y - dest.y) * fy);
  const sw = Math.min(size.width - sx, rect.width * fx);
  const sh = Math.min(size.height - sy, rect.height * fy);
  if (!(sw > 0) || !(sh > 0)) return null;
  const width = Math.max(1, Math.ceil(rect.width / k));
  const height = Math.max(1, Math.ceil(rect.height / k));
  const work = scratch(width, height);
  if (!work) return null;
  const w = work.ctx;
  w.globalCompositeOperation = "source-over";
  w.clearRect(0, 0, width, height);
  w.imageSmoothingEnabled = true;
  w.imageSmoothingQuality = "high";
  w.drawImage(backdrop.source, sx, sy, sw, sh, 0, 0, width, height);
  return work;
}

/**
 * Pose un décor flouté dans le rectangle arrondi, puis le teinte. La pièce reste OPAQUE (le rognage
 * arrondi et la teinte se font ici, au dessin) : une pièce à bords transparents coûtait trois fois plus
 * cher à poser qu'une pièce opaque rognée (mesuré, voir le journal des décisions).
 */
function blit(
  ctx: CanvasRenderingContext2D,
  rect: PanelRect,
  style: PanelStyle,
  scale: number,
  draw: () => void,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, style.radius * scale);
  ctx.clip();
  draw();
  // Le tracé du rectangle arrondi est toujours là (le rognage ne le consomme pas) : on le remplit.
  ctx.fillStyle = rgba(style.color, style.opacity);
  ctx.fill();
  ctx.restore();
}

/** Le décor flouté (basse résolution), teinté, dans `rect`. */
function paintBlur(
  ctx: CanvasRenderingContext2D,
  rect: PanelRect,
  style: PanelStyle,
  scale: number,
  deps: PanelDeps,
): void {
  const backdrop = deps.backdrop;
  if (!backdrop) return paintTint(ctx, rect, style, scale);
  // Réduction proche de la force du flou : réduire puis agrandir EST le flou.
  const k = Math.max(2, Math.round((BLUR_PX * scale) / 2));
  let small: ScratchCanvas | null;
  if (backdrop.live) {
    // Décor qui bouge : on relit le décor à chaque image, dans le petit canevas réutilisé.
    small = buildSmall(rect, backdrop, deps.scratch ?? domScratch, k);
  } else {
    // Décor fixe : le petit canevas (quelques ko) est calculé une fois par zone, puis réutilisé.
    const key = [rect.x, rect.y, rect.width, rect.height, k].join("|");
    let cached = smallCache.get(backdrop.source);
    if (!cached) smallCache.set(backdrop.source, (cached = new Map()));
    small = cached.get(key) ?? null;
    if (!small) {
      small = buildSmall(rect, backdrop, deps.fresh ?? domFresh, k);
      if (small) cached.set(key, small);
      // Plus ancien d'abord : on ne garde que les derniers (un par bloc de texte du passage affiché).
      while (cached.size > CACHE_ENTRIES)
        cached.delete(cached.keys().next().value as string);
    }
  }
  if (!small) return paintTint(ctx, rect, style, scale);
  const source = small.canvas;
  // Agrandi en qualité BASSE (bilinéaire) : la haute qualité coûtait quatre fois plus pour le même flou.
  blit(ctx, rect, style, scale, () => {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height);
  });
}

/**
 * Dessine le fond d'un bloc de texte dans `rect` (pixels). `scale` = taille de la vidéo / 1080 px :
 * l'arrondi et le flou suivent la taille de l'image. « Aucun » ne dessine rien.
 */
export function paintPanel(
  ctx: CanvasRenderingContext2D,
  rect: PanelRect,
  style: PanelStyle,
  scale: number,
  deps: PanelDeps = {},
): void {
  if (style.kind === "none" || !validRect(rect)) return;
  if (style.kind === "transparent") return paintSoft(ctx, rect, style, scale);
  if (style.kind === "blur") return paintBlur(ctx, rect, style, scale, deps);
  // Plein : toujours opaque.
  ctx.save();
  ctx.fillStyle = rgba(style.color, 1);
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, style.radius * scale);
  ctx.fill();
  ctx.restore();
}

/**
 * Dessine un texte (centré par l'appelant). Avec un fond, le texte est tel quel ; SANS fond, il est
 * rendu lisible par une ombre douce ou un contour (couleur et opacité du fond choisi).
 */
export function drawLegibleText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: PanelStyle,
  fontPx: number,
  scale: number,
  fill: string,
): void {
  ctx.fillStyle = fill;
  if (style.kind !== "none") {
    ctx.fillText(text, x, y);
    return;
  }
  if (style.legibility === "outline") {
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2 * scale, fontPx * 0.08);
    ctx.strokeStyle = rgba(style.color, Math.max(0.6, style.opacity));
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    return;
  }
  ctx.shadowColor = rgba(style.color, style.opacity);
  ctx.shadowBlur = fontPx * 0.22;
  ctx.shadowOffsetY = fontPx * 0.05;
  ctx.fillText(text, x, y);
  ctx.shadowColor = "rgba(0, 0, 0, 0)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}
