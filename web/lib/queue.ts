/**
 * File d'attente FIFO des analyses (aucune dépendance : ni disque, ni processus).
 *
 * Pourquoi : la carte graphique n'aime pas deux analyses en parallèle. `launch` (jobs.ts) place la
 * session dans cette file ; elle démarre dès qu'une place se libère (`AQR_MAX_CONCURRENT`, 1 par
 * défaut) et passe la main au suivant quand l'exécuteur (le processus Python) a fini, réussi ou non.
 *
 * Invariants :
 * - tout ce qui est synchrone (`enqueue`, `remove`, `pump`) s'exécute sans `await` : deux appels
 *   dans le même tick ne peuvent pas démarrer deux fois la même tâche ni dépasser la concurrence ;
 * - l'exécuteur ne fait jamais tomber la file : son échec est consigné (`onError`) et libère la place ;
 * - la file ne persiste rien : l'ordre durable est `queued_at` dans `session.json` (voir `recoverQueue`).
 */

/** Signal envoyé par l'exécuteur : « le processus est lancé » (la tâche tient alors sa place). */
export type JobSignal = { started: () => void };
/** Se résout quand la tâche est terminée (fin du processus), pas quand elle démarre. */
export type JobRunner = (id: string, signal: JobSignal) => Promise<void>;
export type QueueEntry = {
  /** Résolue au démarrage effectif, ou à la fin/au retrait ; rejetée si l'exécuteur échoue. */
  started: Promise<void>;
};

type Gate = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};
function gate(): Gate {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Personne n'est obligé d'attendre `started` : un rejet non attendu n'est pas « non géré ».
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

export type JobQueueOptions = {
  runner: JobRunner;
  /** Lue à chaque démarrage : `AQR_MAX_CONCURRENT` peut changer sans recréer la file. */
  concurrency: () => number;
  /** Places occupées par des processus que cette file ne possède pas (orphelins d'un redémarrage). */
  externalBusy?: () => number;
  onError?: (id: string, error: unknown) => void;
};

export class JobQueue {
  readonly #waiting: string[] = [];
  readonly #active = new Map<string, Promise<void>>();
  readonly #gates = new Map<string, Gate>();
  readonly #idleWaiters: Array<() => void> = [];
  readonly #options: JobQueueOptions;

  constructor(options: JobQueueOptions) {
    this.#options = options;
  }

  #limit(): number {
    const value = Math.floor(this.#options.concurrency());
    return Number.isFinite(value) && value >= 1 ? value : 1;
  }
  #busy(): number {
    return this.#active.size + Math.max(0, this.#options.externalBusy?.() ?? 0);
  }

  has(id: string): boolean {
    return this.#gates.has(id);
  }
  isWaiting(id: string): boolean {
    return this.#waiting.includes(id);
  }
  isActive(id: string): boolean {
    return this.#active.has(id);
  }
  /** Rang dans l'attente (1 = le prochain) ; `null` si la tâche n'attend pas. */
  position(id: string): number | null {
    const index = this.#waiting.indexOf(id);
    return index < 0 ? null : index + 1;
  }
  snapshot(): { active: string[]; waiting: string[] } {
    return { active: [...this.#active.keys()], waiting: [...this.#waiting] };
  }
  concurrency(): number {
    return this.#limit();
  }
  /** Vrai si une tâche ajoutée maintenant démarrerait immédiatement. */
  wouldStartNow(): boolean {
    return this.#waiting.length === 0 && this.#busy() < this.#limit();
  }
  /** Se résout à la fin de la tâche active `id` (`undefined` si elle n'est pas active). */
  settled(id: string): Promise<void> | undefined {
    return this.#active.get(id);
  }
  idle(): Promise<void> {
    if (this.#active.size === 0 && this.#waiting.length === 0)
      return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.push(resolve));
  }

  enqueue(id: string): QueueEntry {
    if (this.#gates.has(id))
      throw new Error("Analyse déjà en file ou en cours");
    const entry = gate();
    this.#gates.set(id, entry);
    this.#waiting.push(id);
    this.pump();
    return { started: entry.promise };
  }

  /** Retire une tâche qui attend encore ; une tâche active ne se retire pas (on tue son processus). */
  remove(id: string): boolean {
    const index = this.#waiting.indexOf(id);
    if (index < 0) return false;
    this.#waiting.splice(index, 1);
    this.#gates.get(id)?.resolve();
    this.#gates.delete(id);
    this.#notifyIdle();
    return true;
  }

  /** Démarre autant de tâches que la concurrence le permet. Idempotent. */
  pump(): void {
    while (this.#waiting.length > 0 && this.#busy() < this.#limit()) {
      this.#start(this.#waiting.shift() as string);
    }
  }

  #start(id: string): void {
    const entry = this.#gates.get(id) as Gate;
    let finish!: () => void;
    this.#active.set(id, new Promise<void>((resolve) => (finish = resolve)));
    void (async () => {
      try {
        await this.#options.runner(id, { started: () => entry.resolve() });
        entry.resolve();
      } catch (error) {
        entry.reject(error);
        try {
          this.#options.onError?.(id, error);
        } catch {
          /* le rapport d'erreur ne doit pas faire tomber la file */
        }
      } finally {
        this.#active.delete(id);
        this.#gates.delete(id);
        finish();
        this.pump();
        this.#notifyIdle();
      }
    })();
  }

  #notifyIdle(): void {
    if (this.#active.size > 0 || this.#waiting.length > 0) return;
    for (const resolve of this.#idleWaiters.splice(0)) resolve();
  }
}

const KEY = Symbol.for("aqr.job-queue");
type Holder = { [KEY]?: JobQueue };
/**
 * Une seule file par processus serveur, même si le bundler charge ce module deux fois
 * (routes et instrumentation) : le singleton vit sur `globalThis`.
 */
export function sharedQueue(create: () => JobQueue): JobQueue {
  const holder = globalThis as Holder;
  return (holder[KEY] ??= create());
}
/** La file du processus si elle existe déjà (lecture seule : ne la crée jamais). */
export function peekQueue(): JobQueue | undefined {
  return (globalThis as Holder)[KEY];
}
/** Pour les tests : repart d'une file vide. */
export function resetSharedQueue(): void {
  delete (globalThis as Holder)[KEY];
}
