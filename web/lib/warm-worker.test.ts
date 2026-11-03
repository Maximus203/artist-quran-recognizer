import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { WarmWorkerPool, type JobProcess } from "./warm-worker";

// Faux worker : même protocole que `aqr worker` (une ligne JSON par requête et par réponse).
const FAKE = `
const rl = require("readline").createInterface({ input: process.stdin });
console.log(JSON.stringify({ event: "ready" }));
rl.on("line", (line) => {
  const { id, argv } = JSON.parse(line);
  const mode = argv[0];
  if (mode === "crash") process.exit(7);
  if (mode === "hang") return;
  if (mode === "noise") process.stdout.write("pas du json" + String.fromCharCode(10));
  const reply = { id, code: mode === "fail" ? 3 : 0, stdout: "out:" + argv.join(","), stderr: mode === "fail" ? "boom" : "", pid: process.pid };
  console.log(JSON.stringify(reply));
});
`;

let dir = "";
let script = "";
const pools: WarmWorkerPool[] = [];
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-warm-"));
  script = path.join(dir, "fake-worker.cjs");
  await writeFile(script, FAKE);
});
afterEach(() => {
  for (const pool of pools.splice(0)) pool.shutdown();
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makePool(maxIdle = 1) {
  let spawned = 0;
  const pool = new WarmWorkerPool({
    spawnWorker: () => {
      spawned += 1;
      return spawn(process.execPath, [script], { stdio: "pipe" });
    },
    maxIdle: () => maxIdle,
  });
  pools.push(pool);
  return { pool, spawned: () => spawned };
}

function outcome(run: JobProcess) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      let stdout = "";
      let stderr = "";
      run.stdout?.on("data", (c: Buffer) => (stdout += c.toString()));
      run.stderr?.on("data", (c: Buffer) => (stderr += c.toString()));
      run.on("close", (code) => resolve({ code, stdout, stderr }));
    },
  );
}

describe("WarmWorkerPool", () => {
  it("rend la sortie et le code, comme un processus", async () => {
    const { pool } = makePool();
    const result = await outcome(pool.start(["recognize", "a.wav"]));
    expect(result).toEqual({
      code: 0,
      stdout: "out:recognize,a.wav",
      stderr: "",
    });
  });

  it("réutilise le même processus d'une analyse à l'autre (modèle chargé une fois)", async () => {
    const { pool, spawned } = makePool();
    const first = pool.start(["recognize", "1"]);
    const pidFirst = first.pid;
    await outcome(first);
    const second = pool.start(["recognize", "2"]);
    expect(second.pid).toBe(pidFirst);
    await outcome(second);
    expect(spawned()).toBe(1);
  });

  it("relaie le code d'échec et le message", async () => {
    const { pool } = makePool();
    const result = await outcome(pool.start(["fail"]));
    expect(result.code).toBe(3);
    expect(result.stderr).toBe("boom");
  });

  it("un worker qui meurt en cours de route échoue le job sans bloquer le suivant", async () => {
    const { pool, spawned } = makePool();
    const crashed = await outcome(pool.start(["crash"]));
    expect(crashed.code).toBe(7);
    expect(crashed.stderr).toMatch(/worker|moteur/i);
    const next = await outcome(pool.start(["recognize", "x"]));
    expect(next.code).toBe(0);
    expect(spawned()).toBe(2);
  });

  it("tuer un job en cours tue son worker ; le suivant repart d'un worker neuf", async () => {
    const { pool, spawned } = makePool();
    const hung = pool.start(["hang"]);
    const closed = outcome(hung);
    expect(hung.kill()).toBe(true);
    const result = await closed;
    expect(result.code).not.toBe(0);
    const next = await outcome(pool.start(["recognize", "y"]));
    expect(next.code).toBe(0);
    expect(spawned()).toBe(2);
  });

  it("ignore une ligne de sortie qui n'est pas du protocole", async () => {
    const { pool } = makePool();
    const result = await outcome(pool.start(["noise"]));
    expect(result.code).toBe(0);
  });

  it("deux jobs en même temps utilisent deux workers distincts", async () => {
    const { pool, spawned } = makePool(2);
    const a = pool.start(["recognize", "a"]);
    const b = pool.start(["recognize", "b"]);
    expect(a.pid).not.toBe(b.pid);
    await Promise.all([outcome(a), outcome(b)]);
    expect(spawned()).toBe(2);
  });

  it("ne garde pas plus de workers au repos que le plafond", async () => {
    const { pool } = makePool(1);
    const a = pool.start(["recognize", "a"]);
    const b = pool.start(["recognize", "b"]);
    await Promise.all([outcome(a), outcome(b)]);
    expect(pool.idleCount()).toBe(1);
  });

  it("une erreur de lancement (interpréteur absent) se dit en clair", async () => {
    const pool = new WarmWorkerPool({
      spawnWorker: () =>
        spawn("/chemin/inexistant/python", [], { stdio: "pipe" }),
      maxIdle: () => 1,
    });
    pools.push(pool);
    const result = await outcome(pool.start(["recognize", "z"]));
    expect(result.code).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
