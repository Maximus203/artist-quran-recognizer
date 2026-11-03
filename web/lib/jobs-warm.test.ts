import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancel, jobQueue, jobSettled, launch, warmEnabled } from "./jobs";
import { resetSharedQueue } from "./queue";
import { readSession, saveSession, sessionDir, type Session } from "./store";
import { WarmWorkerPool } from "./warm-worker";

// Faux `aqr worker` : même protocole, écrit la sortie de reconnaissance comme le vrai moteur.
const WORKER = `
const fs = require("fs"), crypto = require("crypto"), path = require("path");
const rl = require("readline").createInterface({ input: process.stdin });
console.log(JSON.stringify({ event: "ready" }));
rl.on("line", (line) => {
  const { id, argv } = JSON.parse(line);
  const source = argv[1], out = argv[argv.indexOf("--out-dir") + 1];
  const mode = process.env.FAKE_MODE || "ok";
  if (mode === "hang") return;
  if (mode === "fail") {
    console.log(JSON.stringify({ id, code: 3, stdout: "", stderr: "boom: modele introuvable" }));
    return;
  }
  const hash = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
  fs.writeFileSync(path.join(out, "source.recognition.json"), JSON.stringify({
    schema: "aqr.recognition/1",
    source: { file: "source.mp3", sha256: hash, duration_s: 5 },
    engine: { asr: "w", segmenter: "s", matcher: "m", decoder: "d", constrained: false, corpus: "c" },
    decoder: {}, timing: {}, windows: 1, warnings: [], intervals: [],
  }));
  console.log(JSON.stringify({ id, code: 0, stdout: "ok", stderr: "" }));
});
`;
const BYTES = Buffer.from("fake-audio");
const ID = "0f0e0d0c-0b0a-4908-8706-050403020101";
const POOL = Symbol.for("aqr.warm-pool");

let tmp: string;
let spawned = 0;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-warm-jobs-"));
  const script = path.join(tmp, "worker.cjs");
  await writeFile(script, WORKER);
  spawned = 0;
  (globalThis as { [POOL]?: WarmWorkerPool })[POOL] = new WarmWorkerPool({
    spawnWorker: () => {
      spawned += 1;
      return spawn(process.execPath, [script], { stdio: "pipe" });
    },
    maxIdle: () => 1,
  });
  vi.stubEnv("AQR_REVIEW_DIR", path.join(tmp, "review"));
  vi.stubEnv("AQR_PYTHON", "python-factice");
  vi.stubEnv("AQR_MODELS_DIR", path.join(tmp, "models"));
});
afterEach(async () => {
  await jobSettled(ID);
  await jobQueue().idle();
  resetSharedQueue();
  (globalThis as { [POOL]?: WarmWorkerPool })[POOL]?.shutdown();
  delete (globalThis as { [POOL]?: WarmWorkerPool })[POOL];
  vi.unstubAllEnvs();
  await rm(tmp, { recursive: true, force: true });
});

async function seed(over: Partial<Session> = {}): Promise<void> {
  const { createHash } = await import("node:crypto");
  await saveSession({
    id: ID,
    name: "a.mp3",
    extension: ".mp3",
    audio_sha256: createHash("sha256").update(BYTES).digest("hex"),
    size: BYTES.length,
    source_kind: "file",
    created_at: "2026-10-01T00:00:00.000Z",
    state: "ready",
    error: null,
    started_at: null,
    finished_at: null,
    prediction_sha256: null,
    pid: null,
    ...over,
  });
  await writeFile(path.join(sessionDir(ID), "source.mp3"), BYTES);
}
async function settle(): Promise<Session> {
  await jobSettled(ID);
  return readSession(ID);
}

describe("analyse par le worker chaud", () => {
  it("n'est active que pour l'interpréteur Python habituel", () => {
    const run = (command: string) => ({
      command,
      args: ["-m", "aqr.cli", "recognize"],
      env: process.env,
    });
    expect(warmEnabled(run("python-factice"))).toBe(true);
    expect(warmEnabled(run("autre"))).toBe(false);
    vi.stubEnv("AQR_WARM_WORKER", "0");
    expect(warmEnabled(run("python-factice"))).toBe(false);
  });

  it("deux analyses de suite réutilisent le même worker", async () => {
    await seed();
    await launch(ID);
    expect((await settle()).state).toBe("done");
    await seed({ state: "ready" });
    await launch(ID);
    const second = await settle();
    expect(second.state).toBe("done");
    expect(second.prediction_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(spawned).toBe(1);
  });

  it("un échec du moteur remonte son message", async () => {
    vi.stubEnv("FAKE_MODE", "fail");
    await seed();
    await launch(ID);
    const failed = await settle();
    expect(failed.state).toBe("failed");
    expect(failed.error).toMatch(/boom: modele introuvable/);
  });

  it("annuler une analyse en cours arrête le worker et libère la place", async () => {
    vi.stubEnv("FAKE_MODE", "hang");
    await seed();
    await launch(ID);
    expect((await readSession(ID)).state).toBe("running");
    await cancel(ID);
    expect((await settle()).state).toBe("cancelled");
    vi.stubEnv("FAKE_MODE", "ok");
    await seed({ state: "ready" });
    await launch(ID);
    expect((await settle()).state).toBe("done");
    expect(spawned).toBe(2); // le worker tué n'est pas réutilisé
  });
});
