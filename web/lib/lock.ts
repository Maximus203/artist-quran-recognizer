/**
 * Verrou asynchrone par clé : les tâches d'une même clé s'exécutent l'une après l'autre (lecture,
 * fusion puis écriture d'une revue sans qu'une autre écriture s'intercale). Le registre vit sur
 * `globalThis` : chaque route de Next peut charger sa propre copie de ce module.
 */
type Tails = Map<string, Promise<unknown>>;
const holder = globalThis as typeof globalThis & { __aqrLocks?: Tails };
const tails: Tails = (holder.__aqrLocks ??= new Map());

export function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}
