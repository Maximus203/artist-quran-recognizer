/**
 * Liste de sessions paginée qui vit : le sondage relit la tête de la liste pour montrer l'avancement
 * des analyses et les arrivées, sans jamais perdre les pages déjà chargées par « Charger plus ».
 * Pur : la requête et l'horloge sont dans le hook qui l'utilise.
 */
export const MAX_PAGE = 100;

/** Combien de lignes relire : tout ce qui est chargé, dans la limite de l'API. */
export const refreshLimit = (loaded: number, pageSize: number): number =>
  Math.min(MAX_PAGE, Math.max(pageSize, loaded));

export function applyRefresh<T extends { id: string }>(
  current: readonly T[],
  fresh: readonly T[],
  requestedLimit: number,
  freshNext: string | null,
  currentNext: string | null,
): { items: T[]; nextCursor: string | null } {
  // Tout ce qui est chargé a été relu : la relecture fait foi (arrivées, retraits, changements).
  if (current.length <= requestedLimit)
    return { items: [...fresh], nextCursor: freshNext };
  // Au-delà de 100 lignes, seule la tête est relue : la queue chargée reste, curseur inchangé.
  const head = new Set(fresh.map((item) => item.id));
  const tail = current
    .slice(requestedLimit)
    .filter((item) => !head.has(item.id));
  return { items: [...fresh, ...tail], nextCursor: currentNext };
}
