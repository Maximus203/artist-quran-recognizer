import { log, pruneLogs } from "./log";

/**
 * Démarrage et arrêt du service dans le journal, et purge quotidienne des journaux expirés. Appelé
 * une fois par `instrumentation.ts` (hors Edge : il touche à `process`).
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const STARTED = Symbol.for("aqr.service-lifecycle");

export function announceService(): void {
  const holder = globalThis as { [STARTED]?: boolean };
  if (holder[STARTED]) return;
  holder[STARTED] = true;
  log.event("init", "service.start", {
    node: process.versions.node,
    env: process.env.NODE_ENV ?? "unknown",
    pid: process.pid,
  });
  pruneLogs();
  setInterval(() => pruneLogs(), DAY_MS).unref();
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => {
      log.event("init", "service.stop", { signal, pid: process.pid });
      process.exit(0);
    });
}
