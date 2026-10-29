import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Routes pièges et adresses bloquées dans le proxy (section 9). */
let dir = "";
type Proxy = typeof import("./proxy").proxy;
let proxy: Proxy;

async function load(trustProxy: boolean) {
  vi.resetModules();
  // État du proxy gardé sur globalThis : repartir de zéro à chaque test.
  delete (globalThis as Record<symbol, unknown>)[
    Symbol.for("aqr.proxy-blocks")
  ];
  delete (globalThis as Record<symbol, unknown>)[
    Symbol.for("aqr.proxy-limiters")
  ];
  vi.stubEnv("AQR_REVIEW_DIR", dir);
  vi.stubEnv("AQR_TRUST_PROXY", trustProxy ? "1" : "");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  ({ proxy } = await import("./proxy"));
}
const req = (pathname: string, ip?: string, method = "GET") =>
  new NextRequest(`http://127.0.0.1:3000${pathname}`, {
    method,
    headers: ip ? { "x-forwarded-for": ip } : {},
  });
const blockedRows = async () => {
  const { getDb } = await import("./lib/db");
  return (
    getDb().prepare("SELECT COUNT(*) AS n FROM blocked_addresses").get() as {
      n: number;
    }
  ).n;
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-honeypot-"));
});
afterEach(async () => {
  const { closeDb } = await import("./lib/db");
  closeDb();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("derrière un proxy de confiance (adresse réelle connue)", () => {
  beforeEach(() => load(true));

  it("une route piège répond 404 (comme si elle n'existait pas) et bloque l'adresse", async () => {
    const hit = proxy(req("/wp-admin/setup-config.php", "203.0.113.5"));
    expect(hit.status).toBe(404);
    expect((await hit.json()).error).toBe("Introuvable.");
    expect(await blockedRows()).toBe(1);
  });

  it("l'adresse bloquée est ensuite refusée partout (403), une autre adresse ne l'est pas", async () => {
    proxy(req("/.env", "203.0.113.5"));
    const next = proxy(req("/login", "203.0.113.5"));
    expect(next.status).toBe(403);
    expect((await next.json()).code).toBe("blocked");
    expect(proxy(req("/login", "203.0.113.6")).status).toBe(200);
    expect(proxy(req("/api/sessions", "203.0.113.5")).status).toBe(403);
  });

  it("le blocage et le piège sont journalisés dans le flux de sécurité, avec l'adresse pseudonymisée", async () => {
    const { LogFiles } = await import("./lib/log-files");
    const { useLogFiles } = await import("./lib/log");
    const logDir = path.join(dir, "journaux");
    useLogFiles(new LogFiles({ dir: logDir }));
    proxy(req("/api/debug", "203.0.113.9"));
    proxy(req("/", "203.0.113.9"));
    const { readFileSync, readdirSync } = await import("node:fs");
    const file = readdirSync(logDir).find((f) =>
      f.startsWith("security-"),
    ) as string;
    const text = readFileSync(path.join(logDir, file), "utf8");
    expect(text).toContain('"msg":"honeypot.hit"');
    expect(text).toContain('"msg":"blocked_request"');
    expect(text).not.toContain("203.0.113.9");
    useLogFiles(null);
  });

  it("un humain qui se trompe d'adresse n'est pas touché : une page ordinaire inexistante ne bloque pas", async () => {
    expect(proxy(req("/une-page-qui-nexiste-pas", "203.0.113.7")).status).toBe(
      200,
    ); // c'est Next qui répondra 404
    expect(await blockedRows()).toBe(0);
  });

  it("la vraie route d'administration n'est jamais un piège", async () => {
    expect(proxy(req("/api/admin/users", "203.0.113.8")).status).toBe(200); // la garde d'accès répondra
    expect(await blockedRows()).toBe(0);
  });
});

describe("sans proxy de confiance (toutes les adresses se ressemblent)", () => {
  beforeEach(() => load(false));

  it("répond 404 au piège mais ne bloque personne : tout le monde partagerait la même adresse", async () => {
    expect(proxy(req("/wp-admin")).status).toBe(404);
    expect(await blockedRows()).toBe(0);
    expect(proxy(req("/login")).status).toBe(200);
  });
});
