/**
 * Liste virtualisée à hauteur de ligne fixe : seules les lignes proches de la zone visible existent
 * dans le DOM (≈ 40 au lieu de 3 160 pour un audio de 2 h, soit 19 000 nœuds en moins). Fonctions pures.
 */

/** Les bornes de la fenêtre sont des multiples de ce nombre : le défilement ne re-rend pas à chaque ligne. */
export const CHUNK = 8;
/** Lignes ajoutées de chaque côté de la zone visible. */
const OVERSCAN = 8;

export type RowRange = { start: number; end: number };

/** Lignes à créer pour une zone visible : `[start, end)`, marge comprise, alignée sur des paquets. */
export function visibleRows(
  count: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
): RowRange {
  if (!(count > 0) || !(rowHeight > 0)) return { start: 0, end: 0 };
  const first = Math.max(0, Math.floor(scrollTop / rowHeight));
  const last = Math.ceil((scrollTop + viewportHeight) / rowHeight);
  return {
    start: Math.max(0, Math.floor((first - OVERSCAN) / CHUNK) * CHUNK),
    end: Math.min(count, Math.ceil((last + OVERSCAN) / CHUNK) * CHUNK),
  };
}

/**
 * Positions à rendre : la fenêtre, plus la ligne qui porte la tabulation si elle en est sortie (la
 * liste reste atteignable au clavier, même défilée loin de la ligne active).
 */
export function rowsToRender(
  range: RowRange,
  tabStop: number | null,
  count: number,
): number[] {
  const rows: number[] = [];
  const outside =
    tabStop !== null &&
    tabStop >= 0 &&
    tabStop < count &&
    (tabStop < range.start || tabStop >= range.end);
  if (outside && (tabStop as number) < range.start)
    rows.push(tabStop as number);
  for (let pos = range.start; pos < Math.min(range.end, count); pos++)
    rows.push(pos);
  if (outside && (tabStop as number) >= range.end) rows.push(tabStop as number);
  return rows;
}

/** `scrollTop` qui rend la ligne entièrement visible en bougeant le moins possible. */
export function scrollTopFor(
  pos: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
): number {
  const top = pos * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return Math.max(0, top);
  if (bottom > scrollTop + viewportHeight)
    return Math.max(0, bottom - viewportHeight);
  return scrollTop;
}

/** Ligne qui reçoit le focus après une touche de navigation, `null` si la touche n'en est pas une. */
export function focusTarget(
  key: string,
  pos: number,
  count: number,
  pageRows: number,
): number | null {
  if (!(count > 0)) return null;
  const clamp = (value: number) => Math.min(count - 1, Math.max(0, value));
  switch (key) {
    case "ArrowDown":
      return clamp(pos + 1);
    case "ArrowUp":
      return clamp(pos - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "PageDown":
      return clamp(pos + pageRows);
    case "PageUp":
      return clamp(pos - pageRows);
    default:
      return null;
  }
}
