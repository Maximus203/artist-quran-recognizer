/**
 * Au démarrage du serveur : remet en file les analyses « en attente » laissées par l'instance
 * précédente (dans l'ordre de `queued_at`) et repère les processus encore vivants qui tiennent la
 * carte graphique. Sans cela, la file ne repartirait qu'à la première requête.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Version de Node corrigée de CVE-2026-111497 : obligatoire en production, avertissement ailleurs.
  const { guardStartup } = await import("./lib/runtime-guard");
  const { log } = await import("./lib/log");
  guardStartup({
    warn: (message) => log.warn("runtime", message),
    error: (message, error) => log.error("runtime", message, error),
  });
  // Base d'abord : elle suit les écritures de session.json que la reprise de file va provoquer.
  const { ready } = await import("./lib/server-init");
  await ready().catch(() => undefined); // l'erreur est journalisée ; la requête suivante réessaie
  const { ensureQueueRecovered } = await import("./lib/jobs");
  await ensureQueueRecovered().catch(() => []);
}
