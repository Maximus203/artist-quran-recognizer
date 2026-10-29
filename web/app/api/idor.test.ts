import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Balayage IDOR (section 6 de docs/SECURITE-PRE-DEPLOIEMENT.md). Les routes de session sont
 * DÉCOUVERTES sur le disque : une route ajoutée demain sans garde fait échouer ce test, au lieu
 * d'être oubliée par une liste écrite à la main.
 *
 * A possède une session privée P et une session globale G. B est un autre compte, ADMIN un
 * administrateur (qui, par règle, ne voit pas non plus le privé d'autrui).
 */
const HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const ROUTES_DIR = path.join(__dirname, "sessions", "[id]");
const PRIVATE = "00000000-0000-4000-8000-0000000000a1";
const GLOBAL = "00000000-0000-4000-8000-0000000000a2";

type Handler = (
  request: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;
type Route = {
  url: string;
  file: string;
  methods: Array<{ method: string; handler: Handler }>;
};

let dir = "";
let routes: Route[] = [];
const cookies: Record<"A" | "B" | "ADMIN", string> = {
  A: "",
  B: "",
  ADMIN: "",
};

async function walk(
  current: string,
  segments: string[] = [],
): Promise<string[][]> {
  const found: string[][] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.isDirectory())
      found.push(
        ...(await walk(path.join(current, entry.name), [
          ...segments,
          entry.name,
        ])),
      );
    else if (entry.name === "route.ts") found.push(segments);
  }
  return found;
}

const urlOf = (id: string, segments: string[]) =>
  `http://127.0.0.1:3000/api/sessions/${id}/${segments.map((s) => (s === "[job]" ? "job1" : s)).join("/")}`.replace(
    /\/$/,
    "",
  );

function call(
  route: Route,
  method: Handler,
  verb: string,
  id: string,
  cookie?: string,
) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = `aqr_session=${cookie}`;
  const unsafe = verb !== "GET";
  if (unsafe) headers["content-type"] = "application/json";
  return method(
    new Request(urlOf(id, route.url.split("/")), {
      method: verb,
      headers,
      body: unsafe ? "{}" : undefined,
    }),
    { params: Promise.resolve({ id, job: "job1" }) },
  );
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-idor-"));
  vi.stubEnv("AQR_REVIEW_DIR", dir);
  const { getDb } = await import("@/lib/db");
  const { createUser } = await import("@/lib/users");
  const { createLogin, authConfig } = await import("@/lib/auth");
  const { createMeta } = await import("@/lib/session-index");
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
    name: "Privée de Awa",
    originalName: "p.mp3",
    visibility: "private",
  });
  createMeta(db, {
    ...base,
    id: GLOBAL,
    name: "Globale de Awa",
    originalName: "g.mp3",
    visibility: "global",
  });
  // Les sessions existent AUSSI sur le disque : sinon la lecture les retire de l'index et le balayage
  // serait trompé (un 404 « parce que la ligne a disparu », pas « parce que l'accès est refusé »).
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
  for (const segments of await walk(ROUTES_DIR)) {
    const file = path.join(ROUTES_DIR, ...segments, "route.ts");
    const module = (await import(/* @vite-ignore */ file)) as Record<
      string,
      unknown
    >;
    const methods = HTTP.filter(
      (verb) => typeof module[verb] === "function",
    ).map((verb) => ({
      method: verb,
      handler: module[verb] as Handler,
    }));
    routes.push({
      url: segments.join("/"),
      file: segments.join("/") || "(racine)",
      methods,
    });
  }
  routes = routes.filter((route) => route.methods.length > 0);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  const { getDb } = await import("@/lib/db");
  getDb().close();
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("découverte", () => {
  it("trouve les routes de session (le balayage ne tourne pas à vide)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(20);
    const verbs = routes.reduce((n, route) => n + route.methods.length, 0);
    expect(verbs).toBeGreaterThanOrEqual(28);
  });
});

describe("sans connexion : 401 partout", () => {
  it("chaque méthode de chaque route de session", async () => {
    const wrong: string[] = [];
    for (const route of routes)
      for (const { method, handler } of route.methods) {
        const response = await call(route, handler, method, PRIVATE);
        if (response.status !== 401)
          wrong.push(`${method} /${route.file} → ${response.status}`);
      }
    expect(wrong).toEqual([]);
  });
});

describe("compte B et administrateur face à la session PRIVÉE de A : 404 partout (jamais 200, 403, 500)", () => {
  for (const who of ["B", "ADMIN"] as const)
    it(`${who} : chaque méthode de chaque route`, async () => {
      const wrong: string[] = [];
      for (const route of routes)
        for (const { method, handler } of route.methods) {
          const response = await call(
            route,
            handler,
            method,
            PRIVATE,
            cookies[who],
          );
          if (response.status !== 404)
            wrong.push(`${method} /${route.file} → ${response.status}`);
        }
      expect(wrong).toEqual([]);
    });
});

describe("compte B face à la session GLOBALE de A : lecture oui, modification non", () => {
  const route = (name: string) => routes.find((r) => r.file === name) as Route;
  const verb = (r: Route, v: string) =>
    r.methods.find((m) => m.method === v)?.handler as Handler;

  it("lire la session globale : 200", async () => {
    const r = route("(racine)");
    const response = await call(r, verb(r, "GET"), "GET", GLOBAL, cookies.B);
    expect(response.status).toBe(200);
  });
  it("renommer, supprimer, lancer ou annuler l'analyse : 403", async () => {
    const root = route("(racine)");
    const run = route("run");
    for (const [r, v] of [
      [root, "PATCH"],
      [root, "DELETE"],
      [run, "POST"],
      [run, "DELETE"],
    ] as const) {
      const response = await call(r, verb(r, v), v, GLOBAL, cookies.B);
      expect(response.status, `${v} /${r.file}`).toBe(403);
    }
  });
  it("un export vidéo de A reste invisible pour B, même sur la session globale", async () => {
    const { startVideoJob } = await import("@/lib/video-jobs");
    const { getDb } = await import("@/lib/db");
    const owner = getDb()
      .prepare("SELECT id FROM users WHERE username = 'awa'")
      .get() as { id: number };
    const job = await startVideoJob({
      sessionId: GLOBAL,
      userId: owner.id,
      options: {},
      background: null,
      bearer: "qtr_x",
      origin: "http://127.0.0.1:3000",
      runner: async () => undefined,
    });
    const detail = route("export/video/jobs/[job]");
    const get = verb(detail, "GET");
    const request = (cookie: string) =>
      get(
        new Request(
          `http://127.0.0.1:3000/api/sessions/${GLOBAL}/export/video/jobs/${job.id}`,
          {
            headers: { cookie: `aqr_session=${cookie}` },
          },
        ),
        { params: Promise.resolve({ id: GLOBAL, job: job.id }) },
      );
    expect((await request(cookies.B)).status).toBe(404);
    expect((await request(cookies.A)).status).toBe(200);
    const del = verb(detail, "DELETE");
    const cancelByB = await del(
      new Request(
        `http://127.0.0.1:3000/api/sessions/${GLOBAL}/export/video/jobs/${job.id}`,
        {
          method: "DELETE",
          headers: { cookie: `aqr_session=${cookies.B}` },
        },
      ),
      { params: Promise.resolve({ id: GLOBAL, job: job.id }) },
    );
    expect(cancelByB.status).toBe(404);
  });
});

describe("passage privé → public", () => {
  it("n'est possible que pour le propriétaire, est journalisé (sans titre) et se défait", async () => {
    const { POST } = await import("./sessions/bulk/route");
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const bulk = (cookie: string, visibility: string) =>
      POST(
        new Request("http://127.0.0.1:3000/api/sessions/bulk", {
          method: "POST",
          headers: {
            cookie: `aqr_session=${cookie}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            ids: [PRIVATE],
            action: "set_visibility",
            visibility,
          }),
        }),
      );
    expect(
      (await (await bulk(cookies.B, "global")).json()).results[0].status,
    ).toBe("not_found");
    expect(
      (await (await bulk(cookies.A, "global")).json()).results[0].status,
    ).toBe("ok");
    expect(
      (await (await bulk(cookies.A, "private")).json()).results[0].status,
    ).toBe("ok"); // réversible
    const lines = spy.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes("visibility.change"));
    spy.mockRestore();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("private → global");
    expect(lines[1]).toContain("global → private");
    expect(lines.join("")).toContain(PRIVATE);
    expect(lines.join("")).not.toContain("Privée de Awa");
  });
});

describe("routes hors /sessions/[id]", () => {
  it("la liste de B ne contient pas la session privée de A, ni dans les statistiques", async () => {
    const { GET } = await import("./sessions/route");
    const response = await GET(
      new NextRequest("http://127.0.0.1:3000/api/sessions", {
        headers: { cookie: `aqr_session=${cookies.B}` },
      }),
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain(PRIVATE);
    expect(text).not.toContain("Privée de Awa");
    expect(text).toContain(GLOBAL);
    const { GET: stats } = await import("./stats/route");
    const statsText = await (
      await stats(
        new Request("http://127.0.0.1:3000/api/stats", {
          headers: { cookie: `aqr_session=${cookies.B}` },
        }),
      )
    ).text();
    expect(statsText).not.toContain("Privée de Awa");
  });

  it("l'action groupée de B sur la session privée de A : not_found, et rien n'est modifié", async () => {
    const { POST } = await import("./sessions/bulk/route");
    const { getDb } = await import("@/lib/db");
    const response = await POST(
      new Request("http://127.0.0.1:3000/api/sessions/bulk", {
        method: "POST",
        headers: {
          cookie: `aqr_session=${cookies.B}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ids: [PRIVATE],
          action: "set_visibility",
          visibility: "global",
        }),
      }),
    );
    expect((await response.json()).results).toEqual([
      { id: PRIVATE, status: "not_found" },
    ]);
    const row = getDb()
      .prepare("SELECT visibility FROM session_meta WHERE id = ?")
      .get(PRIVATE) as { visibility: string };
    expect(row.visibility).toBe("private");
  });

  it("B ne peut pas révoquer le jeton d'API de A", async () => {
    const { createApiToken } = await import("@/lib/api-tokens");
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    const owner = db
      .prepare("SELECT id FROM users WHERE username = 'awa'")
      .get() as { id: number };
    createApiToken(db, {
      userId: owner.id,
      name: "agent de A",
      scope: "write",
    });
    const row = db
      .prepare("SELECT id FROM api_tokens WHERE user_id = ?")
      .get(owner.id) as { id: number };
    const { DELETE } = await import("./me/tokens/[id]/route");
    const response = await DELETE(
      new Request(`http://127.0.0.1:3000/api/me/tokens/${row.id}`, {
        method: "DELETE",
        headers: { cookie: `aqr_session=${cookies.B}` },
      }),
      { params: Promise.resolve({ id: String(row.id) }) },
    );
    expect(response.status).toBe(404);
    const still = db
      .prepare("SELECT revoked_at FROM api_tokens WHERE id = ?")
      .get(row.id) as { revoked_at: string | null };
    expect(still.revoked_at).toBeNull();
  });

  it("un simple utilisateur n'accède ni à la liste des comptes ni à leur gestion", async () => {
    const { GET } = await import("./admin/users/route");
    const { PATCH } = await import("./admin/users/[id]/route");
    const list = await GET(
      new Request("http://127.0.0.1:3000/api/admin/users", {
        headers: { cookie: `aqr_session=${cookies.B}` },
      }),
    );
    expect(list.status).toBe(403);
    const patch = await PATCH(
      new Request("http://127.0.0.1:3000/api/admin/users/1", {
        method: "PATCH",
        headers: {
          cookie: `aqr_session=${cookies.B}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: "admin" }),
      }),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(patch.status).toBe(403);
  });
});
