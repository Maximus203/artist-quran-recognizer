/** Cadence de rafraîchissement de la liste des sessions. */
export const POLL_ACTIVE_MS = 3000;
export const POLL_IDLE_MS = 10_000;
export const POLL_HIDDEN_MS = 15_000;

/**
 * 3 s quand l'onglet est visible et qu'une analyse est active (en cours ou en attente), 10 s sinon
 * (on voit le travail des autres testeurs), 15 s quand l'onglet est en arrière-plan.
 */
export function pollInterval(visible: boolean, hasActive: boolean): number {
  if (!visible) return POLL_HIDDEN_MS;
  return hasActive ? POLL_ACTIVE_MS : POLL_IDLE_MS;
}
