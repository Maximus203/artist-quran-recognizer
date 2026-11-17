import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Réglages d'export PAR VIDÉO : autorisation côté serveur. A possède une session privée P et une globale G ;
 * B est un autre compte ; ADMIN voit tout. Chaque compte a SES réglages d'une vidéo : écrire ne touche jamais
 * ceux d'un autre, ni d'une autre vidéo.
 */
const PRIVATE = "00000000-0000-4000-8000-0000000000a1";
const GLOBAL = "00000000-0000-4000-8000-0000000000a2";
const MISSING = "00000000-0000-4000-8000-0000000000ff";

let dir = "";
const cookies = { A: "", B: "", ADMIN: "" };
type Route = typeof import("./route");
let route: Route;
let defaults: Record<string, unknown>;

const url = (id: string) =>
  `http://127.0.0.1:3000/api/sessions/${id}/video-prefs`;
const call = (
  verb: "GET" | "PUT" | "DELETE",
  id: string,
  cookie?: string,
  body?: unknown,
) => {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = `aqr_session=${cookie}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return route[verb](
    new Request(url(id), {
      method: verb,
      headers,
      body:
        body === undefined || verb === "GET" ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
};

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-vprefs-"));
  vi.stubEnv("AQR_REVIEW_DIR", dir);
  const { getDb } = await import("@/lib/db");
  const { createUser } = await import("@/lib/users");
  const { createLogin, authConfig } = await import("@/lib/auth");
  const { createMeta } = await import("@/lib/session-index");
  const { DEFAULT_VIDEO_PREFS } = await import("@/lib/export-video-prefs");
  defaults = DEFAULT_VIDEO_PREFS as unknown as Record<string, unknown>;
  const db = getDb();
  const a = createUser(db, { username: "awa", passwordHash: "x" });
  const b = createUser(db, { username: "bakary", passwordHash: "x" });
  const admin = createUser(db, { username: "admin1", passwordHash: "x" });
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.id);
  cookies.A = createLogin(db, a.id, authConfig());
  cookies.B = createLogin(db, b.id, authConfig());
  cookies.ADMIN = createLogin(db, admin.id, authConfig());
  const base = {
    nameSource: "auto" as const,
    sourceKind: "file" as const,
    sizeBytes: 100,
    ownerId: a.id,
    createdAt: "2026-10-01T00:00:00.000Z",
    state: "ready" as const,
  };
  createMeta(db, {
    ...base,
    id: PRIVATE,
    name: "P",
    originalName: "p.mp3",
    visibility: "private",
  });
  createMeta(db, {
    ...base,
    id: GLOBAL,
    name: "G",
    originalName: "g.mp3",
    visibility: "global",
  });
  const { saveSession, sessionDir } = await import("@/lib/store");
  for (const id of [PRIVATE, GLOBAL]) {
    await saveSession({
      id,
      name: "audio.mp3",
      extension: ".mp3",
      audio_sha256: "a".repeat(64),
      size: 100,
      source_kind: "file",
      created_at: "2026-10-01T00:00:00.000Z",
      state: "ready",
      error: null,
      started_at: null,
      finished_at: null,
      prediction_sha256: null,
      pid: null,
    });
    await writeFile(path.join(sessionDir(id), "source.mp3"), "x");
  }
  route = await import("./route");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  const { getDb } = await import("@/lib/db");
  getDb().close();
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

const noTranslation = () => ({ ...defaults, showTranslation: false });
const arabicOnly = () => ({
  ...defaults,
  showTranslation: false,
  showWave: false,
});

describe("sans connexion", () => {
  it("401 sur chaque méthode", async () => {
    for (const verb of ["GET", "PUT", "DELETE"] as const)
      expect(
        (await call(verb, PRIVATE, undefined, noTranslation())).status,
      ).toBe(401);
  });
});

describe("propriétaire", () => {
  it("rien d'enregistré : prefs null", async () => {
    const response = await call("GET", PRIVATE, cookies.A);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ prefs: null });
  });
  it("écrit puis relit exactement ce qu'il a réglé, vidéo par vidéo", async () => {
    expect(
      (await call("PUT", PRIVATE, cookies.A, noTranslation())).status,
    ).toBe(200);
    expect((await call("PUT", GLOBAL, cookies.A, arabicOnly())).status).toBe(
      200,
    );
    const p = await (await call("GET", PRIVATE, cookies.A)).json();
    const g = await (await call("GET", GLOBAL, cookies.A)).json();
    expect(p.prefs).toEqual(noTranslation());
    expect(g.prefs).toEqual(arabicOnly());
    expect(typeof p.updated_at).toBe("string");
  });
  it("refuse un corps invalide (400) sans rien écrire", async () => {
    const bad = await call("PUT", PRIVATE, cookies.A, { ...defaults, fps: 7 });
    expect(bad.status).toBe(400);
    const unknownKey = await call("PUT", PRIVATE, cookies.A, {
      ...defaults,
      evil: 1,
    });
    expect(unknownKey.status).toBe(400);
    const read = await (await call("GET", PRIVATE, cookies.A)).json();
    expect(read.prefs).toEqual(noTranslation());
  });
  it("session inexistante : 404", async () => {
    expect((await call("GET", MISSING, cookies.A)).status).toBe(404);
    expect(
      (await call("PUT", MISSING, cookies.A, noTranslation())).status,
    ).toBe(404);
  });
});

describe("autre compte : jamais les réglages d'autrui", () => {
  it("B ne voit pas la session privée de A : 404 sur chaque méthode", async () => {
    for (const verb of ["GET", "PUT", "DELETE"] as const)
      expect((await call(verb, PRIVATE, cookies.B, arabicOnly())).status).toBe(
        404,
      );
    const read = await (await call("GET", PRIVATE, cookies.A)).json();
    expect(read.prefs).toEqual(noTranslation());
  });
  it("sur la session globale, B lit les SIENS (vides), pas ceux de A ; son écriture n'écrase pas A", async () => {
    const empty = await (await call("GET", GLOBAL, cookies.B)).json();
    expect(empty.prefs).toBeNull();
    const own = { ...defaults, showArabic: false };
    expect((await call("PUT", GLOBAL, cookies.B, own)).status).toBe(200);
    expect((await (await call("GET", GLOBAL, cookies.B)).json()).prefs).toEqual(
      own,
    );
    expect((await (await call("GET", GLOBAL, cookies.A)).json()).prefs).toEqual(
      arabicOnly(),
    );
    // Et la suppression de B ne touche pas ceux de A.
    expect((await call("DELETE", GLOBAL, cookies.B)).status).toBe(200);
    expect((await (await call("GET", GLOBAL, cookies.A)).json()).prefs).toEqual(
      arabicOnly(),
    );
  });
});

describe("administrateur", () => {
  it("atteint la session privée de A, avec ses propres réglages (pas ceux de A)", async () => {
    const response = await call("GET", PRIVATE, cookies.ADMIN);
    expect(response.status).toBe(200);
    expect((await response.json()).prefs).toBeNull();
    expect(
      (await call("PUT", PRIVATE, cookies.ADMIN, arabicOnly())).status,
    ).toBe(200);
    expect(
      (await (await call("GET", PRIVATE, cookies.A)).json()).prefs,
    ).toEqual(noTranslation());
  });
});

describe("remise à zéro", () => {
  it("DELETE rend la vidéo à son point de départ", async () => {
    expect((await call("DELETE", PRIVATE, cookies.A)).status).toBe(200);
    expect(
      (await (await call("GET", PRIVATE, cookies.A)).json()).prefs,
    ).toBeNull();
    expect((await (await call("GET", GLOBAL, cookies.A)).json()).prefs).toEqual(
      arabicOnly(),
    );
  });
});
