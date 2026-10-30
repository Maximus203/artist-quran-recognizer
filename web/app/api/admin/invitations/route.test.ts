import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Invitations de testeurs, côté administrateur : créer (lien montré une seule fois), lister, révoquer. */
let dir = "";
let cookies = { admin: "", user: "" };
let list: typeof import("./route");
let one: typeof import("./[id]/route");

const req = (
  method: string,
  who: "admin" | "user" | null,
  body?: unknown,
  url = "http://127.0.0.1:3000/api/admin/invitations",
) =>
  new Request(url, {
    method,
    headers: {
      ...(who ? { cookie: `aqr_session=${cookies[who]}` } : {}),
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const del = (who: "admin" | "user" | null, id: number | string) =>
  one.DELETE(
    req(
      "DELETE",
      who,
      undefined,
      `http://127.0.0.1:3000/api/admin/invitations/${id}`,
    ),
    { params: Promise.resolve({ id: String(id) }) },
  );

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-admin-invit-"));
  vi.stubEnv("AQR_REVIEW_DIR", dir);
  const { getDb } = await import("@/lib/db");
  const { createUser } = await import("@/lib/users");
  const { createLogin, authConfig } = await import("@/lib/auth");
  const db = getDb();
  const admin = createUser(db, { username: "admin1", passwordHash: "x" });
  const user = createUser(db, { username: "simple", passwordHash: "x" });
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.id);
  cookies = {
    admin: createLogin(db, admin.id, authConfig()),
    user: createLogin(db, user.id, authConfig()),
  };
  list = await import("./route");
  one = await import("./[id]/route");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  const { closeDb } = await import("@/lib/db");
  closeDb();
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("droits", () => {
  it("sans connexion : 401 ; testeur : 403 ; partout", async () => {
    for (const who of [null, "user"] as const) {
      const expected = who === null ? 401 : 403;
      expect((await list.GET(req("GET", who))).status).toBe(expected);
      expect((await list.POST(req("POST", who, { label: "x" }))).status).toBe(
        expected,
      );
      expect((await del(who, 1)).status).toBe(expected);
    }
  });
});

describe("création et liste", () => {
  it("crée une invitation : le jeton n'est rendu qu'une fois, jamais dans la liste", async () => {
    const res = await list.POST(
      req("POST", "admin", {
        label: "Aminata",
        expires_in_days: 7,
        max_uses: 2,
      }),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    const { token, invitation } = await res.json();
    expect(token).toMatch(/^inv_[A-Za-z0-9_-]{22}$/);
    expect(invitation).toMatchObject({
      label: "Aminata",
      max_uses: 2,
      uses: 0,
    });
    const listing = JSON.stringify(
      await (await list.GET(req("GET", "admin"))).json(),
    );
    expect(listing).toContain("Aminata");
    expect(listing).not.toContain(token);
    expect(listing).not.toContain("token_hash");
  });

  it("valeurs par défaut sans les champs facultatifs", async () => {
    const { invitation } = await (
      await list.POST(req("POST", "admin", { label: "Fatou" }))
    ).json();
    expect(invitation.max_uses).toBe(1);
  });

  it("corps invalide : 400, jamais une erreur serveur", async () => {
    for (const bad of [
      {},
      { label: "" },
      { label: "x".repeat(61) },
      { label: "ok", max_uses: 0 },
      { label: "ok", max_uses: 21 },
      { label: "ok", expires_in_days: 0 },
      { label: "ok", expires_in_days: 91 },
      { label: "ok", extra: 1 },
      { label: 5 },
    ]) {
      const res = await list.POST(req("POST", "admin", bad));
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });
});

describe("révocation", () => {
  it("révoque une invitation, puis 404 la seconde fois ; identifiant absurde : 404", async () => {
    const { invitation } = await (
      await list.POST(req("POST", "admin", { label: "À révoquer" }))
    ).json();
    expect((await del("admin", invitation.id)).status).toBe(200);
    expect((await del("admin", invitation.id)).status).toBe(404);
    for (const id of [0, -1, "abc", 99999])
      expect((await del("admin", id)).status, String(id)).toBe(404);
  });
});
