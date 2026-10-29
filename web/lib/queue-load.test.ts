import { describe, expect, it, vi } from "vitest";
import {
  JobQueue,
  QueueLimitError,
  WatchdogTimeoutError,
  type JobRunner,
} from "./queue";

/**
 * Test de charge de la file avec des jobs factices (aucun modèle). Les numéros renvoient aux
 * scénarios de la section 14 de docs/SECURITE-PRE-DEPLOIEMENT.md.
 */
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exécuteur qui mesure le nombre de jobs simultanés et note l'ordre de démarrage. */
function probe(work: (id: string) => number) {
  let running = 0;
  let peak = 0;
  const started: string[] = [];
  const runner: JobRunner = async (id, signal) => {
    running += 1;
    peak = Math.max(peak, running);
    started.push(id);
    signal.started();
    try {
      await pause(work(id));
    } finally {
      running -= 1;
    }
  };
  return { runner, started, peak: () => peak };
}

describe("charge de la file", () => {
  it("1 · 50 soumissions simultanées : une place, aucun doublon, ordre FIFO", async () => {
    const p = probe(() => 1);
    const q = new JobQueue({ runner: p.runner, concurrency: () => 1 });
    const ids = Array.from({ length: 50 }, (_, i) => `j${i}`);
    for (const id of ids) q.enqueue(id);
    await q.idle();
    expect(p.started).toEqual(ids);
    expect(p.peak()).toBe(1);
  });

  it("1 bis · 200 jobs de 10 comptes, 2 places : jamais plus de 2, chacun une seule fois", async () => {
    const p = probe((id) => 1 + (id.length % 3));
    const q = new JobQueue({ runner: p.runner, concurrency: () => 2 });
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) {
      const id = `u${i % 10}-${i}`;
      ids.push(id);
      q.enqueue(id, { owner: `u${i % 10}` });
    }
    await q.idle();
    expect(p.peak()).toBeLessThanOrEqual(2);
    expect([...p.started].sort()).toEqual([...ids].sort());
    expect(new Set(p.started).size).toBe(200);
    // Équité : dans toute fenêtre de 10 démarrages consécutifs, chaque compte passe exactement une fois.
    for (let i = 0; i + 10 <= 200; i += 10) {
      const owners = p.started.slice(i, i + 10).map((id) => id.split("-")[0]);
      expect(new Set(owners).size).toBe(10);
    }
  });

  it("2 · un compte envoie 30 fichiers pendant que d'autres attendent : les autres passent vite", async () => {
    const p = probe(() => 5);
    const q = new JobQueue({
      runner: p.runner,
      concurrency: () => 1,
      maxWaitingPerOwner: () => 5,
    });
    let refused = 0;
    for (let i = 0; i < 30; i++) {
      try {
        q.enqueue(`a${i}`, { owner: "A" });
      } catch (error) {
        if (error instanceof QueueLimitError) refused += 1;
      }
    }
    q.enqueue("b0", { owner: "B" });
    q.enqueue("c0", { owner: "C" });
    expect(refused).toBe(30 - 6); // 1 actif + 5 en attente
    await q.idle();
    // B et C passent juste après le job actif de A, pas après ses 5 jobs en attente.
    expect(p.started.indexOf("b0")).toBeLessThanOrEqual(2);
    expect(p.started.indexOf("c0")).toBeLessThanOrEqual(3);
  });

  it("4 · un job qui meurt en pleine exécution : la file avance, l'échec est signalé", async () => {
    const failures: string[] = [];
    const started: string[] = [];
    const q = new JobQueue({
      runner: async (id, signal) => {
        started.push(id);
        signal.started();
        if (id === "crash") throw new Error("mémoire saturée");
        await pause(1);
      },
      concurrency: () => 1,
      onError: (id) => failures.push(id),
    });
    q.enqueue("crash");
    q.enqueue("after");
    await q.idle();
    expect(failures).toEqual(["crash"]);
    expect(started).toEqual(["crash", "after"]);
  });

  it("6 · annulation en file puis en cours : les places sont rendues", async () => {
    const started: string[] = [];
    const q = new JobQueue({
      runner: async (id, signal) => {
        started.push(id);
        signal.started();
        await new Promise<void>((resolve) => {
          signal.aborted.addEventListener("abort", () => resolve());
          if (id === "last") resolve();
        });
      },
      concurrency: () => 1,
    });
    q.enqueue("run");
    q.enqueue("wait");
    q.enqueue("last");
    await pause(5);
    expect(q.remove("wait")).toBe(true); // en file
    expect(q.abort("run")).toBe(true); // en cours
    await q.idle();
    expect(started).toEqual(["run", "last"]);
    expect(q.snapshot()).toEqual({ active: [], waiting: [] });
  });

  it("9 · un job figé est arrêté par le watchdog et débloque la pile entière", async () => {
    const started: string[] = [];
    const errors: unknown[] = [];
    const q = new JobQueue({
      runner: async (id, signal) => {
        started.push(id);
        signal.started();
        if (id.startsWith("stuck")) await new Promise(() => undefined);
      },
      concurrency: () => 1,
      graceMs: 5,
      onError: (_id, error) => errors.push(error),
    });
    q.enqueue("stuck1", { timeoutMs: 10 });
    q.enqueue("stuck2", { timeoutMs: 10 });
    q.enqueue("fine");
    await q.idle();
    expect(started).toEqual(["stuck1", "stuck2", "fine"]);
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e instanceof WatchdogTimeoutError)).toBe(true);
  });

  it("11 · deux onglets du même compte : le même job n'entre jamais deux fois", async () => {
    const p = probe(() => 5);
    const q = new JobQueue({ runner: p.runner, concurrency: () => 1 });
    q.enqueue("s1", { owner: "A" });
    expect(() => q.enqueue("s1", { owner: "A" })).toThrow(/déjà en file/);
    await q.idle();
    expect(p.started).toEqual(["s1"]);
  });

  it("les erreurs d'un exécuteur ne laissent aucun rejet non géré", async () => {
    const seen: unknown[] = [];
    const record = (e: unknown) => seen.push(e);
    process.on("unhandledRejection", record);
    const q = new JobQueue({
      runner: async () => {
        throw new Error("boom");
      },
      concurrency: () => 2,
    });
    for (let i = 0; i < 20; i++) q.enqueue(`e${i}`);
    await q.idle();
    await pause(10);
    process.off("unhandledRejection", record);
    expect(seen).toEqual([]);
  });

  it("la concurrence relue à chaque démarrage s'applique sans recréer la file", async () => {
    let limit = 1;
    const p = probe(() => 8);
    const q = new JobQueue({ runner: p.runner, concurrency: () => limit });
    for (let i = 0; i < 6; i++) q.enqueue(`c${i}`);
    await pause(2);
    limit = 3;
    q.pump();
    await q.idle();
    expect(p.peak()).toBe(3);
  });
});

vi.setConfig({ testTimeout: 20_000 });
