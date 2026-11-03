import { getDb, dbPath, type Db } from "./db";
import { log } from "./log";
import { importLegacySessions, installSessionHooks } from "./session-sync";

/**
 * Démarrage de la couche données, une fois par processus et par fichier de base : ouvre la base
 * (migrations comprises), branche l'index sur les écritures de `session.json`, puis importe les
 * sessions déjà présentes sur le disque. Appelé par `instrumentation.ts` et, au besoin, par la
 * première requête. Une erreur d'ouverture n'est pas mémorisée : la requête suivante réessaie.
 */
const READY = Symbol.for("aqr.server-ready");
type Ready = { file: string; promise: Promise<Db> };

export function ready(): Promise<Db> {
  const holder = globalThis as { [READY]?: Ready };
  const file = dbPath();
  if (holder[READY]?.file === file) return holder[READY].promise;
  const promise = (async () => {
    const db = getDb();
    installSessionHooks();
    try {
      await importLegacySessions();
    } catch (error) {
      log.error("init", "import des sessions existantes interrompu", error);
    }
    return db;
  })();
  holder[READY] = { file, promise };
  promise.catch((error) => {
    log.error("init", "ouverture de la base impossible", error);
    if (holder[READY]?.promise === promise) delete holder[READY];
  });
  return promise;
}

/** Tests : oublie l'état d'initialisation (autre dossier de données). */
export function resetReady(): void {
  delete (globalThis as { [READY]?: Ready })[READY];
}
