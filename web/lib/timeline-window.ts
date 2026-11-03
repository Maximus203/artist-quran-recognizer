/**
 * Fenêtrage de la timeline : seuls les segments qui touchent la fenêtre visible (plus une marge) sont
 * dessinés, et ceux trop étroits pour être distingués à l'écran sont fusionnés en blocs. Le nombre de
 * nœuds DOM suit donc la largeur de l'écran, pas le nombre d'intervalles (3 160 pour 2 h d'audio, soit
 * plus de 6 000 boutons sur l'onde et les pistes avant ce découpage). Fonctions pures, testées.
 */

/** Largeur (px) en dessous de laquelle un segment n'est plus un repère lisible et se fond dans son voisin. */
export const MIN_SEGMENT_PX = 4;
/** Trou (px) toléré entre deux segments étroits pour les fusionner sans peindre par-dessus le vide. */
const MAX_GAP_PX = 1.5;
/** Plafond de blocs par piste : au-delà, le seuil de fusion double jusqu'à y tenir. */
export const MAX_BLOCKS = 600;
/** Marge de chaque côté, en part de la largeur visible : la vue défile sans redessiner les segments. */
export const WINDOW_MARGIN = 0.5;

export type Range = { a: number; b: number };

/** Instants couverts par la vue : `scrollLeft` et la largeur visible dans un contenu de `contentPx`. */
export function visibleTimeRange(
  scrollLeft: number,
  viewportPx: number,
  contentPx: number,
  duration: number,
): Range {
  if (!(duration > 0)) return { a: 0, b: 0 };
  if (!(contentPx > 0) || !(viewportPx > 0)) return { a: 0, b: duration };
  const at = (px: number) =>
    Math.min(duration, Math.max(0, (px / contentPx) * duration));
  return { a: at(scrollLeft), b: at(scrollLeft + viewportPx) };
}

/** Fenêtre de rendu : la vue élargie d'une marge de chaque côté, bornée au fichier. */
export function renderWindowFor(
  visible: Range,
  duration: number,
  margin = WINDOW_MARGIN,
): Range {
  const pad = (visible.b - visible.a) * margin;
  return {
    a: Math.max(0, visible.a - pad),
    b: Math.min(duration, visible.b + pad),
  };
}

/** Vrai tant que la vue tient dans la fenêtre de rendu : rien à redessiner. */
export function windowCovers(win: Range | null, visible: Range): boolean {
  return win !== null && win.a <= visible.a && win.b >= visible.b;
}

/** Rapport maximal entre la fenêtre de rendu et la vue : au-delà (zoom avant), on la resserre. */
const MAX_WINDOW_RATIO = 3;

/** La fenêtre convient : elle couvre la vue sans être démesurée par rapport à elle. */
export function windowFits(win: Range | null, visible: Range): boolean {
  return (
    windowCovers(win, visible) &&
    (win as Range).b - (win as Range).a <=
      Math.max(visible.b - visible.a, 1e-6) * MAX_WINDOW_RATIO
  );
}

/**
 * La fenêtre de rendu a-t-elle été faite pour la vue actuelle ? Au moment d'un changement de zoom, le
 * rendu voit la nouvelle échelle avec l'ancienne fenêtre (calculée après, avant la peinture) : sans ce
 * contrôle, l'écran « Fichier entier » → « 2 min » créerait un instant des milliers de segments.
 */
export function windowMatchesSpan(
  win: Range | null,
  visibleSeconds: number,
): boolean {
  if (!win) return false;
  const size = win.b - win.a;
  return (
    size >= visibleSeconds * 0.999 &&
    size <= visibleSeconds * (1 + 2 * WINDOW_MARGIN) * 1.001
  );
}

export type SegLike = {
  index: number;
  start: number;
  end: number;
  style: string;
};
export type Block =
  | { kind: "one"; index: number }
  | {
      kind: "run";
      /** Premier et dernier intervalle (indices d'origine) fondus dans le bloc. */
      first: number;
      last: number;
      start: number;
      end: number;
      style: string;
      count: number;
    };

/**
 * Segments (triés par début) vers blocs : un segment d'au moins `minPx` reste lui-même ; les segments
 * plus étroits, contigus et de même style, se fondent en un bloc. Un étroit isolé reste un segment,
 * et l'intervalle `pinned` (le choisi) n'est jamais absorbé : il garde sa propre forme.
 */
export function coalesceSegments(
  segs: readonly SegLike[],
  pxPerSecond: number,
  minPx = MIN_SEGMENT_PX,
  pinned: number | null = null,
): Block[] {
  const blocks: Block[] = [];
  const usable = Number.isFinite(pxPerSecond) && pxPerSecond > 0;
  let run: (SegLike & { last: number; count: number }) | null = null;
  const flush = () => {
    if (!run) return;
    blocks.push(
      run.count === 1
        ? { kind: "one", index: run.index }
        : {
            kind: "run",
            first: run.index,
            last: run.last,
            start: run.start,
            end: run.end,
            style: run.style,
            count: run.count,
          },
    );
    run = null;
  };
  for (const s of segs) {
    if (
      !usable ||
      s.index === pinned ||
      (s.end - s.start) * pxPerSecond >= minPx
    ) {
      flush();
      blocks.push({ kind: "one", index: s.index });
      continue;
    }
    if (
      run &&
      run.style === s.style &&
      (s.start - run.end) * pxPerSecond <= MAX_GAP_PX
    ) {
      run.end = Math.max(run.end, s.end);
      run.last = s.index;
      run.count++;
    } else {
      flush();
      run = { ...s, last: s.index, count: 1 };
    }
  }
  flush();
  return blocks;
}

/** Comme `coalesceSegments`, en doublant le seuil tant que la piste dépasse `cap` blocs. */
export function capBlocks(
  segs: readonly SegLike[],
  pxPerSecond: number,
  cap = MAX_BLOCKS,
  pinned: number | null = null,
  minPx = MIN_SEGMENT_PX,
): Block[] {
  let px = minPx;
  let blocks = coalesceSegments(segs, pxPerSecond, px, pinned);
  while (blocks.length > cap && px < 512) {
    px *= 2;
    blocks = coalesceSegments(segs, pxPerSecond, px, pinned);
  }
  return blocks;
}
