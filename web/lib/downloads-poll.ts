/**
 * Rythme d'actualisation de la page Téléchargements : une seule configuration. Rapide tant qu'un export
 * est en file ou en cours (la barre avance), lent sinon (un export lancé ailleurs finit par apparaître).
 */
export const DOWNLOADS_POLL_BUSY_MS = 2500;
export const DOWNLOADS_POLL_IDLE_MS = 15000;

/** Délai avant le prochain relevé ; `null` = pas encore de réponse. Onglet caché : on ralentit. */
export function nextDownloadsPoll(
  active: number | null,
  pageVisible: boolean,
): number {
  return active !== null && active > 0 && pageVisible
    ? DOWNLOADS_POLL_BUSY_MS
    : DOWNLOADS_POLL_IDLE_MS;
}
