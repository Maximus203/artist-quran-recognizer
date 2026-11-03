import { describe, expect, it } from "vitest";
import { JobQueue, type JobRunner } from "./queue";

type Deferred = { promise: Promise<void>; resolve: () => void };
function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

/** Exécuteur contrôlable : chaque tâche reste « en cours » jusqu'à `finish(id)`. */
function manualRunner() {
  const started: string[] = [];
  const gates = new Map<string, Deferred>();
  const runner: JobRunner = async (id, signal) => {
    started.push(id);
    gates.set(id, deferred());
    signal.started();
    await gates.get(id)!.promise;
  };
  return {
    runner,
    started,
    finish: (id: string) => gates.get(id)?.resolve(),
  };
}

describe("JobQueue — ordre et concurrence", () => {
  it("démarre tout de suite quand une place est libre", async () => {
    const m = manualRunner();
    const queue = new JobQueue({ runner: m.runner, concurrency: () => 1 });
    const entry = queue.enqueue("a");
    await entry.started;
    expect(m.started).toEqual(["a"]);
    expect(queue.isActive("a")).toBe(true);
    expect(queue.position("a")).toBeNull();
  });

  it("FIFO : le suivant ne démarre que quand le précédent est fini", async () => {
    const m = manualRunner();
    const queue = new JobQueue({ runner: m.runner, concurrency: () => 1 });
    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");
    await tick();
    expect(m.started).toEqual(["a"]);
    expect(queue.position("b")).toBe(1);
    expect(queue.position("c")).toBe(2);
    m.finish("a");
    await tick();
    expect(m.started).toEqual(["a", "b"]);
    expect(queue.position("c")).toBe(1);
    m.finish("b");
    await tick();
    m.finish("c");
    await queue.idle();
    expect(m.started).toEqual(["a", "b", "c"]);
    expect(queue.snapshot()).toEqual({ active: [], waiting: [] });
  });

  it("respecte une concurrence de 2", async () => {
    const m = manualRunner();
    const queue = new JobQueue({ runner: m.runner, concurrency: () => 2 });
    for (const id of ["a", "b", "c", "d"]) queue.enqueue(id);
    await tick();
    expect(m.started).toEqual(["a", "b"]);
    m.finish("b");
    await tick();
    expect(m.started).toEqual(["a", "b", "c"]);
  });

  it("une concurrence invalide retombe sur 1 ; elle est relue à chaque démarrage", async () => {
    const m = manualRunner();
    let limit = Number.NaN;
    const queue = new JobQueue({ runner: m.runner, concurrency: () => limit });
    queue.enqueue("a");
    queue.enqueue("b");
    await tick();
    expect(m.started).toEqual(["a"]);
    limit = 2;
    queue.enqueue("c");
    await tick();
    expect(m.started).toEqual(["a", "b"]);
  });

  it("une place occupée hors de la file (processus orphelin) retient le suivant", async () => {
    const m = manualRunner();
    let outside = 1;
    const queue = new JobQueue({
      runner: m.runner,
      concurrency: () => 1,
      externalBusy: () => outside,
    });
    queue.enqueue("a");
    await tick();
    expect(m.started).toEqual([]);
    outside = 0;
    queue.pump();
    await tick();
    expect(m.started).toEqual(["a"]);
  });
});

describe("JobQueue — sûreté", () => {
  it("refuse un identifiant déjà présent (attente ou actif), sans doublon", async () => {
    const m = manualRunner();
    const queue = new JobQueue({ runner: m.runner, concurrency: () => 1 });
    queue.enqueue("a");
    queue.enqueue("b");
    expect(() => queue.enqueue("a")).toThrow(/déjà/);
    expect(() => queue.enqueue("b")).toThrow(/déjà/);
    expect(queue.snapshot()).toEqual({ active: ["a"], waiting: ["b"] });
  });

  it("retirer une tâche en attente la supprime ; une tâche active ne se retire pas", async () => {
    const m = manualRunner();
    const queue = new JobQueue({ runner: m.runner, concurrency: () => 1 });
    queue.enqueue("a");
    const b = queue.enqueue("b");
    queue.enqueue("c");
    expect(queue.remove("b")).toBe(true);
    await b.started; // libérée : n'attend pas indéfiniment
    expect(queue.remove("a")).toBe(false);
    expect(queue.remove("zzz")).toBe(false);
    expect(queue.position("c")).toBe(1);
    m.finish("a");
    await tick();
    expect(m.started).toEqual(["a", "c"]);
  });

  it("une erreur du runner libère la place, démarre la suivante et reste gérée", async () => {
    const seen: unknown[] = [];
    const record = (error: unknown) => seen.push(error);
    process.on("unhandledRejection", record);
    try {
      const order: string[] = [];
      const errors: string[] = [];
      const runner: JobRunner = async (id) => {
        order.push(id);
        if (id === "a") throw new Error("boom");
      };
      const queue = new JobQueue({
        runner,
        concurrency: () => 1,
        onError: (id) => errors.push(id),
      });
      const a = queue.enqueue("a");
      queue.enqueue("b");
      await expect(a.started).rejects.toThrow("boom");
      await queue.idle();
      await tick();
      expect(order).toEqual(["a", "b"]);
      expect(errors).toEqual(["a"]);
      expect(seen).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
    }
  });

  it("un runner qui jette de façon synchrone est traité comme un échec", async () => {
    const runner: JobRunner = () => {
      throw new Error("sync");
    };
    const queue = new JobQueue({ runner, concurrency: () => 1 });
    const a = queue.enqueue("a");
    await expect(a.started).rejects.toThrow("sync");
    await queue.idle();
    expect(queue.snapshot()).toEqual({ active: [], waiting: [] });
  });

  it("started se résout aussi quand le runner finit sans l'avoir signalé", async () => {
    const queue = new JobQueue({
      runner: async () => undefined,
      concurrency: () => 1,
    });
    await expect(queue.enqueue("a").started).resolves.toBeUndefined();
  });

  it("settled(id) se résout à la fin du runner et jamais pour une tâche inconnue", async () => {
    const m = manualRunner();
    const queue = new JobQueue({ runner: m.runner, concurrency: () => 1 });
    queue.enqueue("a");
    await tick();
    let done = false;
    void queue.settled("a")!.then(() => (done = true));
    await tick();
    expect(done).toBe(false);
    m.finish("a");
    await queue.idle();
    expect(done).toBe(true);
    expect(queue.settled("a")).toBeUndefined();
  });

  it("deux enqueue dans le même tick : un seul démarre, l'ordre d'arrivée est gardé", async () => {
    const m = manualRunner();
    const queue = new JobQueue({ runner: m.runner, concurrency: () => 1 });
    const ids = Array.from({ length: 20 }, (_, i) => `j${i}`);
    for (const id of ids) queue.enqueue(id);
    await tick();
    expect(m.started).toEqual(["j0"]);
    for (const id of ids) {
      m.finish(id);
      await tick();
    }
    await queue.idle();
    expect(m.started).toEqual(ids);
  });

  it("wouldStartNow : vrai seulement si une place est libre et que personne n'attend", async () => {
    const m = manualRunner();
    const queue = new JobQueue({ runner: m.runner, concurrency: () => 1 });
    expect(queue.wouldStartNow()).toBe(true);
    queue.enqueue("a");
    expect(queue.wouldStartNow()).toBe(false);
  });
});
