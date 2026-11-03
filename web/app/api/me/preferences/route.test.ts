import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Préférences du compte par l'API, avec le format de l'éditeur d'export : le choix fait sur un navigateur est
 * retrouvé sur un autre (c'est le serveur qui le garde), validé côté serveur, sans effet sur les autres clés.
 */
let dir = "";
let cookies = { phone: "", laptop: "", other: "" };
let route: typeof import("./route");

const req = (
  method: string,
  who: keyof typeof cookies | null,
  body?: unknown,
  url = "http://127.0.0.1:3000/api/me/preferences",
) =>
  new Request(url, {
    method,
    headers: {
      ...(who ? { cookie: `aqr_session=${cookies[who]}` } : {}),
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const prefs = async (who: keyof typeof cookies) =>
  (await (await route.GET(req("GET", who))).json()) as {
    preferences: Record<string, unknown>;
    updated_at: Record<string, string>;
  };

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-prefs-route-"));
  vi.stubEnv("AQR_REVIEW_DIR", dir);
  const { getDb } = await import("@/lib/db");
  const { createUser } = await import("@/lib/users");
  const { createLogin, authConfig } = await import("@/lib/auth");
  const db = getDb();
  const awa = createUser(db, { username: "awa", passwordHash: "x" });
  const bou = createUser(db, { username: "bou", passwordHash: "x" });
  // Deux connexions du MÊME compte (téléphone, ordinateur) et un autre compte.
  cookies = {
    phone: createLogin(db, awa.id, authConfig()),
    laptop: createLogin(db, awa.id, authConfig()),
    other: createLogin(db, bou.id, authConfig()),
  };
  route = await import("./route");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  const { closeDb } = await import("@/lib/db");
  closeDb();
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("le format de l'éditeur d'export, par l'API", () => {
  it("sans connexion : 401, rien n'est lu ni écrit", async () => {
    expect((await route.GET(req("GET", null))).status).toBe(401);
    expect(
      (await route.PATCH(req("PATCH", null, { editorMode: "pas" }))).status,
    ).toBe(401);
  });

  it("jamais choisi : null et sans horodatage", async () => {
    const view = await prefs("phone");
    expect(view.preferences.editorMode).toBeNull();
    expect(view.updated_at.editorMode).toBeUndefined();
  });

  it("enregistré depuis un appareil, retrouvé depuis un autre, absent chez un autre compte", async () => {
    const res = await route.PATCH(
      req("PATCH", "phone", { editorMode: "table" }),
    );
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { preferences: { editorMode: string } })
        .preferences.editorMode,
    ).toBe("table");

    const laptop = await prefs("laptop");
    expect(laptop.preferences.editorMode).toBe("table");
    expect(typeof laptop.updated_at.editorMode).toBe("string");

    expect((await prefs("other")).preferences.editorMode).toBeNull();
  });

  it("PUT et PATCH sont équivalents ; on change d'avis d'un seul geste", async () => {
    const res = await route.PUT(req("PUT", "laptop", { editorMode: "pas" }));
    expect(res.status).toBe(200);
    expect((await prefs("phone")).preferences.editorMode).toBe("pas");
  });

  it("un format inconnu est refusé (400) et la valeur précédente reste", async () => {
    for (const bad of ["carrousel", "", 2, false, ["pas"], { mode: "pas" }]) {
      const res = await route.PATCH(req("PATCH", "phone", { editorMode: bad }));
      expect(res.status).toBe(400);
    }
    expect((await prefs("phone")).preferences.editorMode).toBe("pas");
  });

  it("une clé inconnue refuse tout le corps, même accompagnée d'un format valide", async () => {
    const res = await route.PATCH(
      req("PATCH", "phone", { editorMode: "plateau", editeur: "x" }),
    );
    expect(res.status).toBe(400);
    expect((await prefs("phone")).preferences.editorMode).toBe("pas");
  });

  it("un ancien client, qui ne connaît pas la clé, ne l'efface pas en enregistrant autre chose", async () => {
    const res = await route.PATCH(req("PATCH", "laptop", { volume: 0.4 }));
    expect(res.status).toBe(200);
    const view = await prefs("phone");
    expect(view.preferences.editorMode).toBe("pas");
    expect(view.preferences.volume).toBe(0.4);
  });

  it("null remet « jamais choisi » ; DELETE ?key=editorMode aussi, sans toucher le reste", async () => {
    await route.PATCH(req("PATCH", "phone", { editorMode: "plateau" }));
    await route.PATCH(req("PATCH", "phone", { editorMode: null }));
    expect((await prefs("phone")).preferences.editorMode).toBeNull();

    await route.PATCH(req("PATCH", "phone", { editorMode: "table" }));
    const res = await route.DELETE(
      req(
        "DELETE",
        "phone",
        undefined,
        "http://127.0.0.1:3000/api/me/preferences?key=editorMode",
      ),
    );
    expect(res.status).toBe(200);
    const view = await prefs("laptop");
    expect(view.preferences.editorMode).toBeNull();
    expect(view.preferences.volume).toBe(0.4);
  });
});
