import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Entrées hostiles sur CHAQUE route de l'API (section 14 de docs/SECURITE-PRE-DEPLOIEMENT.md).
 * Les routes sont DÉCOUVERTES sur le disque : une route ajoutée demain est attaquée sans qu'on y pense.
 *
 * Pour chaque méthode de chaque route, sans connexion puis avec un compte puis avec un administrateur,
 * et pour chaque charge (SQL, chemin, commande, HTML, très long, prototype), la charge est placée dans
 * le chemin, la requête (query) et chaque champ JSON courant. Attendu : aucune erreur 5xx, aucune
 * exception, aucune exécution (un fichier-témoin que la commande injectée créerait n'apparaît pas), la
 * base intacte, aucun contenu de fichier système lu, aucune page HTML renvoyée avec la charge.
 */
const HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const API_DIR = __dirname;

let dir = "";
let canary = "";
const PAYLOADS = () => [
  "' OR '1'='1",
  "'; DROP TABLE users;--",
  '" OR 1=1 --',
  "1; ATTACH DATABASE 'x.db' AS x;--",
  "../../../../etc/passwd",
  "..\\..\\..\\..\\windows\\win.ini",
  "%2e%2e%2f%2e%2e%2fetc%2fpasswd",
  "/etc/passwd",
  "C:\\Windows\\win.ini",
  "a\u0000b.mp3",
  `; touch ${canary}`,
  `$(touch ${canary})`,
  `\`touch ${canary}\``,
  `| touch ${canary}`,
  `&& touch ${canary}`,
  "<script>alert(1)</script>",
  '"><img src=x onerror=alert(1)>',
  "javascript:alert(1)",
  "{{7*7}} ${7*7} <%= 7*7 %>",
  "\u202egnp.exe\u202d",
  "A".repeat(100_000),
];

// Champs que les routes lisent couramment ; la charge est placée dans chacun.
const FIELDS = [
  "username",
  "password",
  "newPassword",
  "currentPassword",
  "name",
  "title",
  "label",
  "code",
  "token",
  "query",
  "q",
  "text",
  "reason",
  "role",
  "visibility",
  "state",
  "id",
  "ids",
  "sessionId",
  "language",
  "locale",
  "theme",
  "quality",
  "format",
  "background",
  "ayah",
  "surah",
  "verse",
  "note",
  "email",
  "url",
  "path",
  "file",
  "filename",
  "ip",
  "hash",
  "action",
];

type Handler = (
  request: NextRequest,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response> | Response;
type RouteDef = {
  label: string;
  segments: string[];
  verb: string;
  handler: Handler;
};

function discover(current: string, segments: string[] = []): string[][] {
  const found: string[][] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory())
      found.push(
        ...discover(path.join(current, entry.name), [...segments, entry.name]),
      );
    else if (entry.name === "route.ts") found.push(segments);
  }
  return found;
}

function snapshot(root: string): string[] {
  const out: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else out.push(path.relative(root, full));
    }
  };
  visit(root);
  return out;
}

let routes: RouteDef[] = [];

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "aqr-inj-"));
  canary = path.join(dir, "PWNED").split("\\").join("/");
  vi.stubEnv("AQR_REVIEW_DIR", dir);
  vi.stubEnv("AQR_LOG_DIR", path.join(dir, "logs"));
  vi.stubEnv("AQR_LIVE_KEY", "k".repeat(40));
  vi.stubEnv("AQR_SCRYPT_LOG_N", "10");
  for (const segments of discover(API_DIR)) {
    const file = path.join(API_DIR, ...segments, "route.ts");
    const module = (await import(/* @vite-ignore */ file)) as Record<
      string,
      unknown
    >;
    for (const verb of HTTP)
      if (typeof module[verb] === "function")
        routes.push({
          label: `${verb} /api/${segments.join("/")}`,
          segments,
          verb,
          handler: module[verb] as Handler,
        });
  }
});

afterAll(async () => {
  vi.unstubAllEnvs();
  const { getDb } = await import("@/lib/db");
  getDb().close();
  rmSync(dir, { recursive: true, force: true });
});

async function identity(kind: "none" | "user" | "admin", n: number) {
  if (kind === "none") return null;
  const { getDb } = await import("@/lib/db");
  const { createUser } = await import("@/lib/users");
  const { createLogin, authConfig } = await import("@/lib/auth");
  const db = getDb();
  const user = createUser(db, { username: `${kind}${n}`, passwordHash: "x" });
  if (kind === "admin")
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
  return createLogin(db, user.id, authConfig());
}

async function attack(
  route: RouteDef,
  payload: string,
  cookie: string | null,
): Promise<{ status: number; type: string; text: string } | { threw: string }> {
  const params: Record<string, string> = {};
  const segments = route.segments.map((segment) => {
    const match = /^\[(.+)\]$/.exec(segment);
    if (!match) return segment;
    params[match[1]] = payload;
    return encodeURIComponent(payload);
  });
  const query = `?${FIELDS.map((f) => `${f}=${encodeURIComponent(payload.slice(0, 2000))}`).join("&")}`;
  const unsafe = route.verb !== "GET";
  const body: Record<string, unknown> = Object.fromEntries(
    FIELDS.map((f) => [f, payload]),
  );
  body.nested = { a: [payload, { b: payload }] };
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = `aqr_session=${cookie}`;
  if (unsafe) headers["content-type"] = "application/json";
  const raw = unsafe
    ? `{"__proto__":{"polluted":"yes"},${JSON.stringify(body).slice(1)}`
    : undefined;
  const request = new NextRequest(
    `http://127.0.0.1:3000/api/${segments.join("/")}${query}`,
    { method: route.verb, headers, body: raw },
  );
  try {
    const response = await route.handler(request, {
      params: Promise.resolve(params),
    });
    const text = await response.text().catch(() => "");
    return {
      status: response.status,
      type: response.headers.get("content-type") ?? "",
      text: text.slice(0, 200_000),
    };
  } catch (error) {
    return { threw: error instanceof Error ? error.message : String(error) };
  }
}

const SYSTEM_FILE_MARKERS = [
  /root:.*:0:0:/,
  /\[fonts\]/i,
  /for 16-bit app support/i,
];

describe("découverte", () => {
  it("trouve les routes de l'API (le balayage ne tourne pas à vide)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(60);
    expect(routes.some((r) => r.label === "POST /api/auth/login")).toBe(true);
    expect(routes.some((r) => r.label === "GET /api/sessions/[id]/audio")).toBe(
      true,
    );
  });
});

describe("entrées hostiles sur chaque route", () => {
  for (const kind of ["none", "user", "admin"] as const)
    it(`${kind === "none" ? "sans connexion" : kind === "user" ? "avec un compte" : "avec un administrateur"} : ni 5xx, ni exception, ni exécution, ni lecture de fichier système`, async () => {
      const { getDb } = await import("@/lib/db");
      const tablesBefore = (
        getDb()
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
          )
          .all() as Array<{ name: string }>
      ).map((r) => r.name);
      const problems: string[] = [];
      let calls = 0;
      let counter = 0;
      for (const route of routes)
        for (const payload of PAYLOADS()) {
          const cookie = await identity(kind, ++counter);
          const result = await attack(route, payload, cookie);
          calls++;
          const tag = `${route.label} [${payload.slice(0, 24).replace(/\0/g, "\\0")}]`;
          if ("threw" in result) {
            problems.push(`${tag} → exception : ${result.threw}`);
            continue;
          }
          if (result.status >= 500) problems.push(`${tag} → ${result.status}`);
          if (
            /text\/html/i.test(result.type) &&
            result.text.includes("<script>alert(1)")
          )
            problems.push(`${tag} → page HTML qui reflète la charge`);
          if (SYSTEM_FILE_MARKERS.some((m) => m.test(result.text)))
            problems.push(`${tag} → contenu d'un fichier système`);
        }
      expect(calls).toBeGreaterThan(1000);
      expect(problems.slice(0, 40)).toEqual([]);
      // Aucune commande injectée n'a tourné : le fichier-témoin n'existe pas.
      expect(existsSync(canary)).toBe(false);
      // La base est intacte : mêmes tables, et la table des comptes répond encore.
      const tablesAfter = (
        getDb()
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
          )
          .all() as Array<{ name: string }>
      ).map((r) => r.name);
      expect(tablesAfter).toEqual(tablesBefore);
      expect(() =>
        getDb().prepare("SELECT COUNT(*) FROM users").get(),
      ).not.toThrow();
      // Pollution de prototype : rien n'a été ajouté à Object.
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }, 300_000);

  it("aucun fichier n'a été écrit hors des dossiers de l'atelier (rien dans le dossier de travail)", () => {
    const stray = snapshot(dir).filter(
      (file) =>
        !/^(logs|sessions|users|avatars|state|\.|aqr)/.test(file) &&
        !/\.(sqlite|db|log|json|mp3|wav|png|jpg|webp)/.test(file),
    );
    expect(stray).toEqual([]);
    expect(statSync(dir).isDirectory()).toBe(true);
  });

  it("garde-fou : le fichier-témoin serait détecté s'il était créé", () => {
    expect(canary.endsWith("PWNED")).toBe(true);
  });
});
