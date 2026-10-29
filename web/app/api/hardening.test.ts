import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Sections 5 et 7 : attributs de cookie, jetons de session, corps strictement validés, jetons d'API, erreurs sans détail. */
let dir = "";
let login: typeof import("./auth/login/route").POST;
let tokens: typeof import("./me/tokens/route");
let userCookie = "";
const PASSWORD = "cheval agrafe pile batterie";

const post = (
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-hardening-"));
  vi.stubEnv("AQR_REVIEW_DIR", dir);
  const { getDb } = await import("@/lib/db");
  const { createUser } = await import("@/lib/users");
  const { hashPassword } = await import("@/lib/passwords");
  const { createLogin, authConfig } = await import("@/lib/auth");
  const db = getDb();
  const user = createUser(db, {
    username: "awa",
    passwordHash: await hashPassword(PASSWORD),
  });
  userCookie = createLogin(db, user.id, authConfig());
  ({ POST: login } = await import("./auth/login/route"));
  tokens = await import("./me/tokens/route");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  const { getDb } = await import("@/lib/db");
  getDb().close();
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("cookie de connexion", () => {
  it("HttpOnly, SameSite=Lax, Path=/, durée bornée ; Secure en HTTPS seulement", async () => {
    const http = await login(
      post("http://127.0.0.1:3000/api/auth/login", {
        username: "awa",
        password: PASSWORD,
      }),
    );
    expect(http.status).toBe(200);
    const cookieHttp = http.headers.get("set-cookie") ?? "";
    expect(cookieHttp).toMatch(/^aqr_session=[A-Za-z0-9_-]{43};/);
    for (const attribute of ["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age="])
      expect(cookieHttp).toContain(attribute);
    expect(cookieHttp).not.toContain("Secure");
    const https = await login(
      post("https://127.0.0.1:3000/api/auth/login", {
        username: "awa",
        password: PASSWORD,
      }),
    );
    const cookieHttps = https.headers.get("set-cookie") ?? "";
    expect(cookieHttps).toContain("Secure");
    expect(cookieHttps).toContain("HttpOnly");
    expect(https.headers.get("cache-control")).toContain("no-store");
  });

  it("un nouvel identifiant à chaque connexion (anti-fixation), 256 bits, jamais stocké en clair", async () => {
    const values = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const response = await login(
        post("http://127.0.0.1:3000/api/auth/login", {
          username: "awa",
          password: PASSWORD,
        }),
      );
      values.add(
        /aqr_session=([^;]+)/.exec(
          response.headers.get("set-cookie") ?? "",
        )?.[1] ?? "",
      );
    }
    expect(values.size).toBe(3);
    const { getDb } = await import("@/lib/db");
    const dump = JSON.stringify(
      getDb().prepare("SELECT * FROM auth_sessions").all(),
    );
    for (const value of values) {
      expect(Buffer.from(value, "base64url").length).toBe(32);
      expect(dump).not.toContain(value);
    }
  });
});

describe("corps strictement validés", () => {
  it("connexion : champ inconnu, mauvais type ou corps absent → 400, sans écho", async () => {
    for (const body of [
      { username: "awa", password: PASSWORD, admin: true },
      { username: 7, password: PASSWORD },
      { username: "awa" },
      "{pas json",
      "",
    ]) {
      const response = await login(
        post("http://127.0.0.1:3000/api/auth/login", body),
      );
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain("admin");
    }
  });
  it("corps de plus de 1 Mio : refusé sans être lu en entier", async () => {
    const response = await login(
      post("http://127.0.0.1:3000/api/auth/login", "x".repeat(2 * 1024 * 1024)),
    );
    expect(response.status).toBe(400);
  });
});

describe("jetons d'API", () => {
  const create = (body: unknown) =>
    tokens.POST(
      post("http://127.0.0.1:3000/api/me/tokens", body, {
        cookie: `aqr_session=${userCookie}`,
      }),
    );

  it("jamais sans date de fin : 180 jours par défaut, 365 au plus", async () => {
    const response = await create({ name: "agent", scope: "read" });
    expect(response.status).toBe(201);
    const { token, item } = await response.json();
    expect(token).toMatch(/^qtr_[A-Za-z0-9_-]{43}$/);
    const days = (Date.parse(item.expires_at) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(179);
    expect(days).toBeLessThan(181);
    expect(
      (await create({ name: "long", scope: "read", expires_in_days: 366 }))
        .status,
    ).toBe(400);
    expect(
      (await create({ name: "zéro", scope: "read", expires_in_days: 0 }))
        .status,
    ).toBe(400);
  });
  it("champ inconnu ou droit invalide : 400", async () => {
    expect((await create({ name: "x", scope: "write", owner: 1 })).status).toBe(
      400,
    );
    expect((await create({ name: "x", scope: "root" })).status).toBe(400);
    expect((await create({ name: "", scope: "read" })).status).toBe(400);
  });
  it("la valeur du jeton n'est montrée qu'une fois : la liste n'en contient jamais", async () => {
    const created = await (
      await create({ name: "unique", scope: "write" })
    ).json();
    const list = await tokens.GET(
      new Request("http://127.0.0.1:3000/api/me/tokens", {
        headers: { cookie: `aqr_session=${userCookie}` },
      }),
    );
    const text = await list.text();
    expect(text).not.toContain(created.token);
    expect(text).not.toContain("token_hash");
    const { getDb } = await import("@/lib/db");
    const dump = JSON.stringify(
      getDb().prepare("SELECT * FROM api_tokens").all(),
    );
    expect(dump).not.toContain(created.token);
  });
  it("création et révocation sont journalisées, sans la valeur du jeton", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const created = await (
      await create({ name: "journal", scope: "read" })
    ).json();
    const { DELETE } = await import("./me/tokens/[id]/route");
    await DELETE(
      new Request(`http://127.0.0.1:3000/api/me/tokens/${created.item.id}`, {
        method: "DELETE",
        headers: { cookie: `aqr_session=${userCookie}` },
      }),
      { params: Promise.resolve({ id: String(created.item.id) }) },
    );
    const lines = spy.mock.calls.map((c) => String(c[0])).join("\n");
    spy.mockRestore();
    expect(lines).toContain('"event":"token.created"');
    expect(lines).toContain('"event":"token.revoked"');
    expect(lines).not.toContain(created.token);
  });
});

describe("erreurs sans détail interne", () => {
  it("une exception inattendue donne un 500 générique : ni pile, ni chemin, ni message d'origine", async () => {
    const { safe } = await import("@/lib/http");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = safe(async () => {
      throw new Error(
        "ENOENT: no such file, open 'C:\Users\secret\données.sqlite'",
      );
    });
    const response = await handler(new Request("http://127.0.0.1:3000/api/x"));
    spy.mockRestore();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toMatch(/ENOENT|secret|sqlite|C:\|at .*\(/);
    expect(JSON.parse(text).code).toBe("internal");
  });
});
