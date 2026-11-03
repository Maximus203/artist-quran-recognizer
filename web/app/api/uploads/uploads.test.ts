import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pas de ffprobe ni de ffmpeg dans ces tests : la sonde et la copie d'écoute sont simulées.
vi.mock("@/lib/media-probe", async (original) => ({
  ...(await original<typeof import("@/lib/media-probe")>()),
  inspectUpload: async () => ({ duration_s: 12, probed: true }),
}));
vi.mock("@/lib/listening", async (original) => ({
  ...(await original<typeof import("@/lib/listening")>()),
  ensureListening: async () => undefined,
}));

/**
 * Envoi par morceaux, de bout en bout par les VRAIES routes : création, morceaux dans le désordre avec reprise,
 * état, assemblage (même réponse que l'envoi unique), isolement entre comptes, mode restreint.
 */
const HOST = "http://127.0.0.1:3000";
const CHUNK = 1024;
let tmp = "";
let cookies = { awa: "", bou: "" };

async function routes() {
  return {
    create: await import("./route"),
    one: await import("./[id]/route"),
    chunk: await import("./[id]/chunks/[n]/route"),
    complete: await import("./[id]/complete/route"),
    sessions: await import("@/app/api/sessions/route"),
  };
}
let r: Awaited<ReturnType<typeof routes>>;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-uploads-"));
  vi.stubEnv("AQR_REVIEW_DIR", tmp);
  vi.stubEnv("AQR_UPLOAD_CHUNK_BYTES", String(CHUNK));
  vi.stubEnv("AQR_MIN_UPLOAD_CHUNK_BYTES", "256");
  r = await routes();
  const { getDb } = await import("@/lib/db");
  const { createUser } = await import("@/lib/users");
  const { createLogin, authConfig } = await import("@/lib/auth");
  const db = getDb();
  const awa = createUser(db, { username: "awa", passwordHash: "x" });
  const bou = createUser(db, { username: "bou", passwordHash: "x" });
  cookies = {
    awa: createLogin(db, awa.id, authConfig()),
    bou: createLogin(db, bou.id, authConfig()),
  };
});
afterEach(async () => {
  vi.unstubAllEnvs();
  const { closeDb } = await import("@/lib/db");
  closeDb();
  await rm(tmp, { recursive: true, force: true });
});

const as = (who: keyof typeof cookies | null): Record<string, string> =>
  who ? { cookie: `aqr_session=${cookies[who]}` } : {};
// Un « mp3 » : l'en-tête ID3 suffit à la reconnaissance du type, le reste est un remplissage reconnaissable.
const audio = (size: number) =>
  Buffer.concat([
    Buffer.from("ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000"),
    Buffer.from(Array.from({ length: size - 10 }, (_, i) => (i * 11) % 253)),
  ]);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const post = (
  route: { POST: (r: NextRequest) => Promise<Response> },
  path: string,
  body: unknown,
  who: keyof typeof cookies | null = "awa",
) =>
  route.POST(
    new NextRequest(`${HOST}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...as(who) },
      body: JSON.stringify(body),
    }),
  );
const start = async (size: number, extra: Record<string, unknown> = {}) => {
  const res = await post(r.create, "/api/uploads", {
    filename: "fatiha.mp3",
    size,
    ...extra,
  });
  return { res, body: (await res.json()) as Record<string, any> };
};
const put = (
  id: string,
  n: number | string,
  body: Buffer,
  who: keyof typeof cookies | null = "awa",
) =>
  r.chunk.PUT(
    new NextRequest(`${HOST}/api/uploads/${id}/chunks/${n}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", ...as(who) },
      body: new Uint8Array(body),
    }),
    { params: Promise.resolve({ id, n: String(n) }) },
  );
const status = (id: string, who: keyof typeof cookies | null = "awa") =>
  r.one.GET(
    new NextRequest(`${HOST}/api/uploads/${id}`, { headers: as(who) }),
    { params: Promise.resolve({ id }) },
  );
const complete = (
  id: string,
  body: unknown = {},
  who: keyof typeof cookies | null = "awa",
) =>
  r.complete.POST(
    new NextRequest(`${HOST}/api/uploads/${id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json", ...as(who) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

describe("parcours complet", () => {
  it("crée, reçoit dans le désordre avec une reprise, assemble et rend la session", async () => {
    const data = audio(CHUNK * 2 + 300);
    const { res, body } = await start(data.length, {
      name: "Al-Fatiha",
      autorun: false,
    });
    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      chunk_size: CHUNK,
      chunks: 3,
      size: data.length,
    });
    const id = body.id as string;
    const piece = (n: number) => data.subarray(n * CHUNK, (n + 1) * CHUNK);
    expect((await put(id, 2, piece(2))).status).toBe(200);
    expect((await put(id, 0, piece(0))).status).toBe(200);
    expect((await put(id, 0, piece(0))).status).toBe(200); // reprise : même morceau renvoyé
    const mid = await status(id);
    expect(await mid.json()).toMatchObject({ received: [0, 2], chunks: 3 });
    expect((await complete(id)).status).toBe(409); // il manque le morceau 1
    expect((await put(id, 1, piece(1))).status).toBe(200);
    const done = await complete(id, { sha256: sha(data) });
    expect(done.status).toBe(201);
    const session = await done.json();
    expect(session).toMatchObject({ name: "Al-Fatiha", state: "ready" });
    // La session est dans la liste du compte, et l'attente est vidée.
    const list = await r.sessions.GET(
      new NextRequest(`${HOST}/api/sessions`, { headers: as("awa") }),
    );
    expect((await list.json()).total).toBe(1);
    expect(await readdir(path.join(tmp, "uploads-staging"))).toEqual([]);
  });

  it("refuse un morceau de la mauvaise taille et un numéro étranger", async () => {
    const { body } = await start(CHUNK * 2);
    expect((await put(body.id, 0, Buffer.alloc(CHUNK - 1))).status).toBe(400);
    expect((await put(body.id, 0, Buffer.alloc(CHUNK + 1))).status).toBe(413);
    expect((await put(body.id, 9, Buffer.alloc(CHUNK))).status).toBe(400);
    expect((await put(body.id, "abc", Buffer.alloc(CHUNK))).status).toBe(400);
  });

  it("l'empreinte fausse est refusée à l'assemblage", async () => {
    const data = audio(CHUNK);
    const { body } = await start(data.length);
    await put(body.id, 0, data);
    expect((await complete(body.id, { sha256: "0".repeat(64) })).status).toBe(
      400,
    );
  });

  it("corps de création invalide : 400 avec le champ, jamais une erreur serveur", async () => {
    for (const bad of [
      {},
      { filename: "a.mp3" },
      { filename: "a.txt", size: 10 },
      { filename: "a.mp3", size: -4 },
      { filename: "a.mp3", size: 10, extra: 1 },
      { filename: "a.mp3", size: 10, visibility: "public" },
    ]) {
      const res = await post(r.create, "/api/uploads", bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });
});

describe("accès", () => {
  it("sans connexion : 401 partout", async () => {
    expect(
      (
        await post(
          r.create,
          "/api/uploads",
          { filename: "a.mp3", size: 10 },
          null,
        )
      ).status,
    ).toBe(401);
    expect((await status("a".repeat(32), null)).status).toBe(401);
    expect((await put("a".repeat(32), 0, Buffer.alloc(1), null)).status).toBe(
      401,
    );
    expect((await complete("a".repeat(32), {}, null)).status).toBe(401);
  });

  it("l'envoi d'un compte est introuvable (404) pour un autre compte, à chaque route", async () => {
    const data = audio(CHUNK);
    const { body } = await start(data.length);
    expect((await status(body.id, "bou")).status).toBe(404);
    expect((await put(body.id, 0, data, "bou")).status).toBe(404);
    expect((await complete(body.id, {}, "bou")).status).toBe(404);
    const del = await r.one.DELETE(
      new NextRequest(`${HOST}/api/uploads/${body.id}`, {
        method: "DELETE",
        headers: as("bou"),
      }),
      { params: Promise.resolve({ id: body.id }) },
    );
    expect(del.status).toBe(404);
    expect((await status(body.id, "awa")).status).toBe(200); // intact pour son propriétaire
  });

  it("abandonner retire l'envoi", async () => {
    const { body } = await start(100);
    const del = await r.one.DELETE(
      new NextRequest(`${HOST}/api/uploads/${body.id}`, {
        method: "DELETE",
        headers: as("awa"),
      }),
      { params: Promise.resolve({ id: body.id }) },
    );
    expect(del.status).toBe(200);
    expect((await status(body.id)).status).toBe(404);
  });

  it("le nombre d'envois en cours est borné par compte (429), l'autre compte n'est pas touché", async () => {
    for (let i = 0; i < 3; i++) expect((await start(100)).res.status).toBe(201);
    expect((await start(100)).res.status).toBe(429);
    expect(
      (
        await post(
          r.create,
          "/api/uploads",
          { filename: "a.mp3", size: 10 },
          "bou",
        )
      ).status,
    ).toBe(201);
  });
});

describe("corps d'un morceau", () => {
  it("un corps sans Content-Length qui dépasse le plafond est coupé, pas lu en entier", async () => {
    const { body } = await start(CHUNK);
    const big = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 12; i++)
          controller.enqueue(new Uint8Array(1024 * 1024));
        controller.close();
      },
    });
    const res = await r.chunk.PUT(
      new NextRequest(`${HOST}/api/uploads/${body.id}/chunks/0`, {
        method: "PUT",
        headers: as("awa"),
        body: big,
        duplex: "half",
      }),
      { params: Promise.resolve({ id: body.id, n: "0" }) },
    );
    expect(res.status).toBe(413);
  });
});
