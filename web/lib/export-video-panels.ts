/**
 * Fond du texte de la vidéo d'export : `paintPanel` dessine, selon le choix, un fond transparent (voile
 * teinté aux bords adoucis), flou (le décor derrière le texte, flouté) ou plein (opaque) ; sans fond,
 * `drawLegibleText` rend le texte lisible par une ombre douce ou un contour. Aucune dépendance au
 * DOM : le contexte 2D et le canevas de travail du flou sont injectés (tests à froid).
 *
 * FLOU. Le flou est calculé en BASSE RÉSOLUTION : la zone du décor est copiée vers un petit canevas
 * (réduction par `k`), puis agrandie dans le rectangle arrondi. C'est le même coût quelle que soit la
 * force du flou, sans dépendre de `ctx.filter` (absent de certains navigateurs). Mesures : voir
 * `.artist/decision-log.md` (« Fond flouté »).
 */
import type { PanelStyle } from "./export-video-model";

/** Un rectangle en pixels. */
export type PanelRect = { x: number; y: number; width: number; height: number };

/** Canevas de travail du flou : une image et son contexte 2D. */
export type ScratchCanvas = {
  canvas: CanvasImageSource;
  ctx: CanvasRenderingContext2D;
};
/** Fabrique du canevas de travail ; `null` si le navigateur n'en offre pas. */
export type Scratch = (width: number, height: number) => ScratchCanvas | null;

export type PanelDeps = { scratch?: Scratch };

/** Force du flou, en px de la vidéo de référence (1080 px de côté court). */
export const BLUR_PX = 16;
/** Couches du voile « transparent » : leur opacité cumulée est celle demandée. */
const SOFT_LAYERS = 14;
const FALLBACK_COLOR: [number, number, number] = [6, 8, 12];

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

/** Canevas de travail réel (DOM ou OffscreenCanvas), réutilisé d'une image à l'autre. */
let sharedScratch: {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D;
} | null = null;
const domScratch: Scratch = (width, height) => {
  try {
    if (!sharedScratch) {
      const canvas =
        typeof document !== "undefined"
          ? document.createElement("canvas")
          : typeof OffscreenCanvas !== "undefined"
            ? new OffscreenCanvas(width, height)
            : null;
      const ctx = canvas?.getContext("2d") as CanvasRenderingContext2D | null;
      if (!canvas || !ctx) return null;
      sharedScratch = { canvas, ctx };
    }
    // Ne redimensionne que si la taille change : réaffecter width/height vide le canevas.
    if (
      sharedScratch.canvas.width !== width ||
      sharedScratch.canvas.height !== height
    ) {
      sharedScratch.canvas.width = width;
      sharedScratch.canvas.height = height;
    }
    return {
      canvas: sharedScratch.canvas as CanvasImageSource,
      ctx: sharedScratch.ctx,
    };
  } catch {
    return null;
  }
};

/** Le décor derrière le rectangle, flou, rogné au rectangle arrondi, puis teinté. */
function paintBlur(
  ctx: CanvasRenderingContext2D,
  rect: PanelRect,
  style: PanelStyle,
  scale: number,
  scratch: Scratch,
): void {
  const radius = style.radius * scale;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
  ctx.clip();
  // Réduction d'un facteur proche de la force du flou : réduire puis agrandir EST le flou.
  const k = Math.max(2, Math.round((BLUR_PX * scale) / 2));
  const sw = Math.max(1, Math.ceil(rect.width / k));
  const sh = Math.max(1, Math.ceil(rect.height / k));
  const work = scratch(sw, sh);
  if (work) {
    work.ctx.clearRect(0, 0, sw, sh);
    work.ctx.imageSmoothingEnabled = true;
    work.ctx.imageSmoothingQuality = "high";
    work.ctx.drawImage(
      ctx.canvas as CanvasImageSource,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      sw,
      sh,
    );
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(work.canvas, rect.x, rect.y, rect.width, rect.height);
  }
  // Le tracé du rectangle arrondi est toujours là (le rognage ne le consomme pas) : on le remplit.
  ctx.fillStyle = rgba(style.color, style.opacity);
  ctx.fill();
  ctx.restore();
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
  if (style.kind === "blur")
    return paintBlur(ctx, rect, style, scale, deps.scratch ?? domScratch);
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
