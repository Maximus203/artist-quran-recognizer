import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb } from "./db";
import { getMeta, userAnalysisStats } from "./session-index";
import {
  directoryBytes,
  importLegacySessions,
  installSessionHooks,
  syncSession,
} from "./session-sync";
import {
  deleteSession,
  saveSession,
  sessionDir,
  sessionHooks,
  type Session,
} from "./store";
import { createUser } from "./users";

let root: string;
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const session = (n: number, over: Partial<Session> = {}): Session => ({
  id: id(n),
  name: `fichier${n}.mp3`,
  extension: ".mp3",
  audio_sha256: "a".repeat(64),
  size: 1234,
  created_at: "2026-10-20T10:00:00.000Z",
  state: "ready",
  error: null,
  started_at: null,
  finished_at: null,
  prediction_sha256: null,
  pid: null,
  ...over,
});

const prediction = (refs: string[]) => ({
  schema: "aqr.recognition/1",
  source: { file: "x.mp3", sha256: "a".repeat(64), duration_s: 60 },
  engine: {
    asr: "fastconformer-quran@abc",
    segmenter: "s",
    matcher: "m",
    decoder: "d",
    constrained: true,
    corpus: "c",
  },
  decoder: {},
  timing: {},
  windows: 1,
  warnings: [],
  intervals: refs.map((ref, i) => ({
    kind: "verse",
    ref,
    words: null,
    partial: false,
    status: "recognized",
    t: [i * 4, i * 4 + 3],
    time_interpolated: false,
    confidence: 0.9,
    candidates: [],
    repetition: false,
  })),
});

async function onDisk(s: Session, refs?: string[]) {
  const dir = sessionDir(s.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "session.json"), JSON.stringify(s));
  await writeFile(path.join(dir, `source${s.extension}`), Buffer.alloc(s.size));
  if (refs)
    await writeFile(
      path.join(dir, "prediction.recognition.json"),
      JSON.stringify(prediction(refs)),
    );
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "aqr-sync-"));
  vi.stubEnv("AQR_REVIEW_DIR", root);
  vi.stubEnv("AQR_DB_PATH", path.join(root, "aqr.sqlite"));
  closeDb();
});
afterEach(async () => {
  sessionHooks.saved = undefined;
  sessionHooks.removed = undefined;
  closeDb();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("import des sessions existantes", () => {
  it("les inscrit globales, sans propriétaire, avec nom lisible, taille et étiquette", async () => {
    await onDisk(
      session(1, {
        name: "2026-10-20T17-58-52-469.webm",
        extension: ".webm",
        source_kind: "microphone",
        state: "done",
        started_at: "2026-10-20T10:00:00.000Z",
        finished_at: "2026-10-20T10:01:00.000Z",
        audio_duration_s: 60,
        duration_s: 20,
        engine: "cascade",
      }),
      ["12:11", "12:12", "12:13"],
    );
    await onDisk(session(2, { name: "Surah_Yusuf [dQw4w9WgXcQ].mp3" }));
    installSessionHooks();
    expect(await importLegacySessions()).toBe(2);
    const db = getDb();
    expect(getMeta(db, id(1))).toMatchObject({
      owner_id: null,
      visibility: "global",
      name_source: "auto",
      name: expect.stringMatching(/^Enregistrement du /),
      original_name: "2026-10-20T17-58-52-469.webm",
      content_label: "Yusuf 12:11–13",
      state: "done",
      size_bytes: 1234,
    });
    expect(getMeta(db, id(1))?.disk_bytes).toBeGreaterThan(1234);
    expect(getMeta(db, id(2))).toMatchObject({
      name: "Surah Yusuf",
      content_label: null,
    });
  });

  it("est idempotent et ne touche pas aux lignes déjà connues", async () => {
    await onDisk(session(1));
    installSessionHooks();
    expect(await importLegacySessions()).toBe(1);
    const db = getDb();
    db.prepare(
      "UPDATE session_meta SET visibility = 'private', name = 'Mon nom' WHERE id = ?",
    ).run(id(1));
    expect(await importLegacySessions()).toBe(0);
    expect(getMeta(db, id(1))).toMatchObject({
      visibility: "private",
      name: "Mon nom",
    });
  });

  it("ignore les dossiers étrangers et les sessions illisibles sans échouer", async () => {
    await mkdir(path.join(root, "sessions", "pas-un-uuid"), {
      recursive: true,
    });
    await mkdir(sessionDir(id(9)), { recursive: true });
    await writeFile(
      path.join(sessionDir(id(9)), "session.json"),
      "{pas du json",
    );
    await onDisk(session(1));
    installSessionHooks();
    expect(await importLegacySessions()).toBe(1);
  });

  it("répertoire de sessions absent : rien à importer", async () => {
    installSessionHooks();
    expect(await importLegacySessions()).toBe(0);
  });
});

describe("suivi des écritures de session.json", () => {
  it("recopie l'état, puis consigne l'analyse terminée UNE fois", async () => {
    const db = getDb();
    const owner = createUser(db, { username: "Cherif", passwordHash: "x" }).id;
    await onDisk(session(1), undefined);
    installSessionHooks();
    // L'import réel inscrit le propriétaire AVANT la première écriture.
    db.prepare(
      `INSERT INTO session_meta (id, owner_id, name, original_name, visibility, created_at, updated_at)
       VALUES (?, ?, 'x', 'x.mp3', 'private', 'now', 'now')`,
    ).run(id(1), owner);
    const running = session(1, {
      state: "running",
      started_at: "2026-10-20T10:00:00.000Z",
      engine: "cascade",
    });
    await saveSession(running);
    expect(getMeta(db, id(1))).toMatchObject({
      state: "running",
      owner_id: owner,
      visibility: "private",
    });

    await writeFile(
      path.join(sessionDir(id(1)), "prediction.recognition.json"),
      JSON.stringify(prediction(["112:1", "112:2"])),
    );
    const done = {
      ...running,
      state: "done" as const,
      finished_at: "2026-10-20T10:02:00.000Z",
      audio_duration_s: 60,
      duration_s: 30,
    };
    await saveSession(done);
    await saveSession(done); // réécriture sans changement d'état : pas de doublon
    expect(getMeta(db, id(1))).toMatchObject({
      state: "done",
      content_label: "Al-Ikhlas 112:1–2",
      owner_id: owner,
    });
    expect(userAnalysisStats(db, owner)).toMatchObject({
      tests: 1,
      audio_total_s: 60,
      processing_total_s: 30,
    });
  });

  it("une session sans ligne d'index entre comme globale sans propriétaire (jamais privée par défaut)", async () => {
    await onDisk(session(3));
    installSessionHooks();
    await syncSession(session(3));
    expect(getMeta(getDb(), id(3))).toMatchObject({
      owner_id: null,
      visibility: "global",
    });
  });

  it("la suppression d'une session retire sa ligne d'index", async () => {
    await onDisk(session(1));
    installSessionHooks();
    await importLegacySessions();
    await deleteSession(id(1));
    expect(getMeta(getDb(), id(1))).toBeNull();
  });

  it("un crochet qui échoue ne fait pas échouer l'écriture", async () => {
    await onDisk(session(1));
    sessionHooks.saved = () => {
      throw new Error("base indisponible");
    };
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      saveSession(session(1, { state: "queued" })),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("base indisponible"),
    );
    warn.mockRestore();
  });
});

describe("taille d'un dossier", () => {
  it("additionne les fichiers, sous-dossiers compris", async () => {
    await mkdir(path.join(root, "d", "sub"), { recursive: true });
    await writeFile(path.join(root, "d", "a"), Buffer.alloc(10));
    await writeFile(path.join(root, "d", "sub", "b"), Buffer.alloc(5));
    expect(await directoryBytes(path.join(root, "d"))).toBe(15);
  });
});
