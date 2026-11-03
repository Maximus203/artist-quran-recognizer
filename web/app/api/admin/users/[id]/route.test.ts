import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Un administrateur lève le verrou de connexion d'un compte ; un simple utilisateur ne le peut pas. */
let dir = "";
let adminCookie = "";
let userCookie = "";
let targetId = 0;
let PATCH: typeof import("./route").PATCH;
let attempt: (password: string, ip: string) => Promise<{ ok: boolean }>;

const call = (cookie: string, body: unknown) =>
  PATCH(
    new Request(`http://127.0.0.1:3000/api/admin/users/${targetId}`, {
      method: "PATCH",
      headers: {
        cookie: `aqr_session=${cookie}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(targetId) }) },
  );

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-admin-unlock-"));
  vi.stubEnv("AQR_REVIEW_DIR", dir);
  const { getDb } = await import("@/lib/db");
  const { createUser } = await import("@/lib/users");
  const { createLogin, authConfig, loginAccount } = await import("@/lib/auth");
  const { hashPassword } = await import("@/lib/passwords");
  const { authDeps } = await import("@/lib/route-guard");
  const db = getDb();
  const hash = await hashPassword("phrase de passe correcte 2026");
  const admin = createUser(db, { username: "admin1", passwordHash: hash });
  const user = createUser(db, { username: "simple", passwordHash: hash });
  const target = createUser(db, { username: "cible", passwordHash: hash });
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.id);
  targetId = target.id;
  adminCookie = createLogin(db, admin.id, authConfig());
  userCookie = createLogin(db, user.id, authConfig());
  attempt = async (password, ip) =>
    loginAccount(await authDeps(), { username: "cible", password }, ip);
  ({ PATCH } = await import("./route"));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  const { getDb } = await import("@/lib/db");
  getDb().close();
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("PATCH /api/admin/users/[id] { unlock: true }", () => {
  it("un utilisateur ordinaire est refusé", async () => {
    expect((await call(userCookie, { unlock: true })).status).toBe(403);
  });
  it("l'administrateur lève un verrou posé par une attaque répartie", async () => {
    for (let i = 0; i < 12; i++)
      await attempt("faux faux faux faux", `203.0.113.${i}`);
    expect(
      (await attempt("phrase de passe correcte 2026", "198.51.100.5")).ok,
    ).toBe(false);
    const response = await call(adminCookie, { unlock: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ unlocked: true });
    expect(
      (await attempt("phrase de passe correcte 2026", "198.51.100.5")).ok,
    ).toBe(true);
  });
  it("compte inconnu : 404", async () => {
    const response = await PATCH(
      new Request("http://127.0.0.1:3000/api/admin/users/9999", {
        method: "PATCH",
        headers: {
          cookie: `aqr_session=${adminCookie}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ unlock: true }),
      }),
      { params: Promise.resolve({ id: "9999" }) },
    );
    expect(response.status).toBe(404);
  });
});

describe("rôle récitateur", () => {
  it("un administrateur promeut un compte en récitateur, puis le rétrograde en testeur", async () => {
    expect((await call(adminCookie, { role: "recitant" })).status).toBe(200);
    const { getDb } = await import("@/lib/db");
    const row = getDb()
      .prepare("SELECT role FROM users WHERE id = ?")
      .get(targetId) as { role: string };
    expect(row.role).toBe("recitant");
    expect((await call(adminCookie, { role: "user" })).status).toBe(200);
  });
});

describe("suppression d'un compte", () => {
  const remove = async (cookie: string, id: number) => {
    const { DELETE } = await import("./route");
    return DELETE(
      new Request(`http://127.0.0.1:3000/api/admin/users/${id}`, {
        method: "DELETE",
        headers: { cookie: `aqr_session=${cookie}` },
      }),
      { params: Promise.resolve({ id: String(id) }) },
    );
  };
  const make = async (name: string) => {
    const { getDb } = await import("@/lib/db");
    const { createUser } = await import("@/lib/users");
    return createUser(getDb(), { username: name, passwordHash: "x" }).id;
  };

  it("un administrateur supprime un compte ; un testeur ne le peut pas", async () => {
    const id = await make("aSupprimer");
    expect((await remove(userCookie, id)).status).toBe(403);
    expect((await remove(adminCookie, id)).status).toBe(204);
    const { getUser } = await import("@/lib/users");
    const { getDb } = await import("@/lib/db");
    expect(getUser(getDb(), id)).toBeNull();
    expect((await remove(adminCookie, id)).status).toBe(404);
  });

  it("refuse de supprimer son propre compte", async () => {
    const { getDb } = await import("@/lib/db");
    const me = (
      getDb()
        .prepare("SELECT id FROM users WHERE username = 'admin1'")
        .get() as { id: number }
    ).id;
    const res = await remove(adminCookie, me);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("self");
  });
});
