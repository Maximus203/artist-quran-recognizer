import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Playlists : chaque compte gère les siennes, et n'y met que des audios qu'il voit. */
let dir = "";
let cookies = { me: "", other: "" };
let list: typeof import("./route");
let one: typeof import("./[id]/route");
let items: typeof import("./[id]/items/route");
let item: typeof import("./[id]/items/[sessionId]/route");
const T = "2026-11-03T14:00:00.000Z";

const req = (
  method: string,
  who: "me" | "other" | null,
  body?: unknown,
  url = "http://127.0.0.1:3000/api/playlists",
) =>
  new Request(url, {
    method,
    headers: {
      ...(who ? { cookie: `aqr_session=${cookies[who]}` } : {}),
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const at = (id: number | string, tail = "") =>
  `http://127.0.0.1:3000/api/playlists/${id}${tail}`;
const idp = (id: number | string) => ({
  params: Promise.resolve({ id: String(id) }),
});

const create = async (who: "me" | "other", body: unknown) =>
  (await (await list.POST(req("POST", who, body))).json()) as {
    playlist: { id: number };
    added: { added: number; skipped: number } | null;
  };
const read = async (who: "me" | "other", id: number) =>
  (await (
    await one.GET(req("GET", who, undefined, at(id)), idp(id))
  ).json()) as {
    playlist: { items: { session_id: string }[]; name: string };
  };

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-playlists-"));
  vi.stubEnv("AQR_REVIEW_DIR", dir);
  const { getDb } = await import("@/lib/db");
  const { createUser } = await import("@/lib/users");
  const { createLogin, authConfig } = await import("@/lib/auth");
  const db = getDb();
  createUser(db, { username: "admin1", passwordHash: "x" });
  const me = createUser(db, { username: "moi", passwordHash: "x" });
  const other = createUser(db, { username: "autre", passwordHash: "x" });
  const meta = db.prepare(
    `INSERT INTO session_meta (id, owner_id, name, original_name, visibility, created_at, updated_at, audio_duration_s, state)
     VALUES (?, ?, ?, ?, ?, ?, ?, 12, 'done')`,
  );
  meta.run("mine1", me.id, "Mon audio", "a.wav", "private", T, T);
  meta.run("mine2", me.id, "Mon second", "b.wav", "global", T, T);
  meta.run("shared", other.id, "Partagé", "c.wav", "global", T, T);
  meta.run("hidden", other.id, "Privé d'autrui", "d.wav", "private", T, T);
  cookies = {
    me: createLogin(db, me.id, authConfig()),
    other: createLogin(db, other.id, authConfig()),
  };
  list = await import("./route");
  one = await import("./[id]/route");
  items = await import("./[id]/items/route");
  item = await import("./[id]/items/[sessionId]/route");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  const { closeDb } = await import("@/lib/db");
  closeDb();
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("droits", () => {
  it("sans connexion : 401 partout", async () => {
    expect((await list.GET(req("GET", null))).status).toBe(401);
    expect((await list.POST(req("POST", null, { name: "x" }))).status).toBe(
      401,
    );
    expect(
      (await one.GET(req("GET", null, undefined, at(1)), idp(1))).status,
    ).toBe(401);
  });
});

describe("création et lecture", () => {
  it("crée une playlist avec des audios d'emblée ; la liste donne nombre et durée", async () => {
    const made = await create("me", {
      name: "Révision",
      session_ids: ["mine1", "shared", "hidden", "nope"],
    });
    expect(made.added).toEqual({ added: 2, skipped: 2 });
    const listing = await (await list.GET(req("GET", "me"))).json();
    expect(listing.items).toEqual([
      expect.objectContaining({ name: "Révision", count: 2, duration_s: 24 }),
    ]);
    const detail = await read("me", made.playlist.id);
    expect(detail.playlist.items.map((i) => i.session_id)).toEqual([
      "mine1",
      "shared",
    ]);
  });

  it("nom invalide ou corps inconnu : 400", async () => {
    for (const bad of [
      {},
      { name: "" },
      { name: "x".repeat(61) },
      { name: "ok", extra: 1 },
    ])
      expect(
        (await list.POST(req("POST", "me", bad))).status,
        JSON.stringify(bad),
      ).toBe(400);
  });

  it("une playlist est invisible et intouchable pour un autre compte (404)", async () => {
    const { playlist } = await create("me", { name: "Secrète" });
    expect(
      (
        await one.GET(
          req("GET", "other", undefined, at(playlist.id)),
          idp(playlist.id),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await one.PATCH(
          req("PATCH", "other", { name: "Volée" }, at(playlist.id)),
          idp(playlist.id),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await one.DELETE(
          req("DELETE", "other", undefined, at(playlist.id)),
          idp(playlist.id),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await items.POST(
          req(
            "POST",
            "other",
            { session_ids: ["shared"] },
            at(playlist.id, "/items"),
          ),
          idp(playlist.id),
        )
      ).status,
    ).toBe(404);
    const others = await (await list.GET(req("GET", "other"))).json();
    expect(others.items).toEqual([]);
  });
});

describe("contenu et ordre", () => {
  it("ajoute, réordonne, retire ; l'ordre doit être une permutation exacte", async () => {
    const { playlist } = await create("me", { name: "Ordre" });
    const add = await items.POST(
      req(
        "POST",
        "me",
        { session_ids: ["mine1", "mine2", "shared"] },
        at(playlist.id, "/items"),
      ),
      idp(playlist.id),
    );
    expect(await add.json()).toEqual({ added: 3, skipped: 0 });

    const patch = (body: unknown) =>
      one.PATCH(req("PATCH", "me", body, at(playlist.id)), idp(playlist.id));
    expect((await patch({ order: ["shared", "mine1", "mine2"] })).status).toBe(
      200,
    );
    expect(
      (await read("me", playlist.id)).playlist.items.map((i) => i.session_id),
    ).toEqual(["shared", "mine1", "mine2"]);
    expect((await patch({ order: ["shared", "mine1"] })).status).toBe(409);
    expect((await patch({ name: "Renommée" })).status).toBe(200);
    expect((await read("me", playlist.id)).playlist.name).toBe("Renommée");

    const remove = (sessionId: string) =>
      item.DELETE(
        req("DELETE", "me", undefined, at(playlist.id, `/items/${sessionId}`)),
        { params: Promise.resolve({ id: String(playlist.id), sessionId }) },
      );
    expect((await remove("mine1")).status).toBe(200);
    expect((await remove("mine1")).status).toBe(404);
    expect(
      (await read("me", playlist.id)).playlist.items.map((i) => i.session_id),
    ).toEqual(["shared", "mine2"]);
  });

  it("supprime la playlist : 204, puis 404", async () => {
    const { playlist } = await create("me", { name: "Éphémère" });
    expect(
      (
        await one.DELETE(
          req("DELETE", "me", undefined, at(playlist.id)),
          idp(playlist.id),
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await one.DELETE(
          req("DELETE", "me", undefined, at(playlist.id)),
          idp(playlist.id),
        )
      ).status,
    ).toBe(404);
  });
});
