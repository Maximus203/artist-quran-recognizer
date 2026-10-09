import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  atomicJson,
  cleanupSessions,
  defaultReviewDir,
  exceedsUploadLimit,
  sessionTtlSeconds,
  deleteSession,
  listSessions,
  readReview,
  readSession,
  readResult,
  reviewRoot,
  saveSession,
  sessionDir,
  sha,
  uploadLimitBytes,
  type Session,
} from "./store";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-store-"));
  vi.stubEnv("AQR_REVIEW_DIR", tmp);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmp, { recursive: true, force: true });
});

const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";
const OTHER = "11111111-2222-4333-8444-555555555555";
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
const recognition = (hash: string) => ({
  schema: "aqr.recognition/1",
  source: { file: "a.mp3", sha256: hash, duration_s: 5 },
  engine: {
    asr: "whisper",
    segmenter: "recitation",
    matcher: "flow",
    decoder: "v2",
    constrained: false,
    corpus: "tanzil",
  },
  decoder: {},
  timing: {},
  windows: 1,
  warnings: [],
  intervals: [],
});

describe("dossier de revue par défaut", () => {
  it("n'utilise AppData que sous Windows", () => {
    expect(defaultReviewDir("win32", "C:\\Users\\a", {})).toBe(
      path.join("C:\\Users\\a", "AppData", "Local", "aqr-review"),
    );
  });
  it("suit XDG_DATA_HOME sous Linux, sinon ~/.local/share", () => {
    expect(
      defaultReviewDir("linux", "/home/u", { XDG_DATA_HOME: "/x/d" }),
    ).toBe(path.join("/x/d", "aqr-review"));
    const fallback = defaultReviewDir("linux", "/home/u", {});
    expect(fallback).toBe(
      path.join("/home/u", ".local", "share", "aqr-review"),
    );
    expect(fallback).not.toMatch(/AppData/);
    expect(defaultReviewDir("darwin", "/Users/u", {})).not.toMatch(/AppData/);
  });
  it("AQR_REVIEW_DIR l'emporte et est lu à l'appel", () => {
    expect(reviewRoot()).toBe(path.resolve(tmp));
    vi.stubEnv("AQR_REVIEW_DIR", "");
    expect(reviewRoot()).not.toBe(path.resolve(tmp));
  });
});

describe("identifiant de session et traversée de chemin", () => {
  it("accepte un UUID et reste sous la racine", () => {
    expect(sessionDir(ID)).toBe(path.join(reviewRoot(), "sessions", ID));
  });
  it("refuse toute forme hors UUID, dont les traversées", () => {
    for (const bad of [
      "..",
      "../..",
      `../${ID}`,
      `${ID}/..`,
      `${ID}\\..`,
      "------------------------------------",
      "a".repeat(36),
      ID.toUpperCase(),
      `${ID}\0`,
      "",
      ID + "x",
    ])
      expect(() => sessionDir(bad), JSON.stringify(bad)).toThrow(
        "Identifiant invalide",
      );
  });
});

describe("persistance des sessions", () => {
  it("écrit atomiquement le JSON (aucun .tmp résiduel)", async () => {
    const file = path.join(tmp, "x", "y.json");
    await atomicJson(file, { a: 1 });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ a: 1 });
    const { readdir } = await import("node:fs/promises");
    expect(
      (await readdir(path.dirname(file))).filter((f) => f.endsWith(".tmp")),
    ).toEqual([]);
  });
  it("relit une session sauvegardée", async () => {
    await saveSession(session());
    expect((await readSession(ID)).name).toBe("a.mp3");
  });
  it("liste les sessions, la plus récente d'abord, en ignorant les dossiers corrompus", async () => {
    await saveSession(session());
    await saveSession(
      session({ id: OTHER, created_at: "2026-10-02T00:00:00.000Z" }),
    );
    await mkdir(path.join(reviewRoot(), "sessions", "pas-un-uuid"), {
      recursive: true,
    });
    expect((await listSessions()).map((s) => s.id)).toEqual([OTHER, ID]);
  });
  it("liste vide quand la racine n'existe pas encore", async () => {
    vi.stubEnv("AQR_REVIEW_DIR", path.join(tmp, "absent"));
    expect(await listSessions()).toEqual([]);
  });
  it("une session running dont la sortie existe devient done (hash contrôlé)", async () => {
    await saveSession(session({ state: "running", pid: null }));
    await writeFile(
      path.join(sessionDir(ID), "source.recognition.json"),
      JSON.stringify(recognition("a".repeat(64))),
    );
    const out = await readSession(ID);
    expect(out.state).toBe("done");
    expect(out.prediction_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await readResult(ID))?.parsed.source.sha256).toBe("a".repeat(64));
  });
  it("une sortie au hash différent n'est pas adoptée", async () => {
    await saveSession(session({ state: "running", pid: null }));
    await writeFile(
      path.join(sessionDir(ID), "source.recognition.json"),
      JSON.stringify(recognition("b".repeat(64))),
    );
    expect((await readSession(ID)).state).toBe("running");
  });
  it("une session running dont le processus a disparu passe failed", async () => {
    await saveSession(session({ state: "running", pid: 2 ** 22 - 3 }));
    const out = await readSession(ID);
    expect(out.state).toBe("failed");
    expect(out.pid).toBeNull();
  });
  it("readResult / readReview renvoient null quand absents", async () => {
    await saveSession(session());
    expect(await readResult(ID)).toBeNull();
    expect(await readReview(ID)).toBeNull();
  });
  it("sha calcule un SHA-256 hexadécimal", () => {
    expect(sha(Buffer.from("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("plafond d'upload", () => {
  it("300 Mo par défaut, AQR_MAX_UPLOAD_BYTES ajuste, valeur invalide ignorée", () => {
    expect(uploadLimitBytes(undefined)).toBe(300 * 1024 * 1024);
    expect(uploadLimitBytes("1024")).toBe(1024);
    for (const bad of ["", "0", "-1", "abc", "NaN"])
      expect(uploadLimitBytes(bad)).toBe(300 * 1024 * 1024);
  });
});

describe("garde-fous de requête", () => {
  it("rejette tôt un Content-Length au-delà du plafond", () => {
    expect(exceedsUploadLimit(null, 1000)).toBe(false);
    expect(exceedsUploadLimit("900", 1000)).toBe(false);
    expect(exceedsUploadLimit(String(1000 + 3 * 1024 * 1024), 1000)).toBe(true);
    expect(exceedsUploadLimit("abc", 1000)).toBe(true);
  });
  it("AQR_SESSION_TTL_S : désactivé (0) par défaut et si invalide", () => {
    expect(sessionTtlSeconds(undefined)).toBe(0);
    expect(sessionTtlSeconds("86400")).toBe(86400);
    for (const bad of ["", "-1", "x", "1.5"])
      expect(sessionTtlSeconds(bad)).toBe(0);
  });
});

describe("nettoyage des sessions", () => {
  const age = async (id: string, days: number) => {
    const when = new Date(Date.now() - days * 86400_000);
    await utimes(path.join(sessionDir(id), "session.json"), when, when);
    await utimes(sessionDir(id), when, when);
  };
  it("supprime explicitement une session (hors running)", async () => {
    await saveSession(session());
    await writeFile(path.join(sessionDir(ID), "source.mp3"), "abc");
    await deleteSession(ID);
    await expect(stat(sessionDir(ID))).rejects.toThrow();
  });
  it("refuse de supprimer une session en cours", async () => {
    await saveSession(session({ state: "running", pid: process.pid }));
    await expect(deleteSession(ID)).rejects.toThrow(/en cours/);
    await expect(stat(sessionDir(ID))).resolves.toBeTruthy();
  });
  it("refuse un identifiant de traversée", async () => {
    await expect(deleteSession("../..")).rejects.toThrow(
      "Identifiant invalide",
    );
  });
  it("cleanupSessions(0) est désactivé : rien n'est supprimé", async () => {
    await saveSession(session());
    await age(ID, 30);
    expect(await cleanupSessions(0)).toEqual([]);
    await expect(stat(sessionDir(ID))).resolves.toBeTruthy();
  });
  it("supprime les sessions plus vieilles que le TTL, garde récentes et running", async () => {
    await saveSession(session());
    await saveSession(session({ id: OTHER }));
    const RUN = "22222222-3333-4444-8555-666666666666";
    await saveSession(session({ id: RUN, state: "running", pid: process.pid }));
    await age(ID, 3);
    await age(RUN, 3);
    const removed = await cleanupSessions(86400);
    expect(removed).toEqual([ID]);
    await expect(stat(sessionDir(OTHER))).resolves.toBeTruthy();
    await expect(stat(sessionDir(RUN))).resolves.toBeTruthy();
  });
});
