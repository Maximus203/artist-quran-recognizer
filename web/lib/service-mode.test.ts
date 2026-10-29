import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentMode, modeRefusal, resetModeCache } from "./service-mode";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-mode-"));
  vi.stubEnv("AQR_REVIEW_DIR", dir);
  vi.stubEnv("AQR_SERVICE_MODE", "");
  resetModeCache();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
const flag = async (name: string) => {
  await mkdir(path.join(dir, "control"), { recursive: true });
  await writeFile(path.join(dir, "control", name), "");
};

describe("mode du service", () => {
  it("normal par défaut", () => {
    expect(currentMode(1_000)).toBe("normal");
  });

  it("un fichier de contrôle active le mode, la suppression le lève (après 2 s)", async () => {
    await flag("restricted");
    expect(currentMode(10_000)).toBe("restricted");
    await rm(path.join(dir, "control", "restricted"));
    expect(currentMode(10_500)).toBe("restricted"); // lecture en cache
    expect(currentMode(13_000)).toBe("normal");
  });

  it("la maintenance l'emporte sur le mode restreint", async () => {
    await flag("restricted");
    await flag("maintenance");
    expect(currentMode(1_000)).toBe("maintenance");
  });

  it("la variable d'environnement fixe le mode au démarrage, valeur inconnue = normal", () => {
    vi.stubEnv("AQR_SERVICE_MODE", "maintenance");
    expect(currentMode(1_000)).toBe("maintenance");
    resetModeCache();
    vi.stubEnv("AQR_SERVICE_MODE", "n'importe quoi");
    expect(currentMode(1_000)).toBe("normal");
  });
});

describe("refus selon le mode", () => {
  it("normal : rien n'est refusé", () => {
    expect(modeRefusal("normal", "POST", "/api/sessions", "upload")).toBeNull();
  });

  it.each([
    ["inscription", "POST", "/api/auth/register", "auth"],
    ["envoi d'un fichier", "POST", "/api/sessions", "upload"],
    ["analyse", "POST", "/api/sessions/x/run", "generate"],
    ["export vidéo", "POST", "/api/sessions/x/export/video", "generate"],
    ["jeton du direct", "POST", "/api/live/token", "live"],
  ])("restreint : %s est suspendu (503, Retry-After)", (_n, m, p, f) => {
    const refusal = modeRefusal("restricted", m, p, f);
    expect(refusal?.status).toBe(503);
    expect(refusal?.code).toBe("restricted");
    expect(refusal?.retryAfterS).toBeGreaterThan(0);
  });

  it.each([
    ["connexion", "POST", "/api/auth/login", "auth"],
    ["lecture d'une session", "GET", "/api/sessions", "read"],
    ["page", "GET", "/login", "page"],
    ["modification légère", "PATCH", "/api/me/preferences", "write"],
  ])("restreint : %s continue de passer", (_n, m, p, f) => {
    expect(modeRefusal("restricted", m, p, f)).toBeNull();
  });

  it("maintenance : tout est refusé, sauf la sonde de supervision", () => {
    for (const [m, p, f] of [
      ["GET", "/login", "page"],
      ["GET", "/api/sessions", "read"],
      ["POST", "/api/auth/login", "auth"],
      ["GET", "/_next/static/a.js", "static"],
    ])
      expect(modeRefusal("maintenance", m, p, f)?.code).toBe("maintenance");
    expect(modeRefusal("maintenance", "GET", "/api/health", "read")).toBeNull();
  });
});

describe("dans le proxy", () => {
  type Proxy = typeof import("./../proxy").proxy;
  let proxy: Proxy;
  beforeEach(async () => {
    vi.resetModules();
    delete (globalThis as Record<symbol, unknown>)[
      Symbol.for("aqr.proxy-limiters")
    ];
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    ({ proxy } = await import("./../proxy"));
  });
  const req = (p: string, method = "GET") =>
    new NextRequest(`http://127.0.0.1:3000${p}`, { method });

  it("maintenance : une page reçoit la page de maintenance en 503, l'API du JSON, la sonde passe", async () => {
    await flag("maintenance");
    const page = proxy(req("/login"));
    expect(page.status).toBe(503);
    expect(page.headers.get("content-type")).toMatch(/text\/html/);
    expect(await page.text()).toMatch(/Maintenance en cours/);
    expect(page.headers.get("retry-after")).toBe("300");
    expect(page.headers.get("content-security-policy")).toBeTruthy();
    const api = proxy(req("/api/sessions"));
    expect(api.status).toBe(503);
    expect((await api.json()).code).toBe("maintenance");
    expect(proxy(req("/api/health")).status).toBe(200);
  });

  it("restreint : l'envoi est suspendu, la lecture et la connexion non", async () => {
    await flag("restricted");
    expect(proxy(req("/api/sessions", "POST")).status).toBe(503);
    expect(proxy(req("/api/auth/register", "POST")).status).toBe(503);
    expect(proxy(req("/api/sessions")).status).toBe(200);
    expect(proxy(req("/api/auth/login", "POST")).status).toBe(200);
  });
});
