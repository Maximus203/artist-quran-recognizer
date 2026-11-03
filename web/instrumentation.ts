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
  const { announceService } = await import("./lib/service-lifecycle");
  announceService();
  // Base d'abord : elle suit les écritures de session.json que la reprise de file va provoquer.
  const { ready } = await import("./lib/server-init");
  await ready().catch(() => undefined); // l'erreur est journalisée ; la requête suivante réessaie
  // Index des exports vidéo recalé sur le disque (vidéos d'avant la migration 009).
  const { getDb } = await import("./lib/db");
  const { reconcileAllExports } = await import("./lib/export-index");
  await reconcileAllExports(getDb()).catch(() => 0);
  // Vidéos de fond expirées (envois abandonnés, vidéos non utilisées) : retirées au démarrage puis chaque heure.
  const { cleanupExpiredClips } = await import("./lib/background-video-store");
  await cleanupExpiredClips().catch(() => 0);
  setInterval(
    () => void cleanupExpiredClips().catch(() => 0),
    60 * 60 * 1000,
  ).unref();
  const { ensureQueueRecovered } = await import("./lib/jobs");
  await ensureQueueRecovered().catch(() => []);
}
