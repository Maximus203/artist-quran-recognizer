import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  jobQueue,
  recoverQueue,
  resetOrphans,
  resetQueueRecovery,
} from "./jobs";
import { resetSharedQueue } from "./queue";
import { readSession, saveSession, sessionDir, type Session } from "./store";

const BYTES = Buffer.from("fake-audio");
const SHA = createHash("sha256").update(BYTES).digest("hex");
const ids = {
  nopid: "1f0e0d0c-0b0a-4908-8706-050403020101",
  dead: "1f0e0d0c-0b0a-4908-8706-050403020102",
  finished: "1f0e0d0c-0b0a-4908-8706-050403020103",
  alive: "1f0e0d0c-0b0a-4908-8706-050403020104",
  stale: "1f0e0d0c-0b0a-4908-8706-050403020105",
};
let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-orphans-"));
  vi.stubEnv("AQR_REVIEW_DIR", path.join(tmp, "review"));
  resetSharedQueue();
  resetQueueRecovery();
  resetOrphans();
});
afterEach(async () => {
  resetSharedQueue();
  resetOrphans();
  vi.unstubAllEnvs();
  await rm(tmp, { recursive: true, force: true });
});

async function seed(id: string, over: Partial<Session>): Promise<void> {
  await saveSession({
    id,
    name: "a.mp3",
    extension: ".mp3",
    audio_sha256: SHA,
    size: BYTES.length,
    source_kind: "file",
    created_at: "2026-10-01T00:00:00.000Z",
    state: "running",
    error: null,
    started_at: new Date().toISOString(),
    finished_at: null,
    prediction_sha256: null,
    pid: null,
    ...over,
  });
  await writeFile(path.join(sessionDir(id), "source.mp3"), BYTES);
}
/** `session.json` tel qu'il est sur le disque : aucune sonde de `readSession` ne passe par là. */
async function onDisk(id: string): Promise<Session> {
  return JSON.parse(
    await readFile(path.join(sessionDir(id), "session.json"), "utf8"),
  ) as Session;
}
/** Un PID qui n'existe plus : celui d'un processus de test déjà terminé. */
async function deadPid(): Promise<number> {
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, ["-e", "0"]);
  await new Promise((resolve) => child.on("close", resolve));
  return child.pid as number;
}

describe("analyses « running » laissées par un serveur précédent", () => {
  it("sans pid : échec explicite, lisible, la file n'est pas bloquée", async () => {
    await seed(ids.nopid, { pid: null });
    await recoverQueue();
    const session = await readSession(ids.nopid);
    expect(session.state).toBe("failed");
    expect(session.error).toMatch(/redémarr|interrompu/i);
    expect(session.finished_at).not.toBeNull();
    expect(jobQueue().wouldStartNow()).toBe(true);
  });

  it("pid mort : échec explicite dès la reprise, sans attendre une lecture", async () => {
    await seed(ids.dead, { pid: await deadPid() });
    await recoverQueue();
    const session = await onDisk(ids.dead);
    expect(session.state).toBe("failed");
    expect(session.pid).toBeNull();
  });

  it("la sortie était déjà écrite avant l'arrêt : l'analyse est terminée, pas en échec", async () => {
    await seed(ids.finished, { pid: await deadPid() });
    await writeFile(
      path.join(sessionDir(ids.finished), "source.recognition.json"),
      JSON.stringify({
        schema: "aqr.recognition/1",
        source: { file: "source.mp3", sha256: SHA, duration_s: 5 },
        engine: {
          asr: "w",
          segmenter: "s",
          matcher: "m",
          decoder: "d",
          constrained: false,
          corpus: "c",
        },
        decoder: {},
        timing: {},
        windows: 1,
        warnings: [],
        intervals: [],
      }),
    );
    await recoverQueue();
    expect((await onDisk(ids.finished)).state).toBe("done");
  });

  it("processus encore vivant et récent : il garde sa place", async () => {
    await seed(ids.alive, { pid: process.pid });
    await recoverQueue();
    expect((await readSession(ids.alive)).state).toBe("running");
    expect(jobQueue().wouldStartNow()).toBe(false);
  });

  it("processus vivant mais plus vieux que le délai maximal : abandonné (pid recyclé possible)", async () => {
    vi.stubEnv("AQR_JOB_TIMEOUT_S", "60");
    await seed(ids.stale, {
      pid: process.pid,
      started_at: new Date(Date.now() - 3600_000).toISOString(),
    });
    await recoverQueue();
    const session = await readSession(ids.stale);
    expect(session.state).toBe("failed");
    expect(session.error).toMatch(/délai/i);
    expect(jobQueue().wouldStartNow()).toBe(true);
  });
});
