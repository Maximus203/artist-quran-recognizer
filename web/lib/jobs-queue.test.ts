import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cancel,
  ensureQueueRecovered,
  jobQueue,
  launch,
  maxConcurrent,
  recoverQueue,
  resetQueueRecovery,
} from "./jobs";
import { resetSharedQueue } from "./queue";
import {
  deleteSession,
  jobs,
  readSession,
  saveSession,
  sessionDir,
  type Session,
} from "./store";

// Faux moteur portable (lancé par Node, voir jobs.test.ts). `mode.txt` dans le dossier de session
// pilote son comportement : `hold` attend le fichier `release`, `fail` sort en erreur, sinon réussit.
vi.mock("./python", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./python")>();
  return {
    ...actual,
    recognizeCommand: (
      ...input: Parameters<typeof actual.recognizeCommand>
    ) => {
      const run = actual.recognizeCommand(...input);
      return run.command.endsWith("fake-engine.cjs")
        ? {
            ...run,
            command: process.execPath,
            args: [run.command, ...run.args],
          }
        : run;
    },
  };
});

const FAKE = `
const fs = require("fs"), crypto = require("crypto"), path = require("path");
const a = process.argv.slice(2);
const source = a[3], out = a[a.indexOf("--out-dir") + 1];
const id = path.basename(out);
const log = (event) => fs.appendFileSync(process.env.FAKE_LOG, event + " " + id + " " + Date.now() + "\\n");
const modeFile = path.join(out, "mode.txt");
const mode = fs.existsSync(modeFile) ? fs.readFileSync(modeFile, "utf8").trim() : "ok";
log("start");
const finish = () => {
  if (mode === "fail") { console.error("boom: modèle introuvable"); log("end"); process.exit(3); }
  const hash = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
  fs.writeFileSync(path.join(out, "source.recognition.json"), JSON.stringify({
    schema: "aqr.recognition/1",
    source: { file: "source.mp3", sha256: hash, duration_s: 600 },
    engine: { asr: "cascade(fastconformer-quran@b33a)", segmenter: "s", matcher: "m", decoder: "d", constrained: false, corpus: "c" },
    decoder: {}, timing: {}, windows: 1, warnings: [], intervals: [],
  }));
  log("end");
};
if (mode === "hold") {
  const wait = () => fs.existsSync(path.join(out, "release")) ? finish() : setTimeout(wait, 15);
  wait();
} else finish();
`;

const ID = (n: number) =>
  `0f0e0d0c-0b0a-4908-8706-0504030201${String(n).padStart(2, "0")}`;
const [A, B, C, D] = [ID(1), ID(2), ID(3), ID(4)];

let tmp: string;
let log: string;
const orphans: ChildProcess[] = [];
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-queue-"));
  const fake = path.join(tmp, "fake-engine.cjs");
  log = path.join(tmp, "events.log");
  await writeFile(fake, FAKE);
  await writeFile(log, "");
  vi.stubEnv("AQR_REVIEW_DIR", path.join(tmp, "review"));
  vi.stubEnv("AQR_PYTHON", fake);
  vi.stubEnv("AQR_MODELS_DIR", path.join(tmp, "models"));
  vi.stubEnv("FAKE_LOG", log);
  vi.stubEnv("AQR_MAX_CONCURRENT", "");
  resetQueueRecovery();
});
afterEach(async () => {
  for (const id of [A, B, C, D]) await release(id);
  for (const child of orphans.splice(0)) child.kill();
  await jobQueue().idle();
  resetSharedQueue();
  vi.unstubAllEnvs();
  await rm(tmp, { recursive: true, force: true });
});

async function seed(
  id: string,
  mode: "ok" | "hold" | "fail" = "hold",
  over: Partial<Session> = {},
): Promise<void> {
  const bytes = Buffer.from(`audio-${id}`);
  await saveSession({
    id,
    name: `${id.slice(-2)}.mp3`,
    extension: ".mp3",
    audio_sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    source_kind: "file",
    created_at: "2026-10-22T08:00:00.000Z",
    state: "ready",
    error: null,
    started_at: null,
    finished_at: null,
    prediction_sha256: null,
    pid: null,
    ...over,
  });
  await writeFile(path.join(sessionDir(id), "source.mp3"), bytes);
  await writeFile(path.join(sessionDir(id), "mode.txt"), mode);
}
async function release(id: string): Promise<void> {
  try {
    await writeFile(path.join(sessionDir(id), "release"), "1");
  } catch {
    /* session absente */
  }
}
async function events(): Promise<
  Array<{ event: string; id: string; at: number }>
> {
  return (await readFile(log, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [event, id, at] = line.split(" ");
      return { event, id, at: Number(at) };
    });
}
const until = async (
  predicate: () => Promise<boolean> | boolean,
  ms = 8000,
) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("condition jamais atteinte");
};
const state = async (id: string) => (await readSession(id)).state;
const startedIds = async () =>
  (await events()).filter((e) => e.event === "start").map((e) => e.id);
const finished = async (id: string) => {
  await until(
    async () => (await state(id)) === "done" || (await state(id)) === "failed",
  );
  return readSession(id);
};

describe("file FIFO : une analyse à la fois", () => {
  it("trois lancements : la première tourne, les deux autres attendent dans l'ordre", async () => {
    await seed(A);
    await seed(B);
    await seed(C);
    const first = await launch(A);
    const second = await launch(B);
    const third = await launch(C);
    expect(first).toEqual({ state: "running", queue_position: null });
    expect(second).toEqual({ state: "queued", queue_position: 1 });
    expect(third).toEqual({ state: "queued", queue_position: 2 });
    const waiting = await readSession(B);
    expect(waiting.state).toBe("queued");
    expect(waiting.queued_at).toEqual(expect.any(String));
    expect(waiting.asr).toBe("cascade");
    expect(waiting.pid).toBeNull();
    await until(async () => (await startedIds()).length >= 1);
    expect(await startedIds()).toEqual([A]);
  });

  it("jamais deux moteurs en même temps, démarrage dans l'ordre, chacun fini avant le suivant", async () => {
    await seed(A);
    await seed(B);
    await seed(C);
    await launch(A);
    await launch(B);
    await launch(C);
    for (const id of [A, B, C]) {
      await until(async () => (await startedIds()).includes(id));
      await release(id);
      await finished(id);
    }
    const log = await events();
    expect(log.map((e) => `${e.event}:${e.id.slice(-2)}`)).toEqual([
      "start:01", "end:01", "start:02", "end:02", "start:03", "end:03",
    ]); // prettier-ignore
    const ends = Object.fromEntries(
      log.filter((e) => e.event === "end").map((e) => [e.id, e.at]),
    );
    const starts = Object.fromEntries(
      log.filter((e) => e.event === "start").map((e) => [e.id, e.at]),
    );
    expect(starts[B]).toBeGreaterThanOrEqual(ends[A]);
    expect(starts[C]).toBeGreaterThanOrEqual(ends[B]);
  });

  it("à la fin : done, non lu, durée audio du moteur, durée réelle, moteur", async () => {
    await seed(A, "ok");
    await launch(A);
    const done = await finished(A);
    expect(done.state).toBe("done");
    expect(done.viewed_at).toBeNull();
    expect(done.audio_duration_s).toBe(600);
    expect(done.engine).toBe("cascade");
    expect(done.duration_s).toBeGreaterThan(0);
    expect(done.finished_at).not.toBeNull();
    expect(done.queued_at).toEqual(expect.any(String));
  });

  it("une analyse en échec libère la place : la suivante démarre", async () => {
    await seed(A, "fail");
    await seed(B, "ok");
    await launch(A);
    await launch(B);
    const failed = await finished(A);
    expect(failed.state).toBe("failed");
    expect(failed.viewed_at).toBeNull(); // un échec aussi est « non lu »
    expect(failed.duration_s).toEqual(expect.any(Number));
    expect((await finished(B)).state).toBe("done");
  });

  it("deux lancements simultanés d'identifiants différents : un seul démarre, l'autre attend", async () => {
    await seed(A);
    await seed(B);
    const results = await Promise.all([launch(A), launch(B)]);
    expect(results.map((r) => r.state).sort()).toEqual(["queued", "running"]);
    await until(async () => (await startedIds()).length === 1);
    expect((await startedIds()).length).toBe(1);
  });

  it("relancer une analyse déjà en file est refusé, sans doublon", async () => {
    await seed(A);
    await seed(B);
    await launch(A);
    await launch(B);
    await expect(launch(B)).rejects.toThrow(/déjà en cours|file/);
    await expect(launch(A)).rejects.toThrow(/déjà en cours/);
    expect(jobQueue().snapshot().waiting).toEqual([B]);
  });

  it("AQR_MAX_CONCURRENT=2 : deux analyses en parallèle, la troisième attend", async () => {
    vi.stubEnv("AQR_MAX_CONCURRENT", "2");
    await seed(A);
    await seed(B);
    await seed(C);
    expect((await launch(A)).state).toBe("running");
    expect((await launch(B)).state).toBe("running");
    expect((await launch(C)).state).toBe("queued");
    await release(A);
    await until(async () => (await startedIds()).includes(C));
  });

  it("maxConcurrent : 1 par défaut, entier ≥ 1 sinon repli", () => {
    expect(maxConcurrent(undefined)).toBe(1);
    expect(maxConcurrent("3")).toBe(3);
    expect(maxConcurrent("0")).toBe(1);
    expect(maxConcurrent("-2")).toBe(1);
    expect(maxConcurrent("2.5")).toBe(1);
    expect(maxConcurrent("abc")).toBe(1);
  });
});

describe("annulation et suppression dans la file", () => {
  it("annuler une analyse en attente la retire de la file : elle ne démarre jamais", async () => {
    await seed(A);
    await seed(B);
    await seed(C);
    await launch(A);
    await launch(B);
    await launch(C);
    await cancel(B);
    expect(await state(B)).toBe("cancelled");
    expect(jobQueue().snapshot().waiting).toEqual([C]);
    await release(A);
    await until(async () => (await startedIds()).includes(C));
    await release(C);
    await finished(C);
    expect(await startedIds()).toEqual([A, C]);
    expect(await state(B)).toBe("cancelled");
  });

  it("annuler l'analyse en cours démarre la suivante", async () => {
    await seed(A);
    await seed(B, "ok");
    await launch(A);
    await launch(B);
    await until(async () => (await startedIds()).includes(A));
    await cancel(A);
    expect(await state(A)).toBe("cancelled");
    expect((await finished(B)).state).toBe("done");
  });

  it("supprimer une session en attente la retire de la file", async () => {
    await seed(A);
    await seed(B);
    await seed(C, "ok");
    await launch(A);
    await launch(B);
    await launch(C);
    await deleteSession(B);
    expect(existsSync(sessionDir(B))).toBe(false);
    expect(jobQueue().snapshot().waiting).toEqual([C]);
    await release(A);
    expect((await finished(C)).state).toBe("done");
    expect(await startedIds()).toEqual([A, C]);
  });

  it("annuler une session inconnue de la file mais « queued » sur le disque la marque annulée", async () => {
    await seed(A, "hold", {
      state: "queued",
      queued_at: "2026-10-22T09:00:00.000Z",
    });
    await cancel(A);
    expect(await state(A)).toBe("cancelled");
  });

  it("annuler une session sans traitement ni attente échoue proprement", async () => {
    await seed(A, "hold");
    await expect(cancel(A)).rejects.toThrow(/Aucun traitement actif/);
  });

  it("annuler pendant le lancement (sortie de file, processus pas encore créé) ne laisse rien tourner", async () => {
    await seed(A, "ok");
    const pending = launch(A);
    // Dès que A est « actif » dans la file, `run` lit encore la session (E/S) : pas de processus.
    while (!jobQueue().isActive(A))
      await new Promise((resolve) => setImmediate(resolve));
    expect(jobs.has(A)).toBe(false);
    await cancel(A);
    await pending.catch(() => undefined);
    await jobQueue().idle();
    expect(await state(A)).toBe("cancelled");
    expect(jobs.has(A)).toBe(false);
    expect(await startedIds()).toEqual([]);
  });
});

describe("reprise après redémarrage", () => {
  it("remet en file les sessions queued dans l'ordre de queued_at, sans doublon", async () => {
    await seed(C, "ok", {
      state: "queued",
      queued_at: "2026-10-22T09:03:00.000Z",
    });
    await seed(A, "ok", {
      state: "queued",
      queued_at: "2026-10-22T09:01:00.000Z",
    });
    await seed(B, "ok", {
      state: "queued",
      queued_at: "2026-10-22T09:02:00.000Z",
    });
    await seed(D, "ok"); // prête : jamais reprise
    const recovered = await recoverQueue();
    expect(recovered).toEqual([A, B, C]);
    expect(await recoverQueue()).toEqual([]); // idempotent
    for (const id of [A, B, C]) await finished(id);
    expect(await startedIds()).toEqual([A, B, C]);
    expect(await state(D)).toBe("ready");
  });

  it("ensureQueueRecovered ne reprend qu'une fois par processus", async () => {
    await seed(A, "ok", {
      state: "queued",
      queued_at: "2026-10-22T09:01:00.000Z",
    });
    expect(await ensureQueueRecovered()).toEqual([A]);
    expect(await ensureQueueRecovered()).toEqual([A]); // même résultat mémorisé
    await finished(A);
    expect(await startedIds()).toEqual([A]);
  });

  it("un processus d'un serveur précédent encore vivant retient la place", async () => {
    const orphan = spawn(
      process.execPath,
      ["-e", "setTimeout(() => {}, 60000)"],
      {
        stdio: "ignore",
      },
    );
    orphans.push(orphan);
    await seed(D, "hold", {
      state: "running",
      pid: orphan.pid as number,
      started_at: "2026-10-22T09:00:00.000Z",
    });
    await seed(A, "ok", {
      state: "queued",
      queued_at: "2026-10-22T09:01:00.000Z",
    });
    await recoverQueue();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await startedIds()).toEqual([]); // la carte graphique est prise
    expect(await state(A)).toBe("queued");
    orphan.kill();
    await new Promise((resolve) => orphan.once("exit", resolve));
    jobQueue().pump();
    expect((await finished(A)).state).toBe("done");
  });

  it("une analyse dont l'audio a disparu finit failed au lieu de bloquer la file", async () => {
    await seed(A, "ok", {
      state: "queued",
      queued_at: "2026-10-22T09:01:00.000Z",
    });
    await seed(B, "ok", {
      state: "queued",
      queued_at: "2026-10-22T09:02:00.000Z",
    });
    await rm(path.join(sessionDir(A), "source.mp3"));
    await recoverQueue();
    const failed = await finished(A);
    expect(failed.state).toBe("failed");
    expect(failed.error).toBeTruthy();
    expect((await finished(B)).state).toBe("done");
  });
});

describe("robustesse", () => {
  it("aucun rejet non géré quand une session en attente est supprimée à la main", async () => {
    const seen: unknown[] = [];
    const record = (error: unknown) => seen.push(error);
    process.on("unhandledRejection", record);
    process.on("uncaughtException", record);
    try {
      await seed(A);
      await seed(B, "ok");
      await launch(A);
      await launch(B);
      await rm(sessionDir(B), { recursive: true, force: true });
      await release(A);
      await jobQueue().idle();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(seen).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
      process.off("uncaughtException", record);
    }
  });
});
