import { describe, expect, it, vi } from "vitest";
import {
  JobQueue,
  QueueLimitError,
  WatchdogTimeoutError,
  type JobRunner,
} from "./queue";

const tick = (ms = 5) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function manual() {
  const started: string[] = [];
  const done = new Map<string, () => void>();
  const runner: JobRunner = async (id, signal) => {
    started.push(id);
    signal.started();
    await new Promise<void>((resolve) => done.set(id, resolve));
  };
  return { runner, started, finish: (id: string) => done.get(id)?.() };
}

describe("JobQueue — une pile, équité entre comptes", () => {
  it("un compte qui dépose 3 jobs ne passe pas devant un autre compte", async () => {
    const m = manual();
    const q = new JobQueue({ runner: m.runner, concurrency: () => 1 });
    q.enqueue("a1", { owner: "A" });
    q.enqueue("a2", { owner: "A" });
    q.enqueue("a3", { owner: "A" });
    q.enqueue("b1", { owner: "B" });
    await tick();
    expect(q.position("b1")).toBe(1);
    expect(q.position("a2")).toBe(2);
    m.finish("a1");
    await tick();
    expect(m.started).toEqual(["a1", "b1"]);
    m.finish("b1");
    await tick();
    expect(m.started).toEqual(["a1", "b1", "a2"]);
  });

  it("plafonne les jobs en attente par compte", () => {
    const m = manual();
    const q = new JobQueue({
      runner: m.runner,
      concurrency: () => 1,
      maxWaitingPerOwner: () => 2,
    });
    q.enqueue("a1", { owner: "A" }); // actif
    q.enqueue("a2", { owner: "A" });
    q.enqueue("a3", { owner: "A" });
    expect(() => q.enqueue("a4", { owner: "A" })).toThrow(QueueLimitError);
    expect(() => q.enqueue("b1", { owner: "B" })).not.toThrow();
    expect(q.has("a4")).toBe(false);
  });

  it("50 dépôts dans le même tick : aucune place doublée, ordre stable", async () => {
    const m = manual();
    const q = new JobQueue({ runner: m.runner, concurrency: () => 1 });
    const ids = Array.from({ length: 50 }, (_, i) => `j${i}`);
    for (const id of ids) q.enqueue(id);
    await tick();
    expect(m.started).toEqual(["j0"]);
    for (const id of ids.slice(0, 49)) {
      m.finish(id);
      await tick(1);
    }
    expect(m.started).toEqual(ids);
    expect(new Set(m.started).size).toBe(50);
  });

  it("une tâche à exécuteur propre partage la même place (analyse + vidéo)", async () => {
    const m = manual();
    const log: string[] = [];
    const q = new JobQueue({ runner: m.runner, concurrency: () => 1 });
    q.enqueue("analyse");
    q.enqueue("video", {
      run: async (id, signal) => {
        log.push(id);
        signal.started();
      },
    });
    await tick();
    expect(log).toEqual([]);
    m.finish("analyse");
    await q.idle();
    expect(log).toEqual(["video"]);
  });
});

describe("JobQueue — watchdog et annulation", () => {
  it("coupe un job figé, libère la place et passe au suivant", async () => {
    const aborted = vi.fn();
    const onError = vi.fn();
    const started: string[] = [];
    const runner: JobRunner = async (id, signal) => {
      started.push(id);
      signal.started();
      if (id === "stuck") {
        signal.aborted.addEventListener("abort", aborted);
        await new Promise(() => undefined); // ne rend jamais la main
      }
    };
    const q = new JobQueue({
      runner,
      concurrency: () => 1,
      graceMs: 10,
      onError,
    });
    q.enqueue("stuck", { timeoutMs: 20 });
    q.enqueue("next");
    await q.idle();
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(started).toEqual(["stuck", "next"]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toBeInstanceOf(WatchdogTimeoutError);
  });

  it("annule un job actif : le signal part, la place est rendue à la fin", async () => {
    const q = new JobQueue({
      runner: async (_id, signal) => {
        signal.started();
        await new Promise<void>((resolve) =>
          signal.aborted.addEventListener("abort", () => resolve()),
        );
      },
      concurrency: () => 1,
    });
    q.enqueue("a");
    await tick();
    expect(q.abort("a")).toBe(true);
    await q.idle();
    expect(q.isActive("a")).toBe(false);
    expect(q.abort("a")).toBe(false);
  });
});
