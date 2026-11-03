import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Identifiant de corrélation de la requête en cours : posé par `safe()` (à partir de l'en-tête
 * `X-Request-Id` du proxy) et relu par le journal, de sorte que TOUTES les lignes écrites pendant une
 * requête (accès, audit, erreur) portent le même `rid`.
 */
type Context = { rid: string };
const storage = new AsyncLocalStorage<Context>();

export const runWithRequest = <T>(rid: string, work: () => T): T =>
  storage.run({ rid }, work);
export const currentRequestId = (): string | undefined =>
  storage.getStore()?.rid;
