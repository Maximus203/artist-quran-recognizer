import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { reviewSchema } from "./review";
import {
  ReviewWorkError,
  atomicJson,
  cleanupSessions,
  defaultReviewDir,
  exceedsUploadLimit,
  lastActivityMs,
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

// Enveloppe transparente de readFile : permet de provoquer une écriture « entre
// deux lectures » pour tester la course entre la purge et un PUT de revue.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

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
  const DAY = 86400_000;
  const ago = (days: number) => new Date(Date.now() - days * DAY);
  const age = async (id: string, days: number) => {
    const when = ago(days);
    await utimes(path.join(sessionDir(id), "session.json"), when, when);
    await utimes(sessionDir(id), when, when);
  };
  /** Vieillit récursivement tous les fichiers et dossiers de la session. */
  const ageTree = async (id: string, days: number) => {
    const when = ago(days);
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        await utimes(full, when, when);
      }
    };
    await walk(sessionDir(id));
    await utimes(sessionDir(id), when, when);
  };
  const touch = async (file: string, days: number) => {
    const when = ago(days);
    await utimes(file, when, when);
  };
  const annotation = (over: Record<string, unknown> = {}) => ({
    id: "33333333-4444-4555-8666-777777777777",
    mode: "point",
    start_s: 1,
    end_s: null,
    type: "other",
    description: "à vérifier",
    expected_ref: null,
    target_index: null,
    status: "draft",
    updated_at: new Date().toISOString(),
    ...over,
  });
  /** Revue valide d'après `reviewSchema` (le fixture est rejeté s'il dérive). */
  const review = (over: Record<string, unknown> = {}, id = ID) =>
    reviewSchema.parse({
      schema: "aqr.review/1",
      session_id: id,
      audio_sha256: "a".repeat(64),
      prediction_sha256: "b".repeat(64),
      annotations: [],
      updated_at: new Date().toISOString(),
      ...over,
    });
  const done = (over: Partial<Session> = {}) =>
    session({
      state: "done",
      finished_at: ago(3).toISOString(),
      prediction_sha256: "b".repeat(64),
      ...over,
    });
  const reviewFile = (id = ID) => path.join(sessionDir(id), "review.json");
  const exists = (id = ID) => stat(sessionDir(id));

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

  describe("activité de revue", () => {
    it("une session done ancienne mais revue à l'instant est conservée", async () => {
      await saveSession(done());
      await age(ID, 3);
      await atomicJson(reviewFile(), review());
      expect(await cleanupSessions(86400)).toEqual([]);
      await expect(exists()).resolves.toBeTruthy();
      await expect(stat(reviewFile())).resolves.toBeTruthy();
    });
    it("le mtime récent de review.json suffit (date interne et dossier anciens)", async () => {
      await saveSession(done());
      await atomicJson(
        reviewFile(),
        review({ updated_at: ago(3).toISOString() }),
      );
      await age(ID, 3);
      await touch(reviewFile(), 0);
      expect(await cleanupSessions(86400)).toEqual([]);
    });
    it("review.updated_at récent suffit (mtime restauré à l'ancien)", async () => {
      await saveSession(done());
      await atomicJson(reviewFile(), review());
      await ageTree(ID, 3);
      expect(await cleanupSessions(86400)).toEqual([]);
    });
    it("une révision récente seule suffit, tout le reste étant ancien", async () => {
      await saveSession(done());
      await atomicJson(
        reviewFile(),
        review({ updated_at: ago(3).toISOString() }),
      );
      const revision = path.join(
        sessionDir(ID),
        "revisions",
        "2026-10-09T10-00-00-000Z-x.review.json",
      );
      await atomicJson(revision, review({ updated_at: ago(3).toISOString() }));
      await ageTree(ID, 3);
      await touch(revision, 0);
      expect(await cleanupSessions(86400)).toEqual([]);
      await expect(stat(revision)).resolves.toBeTruthy();
    });
    it("un export ZIP ou une écriture .tmp récents comptent comme activité", async () => {
      for (const recent of ["exports/x.zip", "session.json.x.tmp"]) {
        await saveSession(done());
        await mkdir(path.join(sessionDir(ID), "exports"), { recursive: true });
        await writeFile(path.join(sessionDir(ID), recent), "z");
        await ageTree(ID, 3);
        await touch(path.join(sessionDir(ID), recent), 0);
        expect(await cleanupSessions(86400), recent).toEqual([]);
        await rm(sessionDir(ID), { recursive: true });
      }
    });
    it("une revue elle aussi inactive depuis plus que le TTL expire (annotations comprises)", async () => {
      await saveSession(done());
      await atomicJson(
        reviewFile(),
        review({
          annotations: [annotation({ updated_at: ago(3).toISOString() })],
          updated_at: ago(3).toISOString(),
        }),
      );
      await ageTree(ID, 3);
      expect(await cleanupSessions(86400)).toEqual([ID]);
      await expect(exists()).rejects.toThrow();
    });
    it("une session ancienne sans aucune revue est supprimée (non-régression)", async () => {
      await saveSession(done());
      await writeFile(path.join(sessionDir(ID), "source.mp3"), "abc");
      await age(ID, 3);
      await touch(path.join(sessionDir(ID), "source.mp3"), 3);
      expect(await cleanupSessions(86400)).toEqual([ID]);
      await expect(exists()).rejects.toThrow();
    });
    it("une session running n'est jamais supprimée, même sans activité", async () => {
      await saveSession(
        session({ state: "running", pid: process.pid, started_at: null }),
      );
      await ageTree(ID, 30);
      expect(await cleanupSessions(86400)).toEqual([]);
      await expect(exists()).resolves.toBeTruthy();
    });
    it("relit l'activité juste avant de supprimer : un PUT arrivé entre-temps sauve la session", async () => {
      await saveSession(done());
      await ageTree(ID, 3);
      const reads = vi.mocked(readFile);
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      let sessionReads = 0;
      reads.mockImplementation((async (
        ...args: Parameters<typeof readFile>
      ) => {
        if (String(args[0]).endsWith("session.json") && ++sessionReads === 2)
          // 1re lecture = activité, 2e = état (readSession) : le PUT tombe ici.
          await atomicJson(reviewFile(), review());
        return actual.readFile(...args);
      }) as typeof readFile);
      try {
        expect(await cleanupSessions(86400)).toEqual([]);
        expect(sessionReads).toBeGreaterThanOrEqual(2);
      } finally {
        reads.mockImplementation(actual.readFile as typeof readFile);
      }
      await expect(stat(reviewFile())).resolves.toBeTruthy();
    });
    it("un JSON corrompu ou un dossier étranger laisse la session intacte", async () => {
      await saveSession(done());
      await atomicJson(reviewFile(), review());
      await writeFile(reviewFile(), "{pas du json");
      await ageTree(ID, 3);
      await mkdir(path.join(reviewRoot(), "sessions", OTHER), {
        recursive: true,
      });
      await writeFile(path.join(reviewRoot(), "sessions", OTHER, "x.bin"), "x");
      await ageTree(OTHER, 3);
      const BROKEN = "44444444-5555-4666-8777-888888888888";
      await mkdir(sessionDir(BROKEN), { recursive: true });
      await writeFile(path.join(sessionDir(BROKEN), "session.json"), "{oops");
      await ageTree(BROKEN, 3);
      expect(await cleanupSessions(86400)).toEqual([]);
      for (const id of [ID, OTHER, BROKEN])
        await expect(exists(id)).resolves.toBeTruthy();
    });
  });

  describe("lastActivityMs", () => {
    const at = (days: number) => Math.round(ago(days).getTime() / 1000) * 1000;
    it("prend le plus récent des mtime, sous-dossiers compris", async () => {
      await saveSession(done());
      await ageTree(ID, 9);
      const nested = path.join(sessionDir(ID), "revisions", "r.review.json");
      await atomicJson(nested, review({ updated_at: ago(9).toISOString() }));
      const when = new Date(at(2));
      await utimes(nested, when, when);
      await utimes(path.dirname(nested), ago(9), ago(9));
      await utimes(sessionDir(ID), ago(9), ago(9));
      const sessionFile = path.join(sessionDir(ID), "session.json");
      await utimes(sessionFile, ago(9), ago(9));
      expect(await lastActivityMs(sessionDir(ID))).toBe(at(2));
    });
    it("tient compte de review.updated_at et de finished_at s'ils sont plus récents", async () => {
      await saveSession(done({ finished_at: new Date(at(5)).toISOString() }));
      await ageTree(ID, 9);
      expect(await lastActivityMs(sessionDir(ID))).toBe(at(5));
      await atomicJson(
        reviewFile(),
        review({ updated_at: new Date(at(1)).toISOString() }),
      );
      await ageTree(ID, 9);
      expect(await lastActivityMs(sessionDir(ID))).toBe(at(1));
    });
    it("ignore une date interne située dans le futur (horloge fausse)", async () => {
      await saveSession(done());
      await atomicJson(
        reviewFile(),
        review({ updated_at: "2099-01-01T00:00:00.000Z" }),
      );
      await ageTree(ID, 3);
      const activity = await lastActivityMs(sessionDir(ID));
      expect(activity).toBeLessThan(Date.now() - 2 * DAY);
      expect(await cleanupSessions(86400)).toEqual([ID]);
    });
  });

  describe("suppression explicite d'une session revue", () => {
    it("refuse (/revue/) une session portant une annotation, même si tout est ancien ; force la supprime", async () => {
      await saveSession(done());
      await atomicJson(
        reviewFile(),
        review({
          annotations: [annotation()],
          updated_at: ago(3).toISOString(),
        }),
      );
      await ageTree(ID, 3);
      await expect(deleteSession(ID)).rejects.toThrow(/revue/);
      await expect(deleteSession(ID, { force: false })).rejects.toBeInstanceOf(
        ReviewWorkError,
      );
      await expect(exists()).resolves.toBeTruthy();
      await expect(stat(reviewFile())).resolves.toBeTruthy();
      await deleteSession(ID, { force: true });
      await expect(exists()).rejects.toThrow();
    });
    it("refuse aussi quand il ne reste que des révisions", async () => {
      await saveSession(done());
      await atomicJson(
        path.join(sessionDir(ID), "revisions", "r.review.json"),
        review({ annotations: [annotation()] }),
      );
      await expect(deleteSession(ID)).rejects.toThrow(/revue/);
      await deleteSession(ID, { force: true });
      await expect(exists()).rejects.toThrow();
    });
    it("refuse par prudence si review.json est illisible", async () => {
      await saveSession(done());
      await writeFile(reviewFile(), "{pas du json");
      await expect(deleteSession(ID)).rejects.toThrow(/revue/);
    });
    it("supprime sans force une session sans travail de revue (revue vide ou absente)", async () => {
      await saveSession(done());
      await atomicJson(reviewFile(), review());
      await deleteSession(ID);
      await expect(exists()).rejects.toThrow();
      await saveSession(done());
      await deleteSession(ID);
      await expect(exists()).rejects.toThrow();
    });
    it("force ne contourne pas une session en cours", async () => {
      await saveSession(session({ state: "running", pid: process.pid }));
      await expect(deleteSession(ID, { force: true })).rejects.toThrow(
        /en cours/,
      );
      await expect(exists()).resolves.toBeTruthy();
    });
  });
});
