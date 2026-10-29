/**
 * File d'attente FIFO des charges lourdes (aucune dépendance : ni disque, ni processus).
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
 *
 * Pile unique : analyses et exports vidéo passent par cette même file (`enqueue(id, { run })`), donc
 * deux charges lourdes ne tournent jamais ensemble au-delà de la concurrence. Équité : à chaque place
 * libérée, on sert le compte servi le moins récemment (tour à tour), la FIFO départageant les
 * égalités ; `maxWaitingPerOwner` borne ce qu'un compte peut mettre en attente. Watchdog : un job qui
 * dépasse `timeoutMs` reçoit le signal d'arrêt, puis sa place est reprise après `graceMs` même si
 * son exécuteur ne répond plus.
 */

/** Signal envoyé par l'exécuteur : « le processus est lancé » (la tâche tient alors sa place). */
export type JobSignal = {
  started: () => void;
  /** Déclenché par `abort` (annulation) ou par le watchdog : l'exécuteur doit tuer son travail. */
  aborted: AbortSignal;
};
/** Se résout quand la tâche est terminée (fin du processus), pas quand elle démarre. */
export type JobRunner = (id: string, signal: JobSignal) => Promise<void>;
export type QueueEntry = {
  /** Résolue au démarrage effectif, ou à la fin/au retrait ; rejetée si l'exécuteur échoue. */
  started: Promise<void>;
};

export class QueueLimitError extends Error {
  constructor(message = "Trop de traitements en attente pour ce compte.") {
    super(message);
    this.name = "QueueLimitError";
  }
}
export class WatchdogTimeoutError extends Error {
  constructor(message = "Délai maximal dépassé : traitement arrêté.") {
    super(message);
    this.name = "WatchdogTimeoutError";
  }
}

export type EnqueueOptions = {
  /** Compte propriétaire (équité) ; sans propriétaire, chaque tâche compte pour elle seule. */
  owner?: string;
  /** Exécuteur propre à cette tâche (sinon celui de la file). */
  run?: JobRunner;
  /** Délai maximal d'exécution ; absent : aucun. */
  timeoutMs?: number | null;
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
  /** Jobs en attente autorisés par compte (hors job actif) ; absent ou invalide : illimité. */
  maxWaitingPerOwner?: () => number;
  /** Délai laissé à l'exécuteur pour obéir à l'arrêt avant de reprendre la place de force. */
  graceMs?: number;
  onError?: (id: string, error: unknown) => void;
};

type Waiting = { id: string; owner: string; opts: EnqueueOptions };

export class JobQueue {
  readonly #waiting: Waiting[] = [];
  readonly #active = new Map<string, Promise<void>>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #gates = new Map<string, Gate>();
  readonly #served = new Map<string, number>();
  readonly #idleWaiters: Array<() => void> = [];
  readonly #options: JobQueueOptions;
  #serveSeq = 0;

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
  /** Ordre de service prévu : tour à tour entre comptes (le moins récemment servi d'abord), FIFO à égalité. */
  #order(): Waiting[] {
    const pool = [...this.#waiting];
    const served = new Map(this.#served);
    let seq = this.#serveSeq;
    const out: Waiting[] = [];
    while (pool.length > 0) {
      let best = 0;
      for (let i = 1; i < pool.length; i++) {
        if (
          (served.get(pool[i].owner) ?? 0) < (served.get(pool[best].owner) ?? 0)
        )
          best = i;
      }
      const [next] = pool.splice(best, 1);
      served.set(next.owner, ++seq);
      out.push(next);
    }
    return out;
  }

  has(id: string): boolean {
    return this.#gates.has(id);
  }
  isWaiting(id: string): boolean {
    return this.#waiting.some((w) => w.id === id);
  }
  isActive(id: string): boolean {
    return this.#active.has(id);
  }
  /** Rang dans l'attente (1 = le prochain) ; `null` si la tâche n'attend pas. */
  position(id: string): number | null {
    const index = this.#order().findIndex((w) => w.id === id);
    return index < 0 ? null : index + 1;
  }
  snapshot(): { active: string[]; waiting: string[] } {
    return {
      active: [...this.#active.keys()],
      waiting: this.#order().map((w) => w.id),
    };
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

  enqueue(id: string, opts: EnqueueOptions = {}): QueueEntry {
    if (this.#gates.has(id))
      throw new Error("Analyse déjà en file ou en cours");
    const owner = opts.owner ?? `\0${id}`;
    const cap = this.#options.maxWaitingPerOwner?.();
    if (
      opts.owner !== undefined &&
      cap !== undefined &&
      Number.isFinite(cap) &&
      cap >= 0 &&
      this.#waiting.filter((w) => w.owner === owner).length >= cap
    )
      throw new QueueLimitError();
    const entry = gate();
    this.#gates.set(id, entry);
    this.#waiting.push({ id, owner, opts });
    this.pump();
    return { started: entry.promise };
  }

  /** Retire une tâche qui attend encore ; une tâche active ne se retire pas (on `abort` son travail). */
  remove(id: string): boolean {
    const index = this.#waiting.findIndex((w) => w.id === id);
    if (index < 0) return false;
    this.#waiting.splice(index, 1);
    this.#gates.get(id)?.resolve();
    this.#gates.delete(id);
    this.#notifyIdle();
    return true;
  }

  /** Demande l'arrêt d'une tâche active (son exécuteur tue le travail) ; faux si elle n'est pas active. */
  abort(id: string): boolean {
    const controller = this.#controllers.get(id);
    if (!controller || controller.signal.aborted) return false;
    controller.abort();
    return true;
  }

  /** Démarre autant de tâches que la concurrence le permet. Idempotent. */
  pump(): void {
    while (this.#waiting.length > 0 && this.#busy() < this.#limit()) {
      const next = this.#order()[0];
      this.#waiting.splice(this.#waiting.indexOf(next), 1);
      this.#served.set(next.owner, ++this.#serveSeq);
      this.#start(next);
    }
  }

  #start({ id, opts }: Waiting): void {
    const entry = this.#gates.get(id) as Gate;
    const controller = new AbortController();
    this.#controllers.set(id, controller);
    let finish!: () => void;
    this.#active.set(id, new Promise<void>((resolve) => (finish = resolve)));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let forced: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        const run = opts.run ?? this.#options.runner;
        const guards: Promise<void>[] = [
          run(id, {
            started: () => entry.resolve(),
            aborted: controller.signal,
          }),
        ];
        if (opts.timeoutMs && opts.timeoutMs > 0) {
          guards.push(
            new Promise<void>((_, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                forced = setTimeout(
                  () => reject(new WatchdogTimeoutError()),
                  this.#options.graceMs ?? 5000,
                );
              }, opts.timeoutMs as number);
            }),
          );
        }
        await Promise.race(guards);
        entry.resolve();
      } catch (error) {
        entry.reject(error);
        try {
          this.#options.onError?.(id, error);
        } catch {
          /* le rapport d'erreur ne doit pas faire tomber la file */
        }
      } finally {
        clearTimeout(timer);
        clearTimeout(forced);
        this.#controllers.delete(id);
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
