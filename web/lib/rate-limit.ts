/**
 * Limitation de débit des routes d'authentification, en mémoire (un seul processus serveur).
 *
 * - `FailureLimiter` : verrouillage PROGRESSIF des échecs. Au-delà de `threshold` échecs dans la
 *   fenêtre, la clé est bloquée `baseLockMs`, puis le double à chaque échec de plus, plafonné à
 *   `maxLockMs`. Un succès remet la clé à zéro. Une clé sans échec depuis `windowMs` est oubliée.
 * - `HitLimiter` : au plus `max` événements par fenêtre glissante (inscriptions).
 * L'horloge est injectée : aucun test n'attend pour de vrai.
 */
export type Verdict =
  | { allowed: true }
  | { allowed: false; retryAfterS: number };

export type FailureOptions = {
  threshold: number;
  baseLockMs: number;
  maxLockMs: number;
  windowMs: number;
  maxKeys?: number;
  /** Où vivent les échecs : la mémoire du processus (défaut) ou la base (`DbFailureStore`). */
  store?: FailureStore;
};

export type FailureEntry = { fails: number; last: number; lockedUntil: number };

/** Stockage des échecs d'un limiteur. Synchrone : la base de l'atelier (`node:sqlite`) l'est aussi. */
export interface FailureStore {
  get(key: string): FailureEntry | undefined;
  set(key: string, entry: FailureEntry): void;
  delete(key: string): void;
  size(): number;
  /** Borne le volume : oublie les clés expirées puis, au-delà de `max`, les plus anciennes. */
  prune(now: number, windowMs: number, max: number): void;
}

export class MemoryFailureStore implements FailureStore {
  private readonly entries = new Map<string, FailureEntry>();
  get(key: string) {
    return this.entries.get(key);
  }
  set(key: string, entry: FailureEntry) {
    this.entries.set(key, entry);
  }
  delete(key: string) {
    this.entries.delete(key);
  }
  size() {
    return this.entries.size;
  }
  prune(now: number, windowMs: number, max: number) {
    if (this.entries.size <= max) return;
    for (const [key, entry] of this.entries)
      if (entry.lockedUntil <= now && now - entry.last > windowMs)
        this.entries.delete(key);
    for (const key of this.entries.keys()) {
      if (this.entries.size <= max) break;
      this.entries.delete(key);
    }
  }
}

export class FailureLimiter {
  private readonly store: FailureStore;
  constructor(private readonly options: FailureOptions) {
    this.store = options.store ?? new MemoryFailureStore();
  }

  check(key: string, now = Date.now()): Verdict {
    const entry = this.live(key, now);
    if (entry && entry.lockedUntil > now)
      return {
        allowed: false,
        retryAfterS: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)),
      };
    return { allowed: true };
  }

  fail(key: string, now = Date.now()): void {
    const { threshold, baseLockMs, maxLockMs } = this.options;
    const entry = this.live(key, now) ?? {
      fails: 0,
      last: now,
      lockedUntil: 0,
    };
    entry.fails += 1;
    entry.last = now;
    if (entry.fails >= threshold) {
      const lock = baseLockMs * 2 ** (entry.fails - threshold);
      entry.lockedUntil = now + Math.min(maxLockMs, lock);
    }
    this.store.set(key, entry);
    this.store.prune(
      now,
      this.options.windowMs,
      this.options.maxKeys ?? 10_000,
    );
  }

  succeed(key: string): void {
    this.store.delete(key);
  }

  get size(): number {
    return this.store.size();
  }

  private live(key: string, now: number): FailureEntry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.lockedUntil <= now && now - entry.last > this.options.windowMs) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }
}

export class HitLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Compte l'événement si la limite le permet. */
  hit(key: string, now = Date.now()): Verdict {
    const recent = (this.hits.get(key) ?? []).filter(
      (time) => now - time < this.windowMs,
    );
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return {
        allowed: false,
        retryAfterS: Math.max(
          1,
          Math.ceil((recent[0] + this.windowMs - now) / 1000),
        ),
      };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear();
    return { allowed: true };
  }
}
