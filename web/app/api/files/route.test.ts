import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Fichiers : chaque compte voit les exports de ses sessions, l'administrateur voit tout. */
let dir = "";
let cookies = { admin: "", me: "", other: "" };
let route: typeof import("./route");
const T = "2026-11-03T14:00:00.000Z";

const get = (who: "admin" | "me" | "other" | null) =>
  route.GET(
    new Request("http://127.0.0.1:3000/api/files", {
      headers: who ? { cookie: `aqr_session=${cookies[who]}` } : {},
    }),
  );
type Body = {
  scope: "mine" | "all";
  files: Array<{
    id: string;
    session_id: string;
    owner_name: string | null;
    mine: boolean;
    bytes: number;
    download_url: string;
  }>;
  total_bytes: number;
  quota: {
    used_bytes: number;
    limit_bytes: number | null;
    audio_bytes: number;
    video_bytes: number;
  };
};

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-files-"));
  vi.stubEnv("AQR_REVIEW_DIR", dir);
  const { getDb } = await import("@/lib/db");
  const { createUser } = await import("@/lib/users");
  const { createLogin, authConfig } = await import("@/lib/auth");
  const { recordExport } = await import("@/lib/export-index");
  const db = getDb();
  const admin = createUser(db, { username: "admin1", passwordHash: "x" });
  const me = createUser(db, { username: "moi", passwordHash: "x" });
  const other = createUser(db, { username: "autre", passwordHash: "x" });
  const meta = db.prepare(
    `INSERT INTO session_meta (id, owner_id, name, original_name, visibility, created_at, updated_at, size_bytes, state)
     VALUES (?, ?, ?, ?, 'private', ?, ?, ?, 'done')`,
  );
  meta.run("mine1", me.id, "Mon audio", "a.wav", T, T, 1000);
  meta.run("theirs", other.id, "Leur audio", "b.wav", T, T, 2000);
  const video = (id: string, session: string, owner: number, bytes: number) =>
    recordExport(db, {
      id,
      sessionId: session,
      ownerId: owner,
      name: `${id}.mp4`,
      bytes,
      createdAt: T,
    });
  video("v1", "mine1", me.id, 400);
  video("v2", "theirs", other.id, 700);
  cookies = {
    admin: createLogin(db, admin.id, authConfig()),
    me: createLogin(db, me.id, authConfig()),
    other: createLogin(db, other.id, authConfig()),
  };
  route = await import("./route");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  const { closeDb } = await import("@/lib/db");
  closeDb();
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("GET /api/files", () => {
  it("sans connexion : 401", async () => {
    expect((await get(null)).status).toBe(401);
  });

  it("un compte ne reçoit que les fichiers de ses sessions, avec son espace", async () => {
    const body = (await (await get("me")).json()) as Body;
    expect(body.scope).toBe("mine");
    expect(body.files.map((f) => f.id)).toEqual(["v1"]);
    expect(body.files[0]).toMatchObject({
      session_id: "mine1",
      mine: true,
      bytes: 400,
      download_url: "/api/sessions/mine1/videos/v1?download=1",
    });
    expect(body.total_bytes).toBe(400);
    expect(body.quota).toMatchObject({
      audio_bytes: 1000,
      video_bytes: 400,
      used_bytes: 1400,
      limit_bytes: 2 * 1024 ** 3,
    });
  });

  it("l'administrateur reçoit tous les fichiers, les siens marqués", async () => {
    const body = (await (await get("admin")).json()) as Body;
    expect(body.scope).toBe("all");
    expect(body.files.map((f) => f.id)).toEqual(["v2", "v1"]);
    expect(body.files.map((f) => f.owner_name)).toEqual(["autre", "moi"]);
    expect(body.files.every((f) => f.mine === false)).toBe(true);
    expect(body.total_bytes).toBe(1100);
  });
});
