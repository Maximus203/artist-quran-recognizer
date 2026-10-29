import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Lister et lever les blocages : réservé aux administrateurs, sans jamais montrer l'adresse. */
let dir = "";
let adminCookie = "";
let userCookie = "";
let hash = "";
let GET: typeof import("./route").GET;
let DELETE: typeof import("./[hash]/route").DELETE;

const withCookie = (cookie: string, method = "GET") =>
  new Request("http://127.0.0.1:3000/api/admin/blocks", {
    method,
    headers: { cookie: `aqr_session=${cookie}` },
  });

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-blocks-"));
  vi.stubEnv("AQR_REVIEW_DIR", dir);
  const { getDb } = await import("@/lib/db");
  const { createUser } = await import("@/lib/users");
  const { createLogin, authConfig } = await import("@/lib/auth");
  const { BlockList } = await import("@/lib/blocklist");
  const db = getDb();
  const admin = createUser(db, { username: "admin1", passwordHash: "x" });
  const user = createUser(db, { username: "simple", passwordHash: "x" });
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.id);
  adminCookie = createLogin(db, admin.id, authConfig());
  userCookie = createLogin(db, user.id, authConfig());
  hash = new BlockList(db).strike("203.0.113.99", "route piège").hash;
  ({ GET } = await import("./route"));
  ({ DELETE } = await import("./[hash]/route"));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  const { closeDb } = await import("@/lib/db");
  closeDb();
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("administration des blocages", () => {
  it("un utilisateur ordinaire est refusé", async () => {
    expect((await GET(withCookie(userCookie))).status).toBe(403);
    const res = await DELETE(withCookie(userCookie, "DELETE"), {
      params: Promise.resolve({ hash }),
    });
    expect(res.status).toBe(403);
  });
  it("l'administrateur voit l'empreinte, la raison, la fin ; jamais l'adresse", async () => {
    const response = await GET(withCookie(adminCookie));
    const text = await response.text();
    expect(text).not.toContain("203.0.113.99");
    const { items } = JSON.parse(text);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ hash, reason: "route piège", strikes: 1 });
  });
  it("l'administrateur lève le blocage ; le refaire donne 404 ; une empreinte inventée aussi", async () => {
    const lift = (value: string) =>
      DELETE(withCookie(adminCookie, "DELETE"), {
        params: Promise.resolve({ hash: value }),
      });
    expect((await lift(hash)).status).toBe(204);
    expect((await lift(hash)).status).toBe(404);
    expect((await lift("n'importe quoi")).status).toBe(404);
    expect((await (await GET(withCookie(adminCookie))).json()).items).toEqual(
      [],
    );
  });
});
