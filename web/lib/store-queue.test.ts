import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JobQueue, resetSharedQueue, sharedQueue } from "./queue";
import {
  atomicJson,
  backfillDerived,
  cleanupSessions,
  deleteSession,
  markViewed,
  readSession,
  saveSession,
  sessionDir,
  sha,
  videoUploadLimitBytes,
  type Session,
} from "./store";

// Enveloppe transparente de rename : provoque le refus que Windows oppose à un remplacement de
// fichier pendant qu'un autre processus (ou une autre requête) le lit.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-store-queue-"));
  vi.stubEnv("AQR_REVIEW_DIR", tmp);
});
afterEach(async () => {
  resetSharedQueue();
  vi.unstubAllEnvs();
  await rm(tmp, { recursive: true, force: true });
});

const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";
const session = (over: Partial<Session> = {}): Session => ({
  id: ID,
  name: "a.mp3",
  extension: ".mp3",
  audio_sha256: "a".repeat(64),
  size: 3,
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
const recognition = (hash: string, asr = "fastconformer-quran@b33a") => ({
  schema: "aqr.recognition/1",
  source: { file: "a.mp3", sha256: hash, duration_s: 1276.2 },
  engine: {
    asr,
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
});

describe("markViewed — l'utilisateur a ouvert le résultat", () => {
  it("pose viewed_at une seule fois : l'appel est idempotent", async () => {
    await saveSession(session({ state: "done", viewed_at: null }));
    const first = await markViewed(ID, new Date("2026-10-22T10:00:00.000Z"));
    expect(first.viewed_at).toBe("2026-10-22T10:00:00.000Z");
    const second = await markViewed(ID, new Date("2026-10-22T11:00:00.000Z"));
    expect(second.viewed_at).toBe("2026-10-22T10:00:00.000Z");
    expect((await readSession(ID)).viewed_at).toBe("2026-10-22T10:00:00.000Z");
  });
  it("marque aussi un échec comme vu", async () => {
    await saveSession(session({ state: "failed", viewed_at: null }));
    expect((await markViewed(ID)).viewed_at).not.toBeNull();
  });
  it("ne marque rien tant que le résultat n'existe pas (en file, en cours, prête)", async () => {
    for (const state of ["ready", "queued", "running"] as const) {
      await saveSession(session({ state, viewed_at: null }));
      expect((await markViewed(ID)).viewed_at).toBeNull();
      expect((await readSession(ID)).viewed_at).toBeNull();
    }
  });
  it("des appels simultanés ne perdent aucune écriture", async () => {
    await saveSession(session({ state: "done", viewed_at: null }));
    const results = await Promise.all(
      Array.from({ length: 8 }, () => markViewed(ID)),
    );
    expect(new Set(results.map((s) => s.viewed_at)).size).toBe(1);
  });
  it("refuse un identifiant invalide et une session inconnue", async () => {
    await expect(markViewed("../..")).rejects.toThrow("Identifiant invalide");
    await expect(markViewed(ID)).rejects.toThrow();
  });
});

describe("fin du traitement lue sur le disque (adoption de la sortie)", () => {
  it("consigne durée audio, durée réelle, moteur, et laisse le résultat non lu", async () => {
    const audio = Buffer.from("x");
    const hash = sha(audio);
    await saveSession(
      session({
        state: "running",
        audio_sha256: hash,
        asr: "cascade",
        started_at: new Date(Date.now() - 90_000).toISOString(),
      }),
    );
    await writeFile(
      path.join(sessionDir(ID), "source.recognition.json"),
      JSON.stringify(recognition(hash, "cascade(fastconformer-quran@b33a)")),
    );
    const done = await readSession(ID);
    expect(done.state).toBe("done");
    expect(done.audio_duration_s).toBe(1276.2);
    expect(done.engine).toBe("cascade");
    expect(done.duration_s).toBeGreaterThanOrEqual(89);
    expect(done.viewed_at).toBeNull();
  });
});

describe("suppression d'une session dans la file", () => {
  const manual = () => {
    const finish = new Map<string, () => void>();
    return sharedQueue(
      () =>
        new JobQueue({
          concurrency: () => 1,
          runner: (id, signal) =>
            new Promise<void>((resolve) => {
              signal.started();
              finish.set(id, resolve);
            }),
        }),
    );
  };
  it("retire de la file une session en attente puis la supprime", async () => {
    const queue = manual();
    queue.enqueue("0f0e0d0c-0b0a-4908-8706-050403020101");
    queue.enqueue(ID);
    await saveSession(
      session({ state: "queued", queued_at: "2026-10-22T10:00:00.000Z" }),
    );
    expect(queue.isWaiting(ID)).toBe(true);
    await deleteSession(ID);
    expect(queue.has(ID)).toBe(false);
    await expect(readSession(ID)).rejects.toThrow();
  });
  it("refuse de supprimer une session dont l'analyse vient de démarrer", async () => {
    const queue = manual();
    queue.enqueue(ID);
    await saveSession(session({ state: "queued" }));
    expect(queue.isActive(ID)).toBe(true);
    await expect(deleteSession(ID)).rejects.toThrow(/en cours/);
    expect((await readSession(ID)).id).toBe(ID);
  });
  it("supprime une session « queued » que la file ne connaît pas (serveur redémarré)", async () => {
    await saveSession(session({ state: "queued" }));
    await deleteSession(ID);
    await expect(readSession(ID)).rejects.toThrow();
  });
});

describe("purge par inactivité", () => {
  it("ne supprime jamais une session en attente, même ancienne", async () => {
    await saveSession(session({ state: "queued" }));
    const removed = await cleanupSessions(60, Date.now() + 10 * 24 * 3600_000);
    expect(removed).toEqual([]);
    expect((await readSession(ID)).state).toBe("queued");
  });
});

describe("backfillDerived — migration des sessions d'avant la file", () => {
  it("renseigne durée audio, moteur et durée réelle une fois, sans toucher viewed_at", async () => {
    const hash = sha(Buffer.from("x"));
    await saveSession(
      session({
        state: "done",
        audio_sha256: hash,
        started_at: "2026-10-20T00:00:00.000Z",
        finished_at: "2026-10-20T00:01:10.000Z",
      }),
    );
    await writeFile(
      path.join(sessionDir(ID), "prediction.recognition.json"),
      JSON.stringify(recognition(hash)),
    );
    const migrated = await backfillDerived(await readSession(ID));
    expect(migrated.audio_duration_s).toBe(1276.2);
    expect(migrated.engine).toBe("fastconformer");
    expect(migrated.duration_s).toBe(70);
    expect("viewed_at" in migrated).toBe(false);
    const onDisk = JSON.parse(
      await readFile(path.join(sessionDir(ID), "session.json"), "utf8"),
    ) as Session;
    expect(onDisk.audio_duration_s).toBe(1276.2);
    // Deuxième passage : rien à faire, aucune réécriture.
    const again = await backfillDerived(onDisk);
    expect(again).toEqual(onDisk);
  });
  it("une prédiction illisible ne casse pas la liste : la session reste sans durée", async () => {
    await saveSession(session({ state: "done" }));
    await writeFile(
      path.join(sessionDir(ID), "prediction.recognition.json"),
      "{ pas du json",
    );
    const result = await backfillDerived(await readSession(ID));
    expect(result.audio_duration_s ?? null).toBeNull();
  });
  it("ne touche ni une session en cours ni une session sans prédiction", async () => {
    const running = session({ state: "running" });
    await saveSession(running);
    expect(await backfillDerived(running)).toEqual(running);
    const done = session({ state: "done" });
    await saveSession(done);
    const result = await backfillDerived(done);
    expect(result.audio_duration_s ?? null).toBeNull();
  });
});

describe("atomicJson — remplacement pendant une lecture (Windows : EPERM / EBUSY)", () => {
  const refuse = (code: string) =>
    Object.assign(new Error(`${code}: operation not permitted`), { code });
  it("réessaie un rename refusé temporairement : la session n'est pas perdue", async () => {
    const real =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    let calls = 0;
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (++calls <= 2) throw refuse("EPERM");
      return real.rename(from, to);
    });
    const file = path.join(tmp, "x.json");
    await atomicJson(file, { ok: 1 });
    expect(calls).toBe(3);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ ok: 1 });
    vi.mocked(rename).mockImplementation(real.rename);
  });
  it("abandonne après plusieurs essais, remonte l'erreur et ne laisse aucun .tmp", async () => {
    const real =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    vi.mocked(rename).mockImplementation(async () => {
      throw refuse("EBUSY");
    });
    await expect(atomicJson(path.join(tmp, "y.json"), {})).rejects.toThrow(
      /EBUSY/,
    );
    expect((await readdir(tmp)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    vi.mocked(rename).mockImplementation(real.rename);
  });
  it("une autre erreur n'est pas réessayée", async () => {
    const real =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    let calls = 0;
    vi.mocked(rename).mockImplementation(async () => {
      calls++;
      throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
    });
    await expect(atomicJson(path.join(tmp, "z.json"), {})).rejects.toThrow(
      /ENOSPC/,
    );
    expect(calls).toBe(1);
    vi.mocked(rename).mockImplementation(real.rename);
  });
});

describe("plafond d'upload vidéo", () => {
  it("2 Gio par défaut, configurable, jamais invalide", () => {
    expect(videoUploadLimitBytes(undefined)).toBe(2 * 1024 ** 3);
    expect(videoUploadLimitBytes("1048576")).toBe(1048576);
    expect(videoUploadLimitBytes("abc")).toBe(2 * 1024 ** 3);
    expect(videoUploadLimitBytes("-5")).toBe(2 * 1024 ** 3);
    expect(videoUploadLimitBytes("1.5")).toBe(2 * 1024 ** 3);
  });
});
