import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pas de ffprobe ni de ffmpeg ici : la sonde et la préparation sont simulées (les vrais sont éprouvés sur de vraies vidéos).
vi.mock("@/lib/background-video-media", async (original) => ({
  ...(await original<typeof import("@/lib/background-video-media")>()),
  ffprobeClip: async () => ({
    duration: 12,
    width: 1280,
    height: 720,
    codec: "h264",
  }),
  normalizeClip: async (input: {
    output: string;
    onRatio: (r: number) => void;
  }) => {
    const { writeFile } = await import("node:fs/promises");
    input.onRatio(1);
    await writeFile(input.output, Buffer.from("0123456789".repeat(100)));
  },
}));

/**
 * Vidéo de fond, de bout en bout par les VRAIES routes : création, morceaux avec reprise, assemblage, état,
 * lecture par intervalles, suppression, isolement entre comptes et entre sessions.
 */
const HOST = "http://127.0.0.1:3000";
const CHUNK = 1024;
const MINE = "00000000-0000-4000-8000-0000000000b1";
const THEIRS = "00000000-0000-4000-8000-0000000000b2";
let tmp = "";
let cookies = { awa: "", bou: "", admin: "" };

async function routes() {
  const base = "./";
  return {
    list: await import(base + "route"),
    one: await import(base + "[vid]/route"),
    chunk: await import(base + "[vid]/chunks/[n]/route"),
    complete: await import(base + "[vid]/complete/route"),
    file: await import(base + "[vid]/file/route"),
  };
}
let r: Awaited<ReturnType<typeof routes>>;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-clips-routes-"));
  vi.stubEnv("AQR_REVIEW_DIR", tmp);
  vi.stubEnv("AQR_UPLOAD_CHUNK_BYTES", String(CHUNK));
  vi.stubEnv("AQR_MIN_UPLOAD_CHUNK_BYTES", "256");
  r = await routes();
  const { getDb } = await import("@/lib/db");
  const { createUser } = await import("@/lib/users");
  const { createLogin, authConfig } = await import("@/lib/auth");
  const { createMeta } = await import("@/lib/session-index");
  const { saveSession } = await import("@/lib/store");
  const db = getDb();
  // Le premier compte créé est administrateur : c'est « chef » ; awa et bou sont de simples testeurs.
  const admin = createUser(db, { username: "chef", passwordHash: "x" });
  const awa = createUser(db, { username: "awa", passwordHash: "x" });
  const bou = createUser(db, { username: "bou", passwordHash: "x" });
  expect(admin.role).toBe("admin");
  expect([awa.role, bou.role]).toEqual(["user", "user"]);
  cookies = {
    awa: createLogin(db, awa.id, authConfig()),
    bou: createLogin(db, bou.id, authConfig()),
    admin: createLogin(db, admin.id, authConfig()),
  };
  for (const [id, owner, visibility] of [
    [MINE, awa.id, "private"],
    [THEIRS, bou.id, "private"],
  ] as const) {
    createMeta(db, {
      id,
      ownerId: owner,
      name: "essai",
      nameSource: "auto",
      originalName: "a.mp3",
      sourceKind: "file",
      visibility,
      createdAt: "2026-10-01T00:00:00.000Z",
      sizeBytes: 1,
    });
    await saveSession({
      id,
      name: "audio.mp3",
      extension: ".mp3",
      audio_sha256: "a".repeat(64),
      size: 1,
      source_kind: "file",
      created_at: "2026-10-01T00:00:00.000Z",
      state: "done",
      error: null,
      started_at: null,
      finished_at: null,
      prediction_sha256: null,
      pid: null,
    });
  }
});
afterEach(async () => {
  vi.unstubAllEnvs();
  const { closeDb } = await import("@/lib/db");
  closeDb();
  await rm(tmp, { recursive: true, force: true });
});

const as = (who: keyof typeof cookies | null): Record<string, string> =>
  who ? { cookie: `aqr_session=${cookies[who]}` } : {};
const mp4 = (size: number) =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from("ftypisom"),
    Buffer.from(Array.from({ length: size - 12 }, (_, i) => (i * 17) % 251)),
  ]);
const parts = (data: Buffer) =>
  Array.from({ length: Math.ceil(data.length / CHUNK) }, (_, i) =>
    data.subarray(i * CHUNK, (i + 1) * CHUNK),
  );

type Who = keyof typeof cookies | null;
const url = (session: string, tail = "") =>
  `${HOST}/api/sessions/${session}/background-videos${tail}`;
const params = (session: string, extra: Record<string, string> = {}) => ({
  params: Promise.resolve({ id: session, ...extra }),
});

async function create(session = MINE, who: Who = "awa", size = CHUNK * 3 + 50) {
  return r.list.POST(
    new NextRequest(url(session), {
      method: "POST",
      headers: { "content-type": "application/json", ...as(who) },
      body: JSON.stringify({ filename: "mer calme.mp4", size }),
    }),
    params(session),
  ) as Promise<Response>;
}
const put = (
  session: string,
  id: string,
  n: number,
  body: Buffer,
  who: Who = "awa",
) =>
  r.chunk.PUT(
    new NextRequest(url(session, `/${id}/chunks/${n}`), {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", ...as(who) },
      body: new Uint8Array(body),
    }),
    params(session, { vid: id, n: String(n) }),
  ) as Promise<Response>;
const get = (
  route: { GET: (r: NextRequest, c: unknown) => Promise<Response> },
  session: string,
  id: string,
  tail = "",
  who: Who = "awa",
  headers: Record<string, string> = {},
) =>
  route.GET(
    new NextRequest(url(session, `/${id}${tail}`), {
      headers: { ...as(who), ...headers },
    }),
    params(session, { vid: id }),
  );
const complete = (
  session: string,
  id: string,
  who: Who = "awa",
  body: unknown = {},
) =>
  r.complete.POST(
    new NextRequest(url(session, `/${id}/complete`), {
      method: "POST",
      headers: { "content-type": "application/json", ...as(who) },
      body: JSON.stringify(body),
    }),
    params(session, { vid: id }),
  ) as Promise<Response>;
const remove = (session: string, id: string, who: Who = "awa") =>
  r.one.DELETE(
    new NextRequest(url(session, `/${id}`), {
      method: "DELETE",
      headers: as(who),
    }),
    params(session, { vid: id }),
  ) as Promise<Response>;

/** Envoie tout et assemble ; rend l'identifiant. */
async function ready(session = MINE, who: Who = "awa") {
  const data = mp4(CHUNK * 3 + 50);
  const made = (await (await create(session, who, data.length)).json()) as {
    id: string;
  };
  for (const [n, body] of parts(data).entries())
    expect((await put(session, made.id, n, body, who)).status).toBe(200);
  const done = await complete(session, made.id, who);
  expect(done.status).toBe(202);
  const { settledClip } = await import("@/lib/background-video-store");
  await settledClip(made.id);
  return made.id;
}

describe("création", () => {
  it("201 : les morceaux, les plafonds dits en nombres ; jamais d'accès sans connexion", async () => {
    const response = await create();
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ chunk_size: CHUNK, chunks: 4 });
    expect(body.id).toMatch(/^[0-9a-f]{32}$/);
    expect(body.limits).toEqual({
      max_bytes: 500 * 1024 * 1024,
      max_seconds: 600,
      max_clips: 3,
    });
    expect((await create(MINE, null)).status).toBe(401);
  });

  it("refuse un format ou une taille inacceptable avec une phrase en français clair et un code", async () => {
    const bad = await r.list.POST(
      new NextRequest(url(MINE), {
        method: "POST",
        headers: { "content-type": "application/json", ...as("awa") },
        body: JSON.stringify({ filename: "notes.txt", size: 10 }),
      }),
      params(MINE),
    );
    expect(bad.status).toBe(400);
    const body = await bad.json();
    expect(body.code).toBe("format");
    expect(body.error).toMatch(/MP4/);
    const big = await create(MINE, "awa", 900 * 1024 * 1024);
    expect(big.status).toBe(413);
    expect((await big.json()).code).toBe("too_big");
  });

  it("corps invalide ou champ inconnu : 400", async () => {
    for (const body of [
      '{"filename":"a.mp4"}',
      '{"filename":"a.mp4","size":1,"x":1}',
      "pas du json",
    ]) {
      const response = await r.list.POST(
        new NextRequest(url(MINE), {
          method: "POST",
          headers: { "content-type": "application/json", ...as("awa") },
          body,
        }),
        params(MINE),
      );
      expect(response.status).toBe(400);
    }
  });

  it("la session d'un autre compte est « absente » : 404, rien n'est créé", async () => {
    expect((await create(THEIRS, "awa")).status).toBe(404);
    const dir = path.join(tmp, "background-videos");
    expect(await readdir(dir).catch(() => [])).toEqual([]);
  });

  it("la liste dit les plafonds et les vidéos de ce compte pour cette session", async () => {
    await create();
    const response = await r.list.GET(
      new NextRequest(url(MINE), { headers: as("awa") }),
      params(MINE),
    );
    const body = await response.json();
    expect(body.limits.max_seconds).toBe(600);
    expect(body.videos).toHaveLength(1);
    expect(body.videos[0].state).toBe("uploading");
  });
});

describe("morceaux et reprise", () => {
  it("reçoit les morceaux dans le désordre ; l'état dit ce qui manque", async () => {
    const data = mp4(CHUNK * 3 + 50);
    const made = await (await create(MINE, "awa", data.length)).json();
    const p = parts(data);
    expect((await put(MINE, made.id, 3, p[3])).status).toBe(200);
    expect((await put(MINE, made.id, 0, p[0])).status).toBe(200);
    const state = await (await get(r.one, MINE, made.id)).json();
    expect(state).toMatchObject({ state: "uploading", received: [0, 3] });
    // un morceau renvoyé après une coupure : sans risque
    expect((await put(MINE, made.id, 0, p[0])).status).toBe(200);
  });

  it("refuse un numéro invalide ou un morceau de mauvaise taille", async () => {
    const made = await (await create()).json();
    expect((await put(MINE, made.id, 0, Buffer.alloc(10))).status).toBe(400);
    expect((await put(MINE, made.id, 99, Buffer.alloc(CHUNK))).status).toBe(
      400,
    );
    const response = await r.chunk.PUT(
      new NextRequest(url(MINE, `/${made.id}/chunks/abc`), {
        method: "PUT",
        headers: as("awa"),
        body: new Uint8Array(CHUNK),
      }),
      params(MINE, { vid: made.id, n: "abc" }),
    );
    expect(response.status).toBe(400);
  });
});

describe("assemblage et préparation", () => {
  it("202 « en préparation », puis « prête » avec la durée et la taille ; la vidéo se lit par intervalles", async () => {
    const id = await ready();
    const state = await (await get(r.one, MINE, id)).json();
    expect(state).toMatchObject({
      state: "ready",
      duration: 12,
      width: 1280,
      height: 720,
      ratio: 1,
    });
    const full = (await get(r.file, MINE, id, "/file")) as Response;
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("video/mp4");
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(full.headers.get("cache-control")).toContain("no-store");
    expect((await full.arrayBuffer()).byteLength).toBe(1000);
    const part = (await get(r.file, MINE, id, "/file", "awa", {
      range: "bytes=10-19",
    })) as Response;
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 10-19/1000");
    expect(Buffer.from(await part.arrayBuffer()).toString()).toBe("0123456789");
    const bad = (await get(r.file, MINE, id, "/file", "awa", {
      range: "bytes=5000-6000",
    })) as Response;
    expect(bad.status).toBe(416);
  });

  it("la vidéo n'est pas servie tant qu'elle n'est pas prête : 409", async () => {
    const data = mp4(CHUNK * 3 + 50);
    const made = await (await create(MINE, "awa", data.length)).json();
    const response = (await get(r.file, MINE, made.id, "/file")) as Response;
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("not_ready");
  });

  it("un fichier qui n'est pas une vidéo (page web nommée .mp4) est refusé 415 et supprimé", async () => {
    const html = Buffer.concat([
      Buffer.from("<html>pas une vidéo</html>"),
      Buffer.alloc(CHUNK * 3),
    ]);
    const made = await (await create(MINE, "awa", html.length)).json();
    for (const [n, body] of parts(html).entries())
      await put(MINE, made.id, n, body);
    const response = await complete(MINE, made.id);
    expect(response.status).toBe(415);
    const body = await response.json();
    expect(body.code).toBe("format");
    expect(body.error).not.toMatch(/ffmpeg|ffprobe/i);
    expect((await get(r.one, MINE, made.id)).status).toBe(404);
  });

  it("il manque des morceaux : 409, on peut reprendre", async () => {
    const data = mp4(CHUNK * 3 + 50);
    const made = await (await create(MINE, "awa", data.length)).json();
    await put(MINE, made.id, 0, parts(data)[0]);
    expect((await complete(MINE, made.id)).status).toBe(409);
    expect((await get(r.one, MINE, made.id)).status).toBe(200);
  });

  it("empreinte annoncée fausse : 400 et tout est supprimé", async () => {
    const data = mp4(CHUNK * 3 + 50);
    const made = await (await create(MINE, "awa", data.length)).json();
    for (const [n, body] of parts(data).entries())
      await put(MINE, made.id, n, body);
    const response = await complete(MINE, made.id, "awa", {
      sha256: "0".repeat(64),
    });
    expect(response.status).toBe(400);
    expect((await get(r.one, MINE, made.id)).status).toBe(404);
  });

  it("corps de fin invalide (champ inconnu) : 400", async () => {
    const made = await (await create()).json();
    expect((await complete(MINE, made.id, "awa", { autre: 1 })).status).toBe(
      400,
    );
  });
});

describe("suppression", () => {
  it("supprime la vidéo ; elle devient introuvable", async () => {
    const id = await ready();
    expect((await remove(MINE, id)).status).toBe(200);
    expect((await get(r.one, MINE, id)).status).toBe(404);
    expect((await get(r.file, MINE, id, "/file")).status).toBe(404);
  });
});

describe("isolement : compte, session, administrateur", () => {
  it("un autre compte ne voit, ne complète, ne lit et ne supprime rien : 404 partout", async () => {
    const id = await ready();
    expect((await get(r.one, MINE, id, "", "bou")).status).toBe(404);
    expect((await get(r.file, MINE, id, "/file", "bou")).status).toBe(404);
    expect((await put(MINE, id, 0, Buffer.alloc(CHUNK), "bou")).status).toBe(
      404,
    );
    expect((await complete(MINE, id, "bou")).status).toBe(404);
    expect((await remove(MINE, id, "bou")).status).toBe(404);
    // et rien n'a bougé pour le propriétaire
    expect((await get(r.file, MINE, id, "/file")).status).toBe(200);
  });

  it("même avec le bon identifiant, la vidéo d'une session n'est pas lisible depuis une autre session", async () => {
    const id = await ready();
    expect((await get(r.one, THEIRS, id, "", "bou")).status).toBe(404);
    expect((await get(r.one, THEIRS, id, "", "awa")).status).toBe(404);
  });

  it("l'administrateur voit la session mais pas la vidéo d'un autre compte", async () => {
    const id = await ready();
    expect((await get(r.one, MINE, id, "", "admin")).status).toBe(404);
    expect((await get(r.file, MINE, id, "/file", "admin")).status).toBe(404);
    expect((await remove(MINE, id, "admin")).status).toBe(404);
  });

  it("sans connexion : 401 sur chaque route", async () => {
    const id = await ready();
    expect((await get(r.one, MINE, id, "", null)).status).toBe(401);
    expect((await get(r.file, MINE, id, "/file", null)).status).toBe(401);
    expect((await put(MINE, id, 0, Buffer.alloc(CHUNK), null)).status).toBe(
      401,
    );
    expect((await complete(MINE, id, null)).status).toBe(401);
    expect((await remove(MINE, id, null)).status).toBe(401);
  });

  it("un identifiant piégé est refusé sans toucher au disque", async () => {
    for (const id of ["../..", "..%2f..", "a".repeat(31), "G".repeat(32)])
      expect((await get(r.one, MINE, id)).status).toBe(404);
  });
});
