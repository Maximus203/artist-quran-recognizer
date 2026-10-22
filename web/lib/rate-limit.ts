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
};

type Entry = { fails: number; last: number; lockedUntil: number };

export class FailureLimiter {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly options: FailureOptions) {}

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
    this.entries.set(key, entry);
    this.prune(now);
  }

  succeed(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }

  private live(key: string, now: number): Entry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.lockedUntil <= now && now - entry.last > this.options.windowMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  /** Borne la mémoire : au-delà de `maxKeys`, on oublie d'abord les clés expirées puis les plus anciennes. */
  private prune(now: number): void {
    const max = this.options.maxKeys ?? 10_000;
    if (this.entries.size <= max) return;
    for (const [key, entry] of this.entries)
      if (entry.lockedUntil <= now && now - entry.last > this.options.windowMs)
        this.entries.delete(key);
    for (const key of this.entries.keys()) {
      if (this.entries.size <= max) break;
      this.entries.delete(key);
    }
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
