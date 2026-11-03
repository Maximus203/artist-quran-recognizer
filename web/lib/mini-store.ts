/**
 * Petit magasin observable (compatible `useSyncExternalStore`). Sert à la position de lecture, qui
 * change à chaque image : seuls les composants qui la lisent se redessinent, pas toute l'application.
 */
export type Store<T> = {
  get(): T;
  set(next: T | ((previous: T) => T)): void;
  subscribe(listener: () => void): () => void;
};

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      const resolved =
        typeof next === "function" ? (next as (p: T) => T)(value) : next;
      if (Object.is(resolved, value)) return;
      value = resolved;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
